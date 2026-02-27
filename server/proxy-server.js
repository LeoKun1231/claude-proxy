const http = require("http");
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");

let server = null;
let currentPort = 5055;
let configProvider = () => ({ mapping: { main: "pass" }, providers: {} });
const SHOULD_REWRITE_LOCALHOST =
  String(process.env.REWRITE_LOCALHOST_FOR_DOCKER || "").toLowerCase() ===
  "true";
const DOCKER_HOST_ALIAS = String(
  process.env.DOCKER_HOST_ALIAS || "host.docker.internal",
);

function readIntEnv(name, fallback, min = 1) {
  const value = Number(process.env[name]);
  if (Number.isFinite(value) && value >= min) {
    return Math.floor(value);
  }
  return fallback;
}

const UPSTREAM_TIMEOUT_MS = readIntEnv(
  "PROXY_UPSTREAM_TIMEOUT_MS",
  120000,
  1000,
);
const ENABLE_KEEP_ALIVE =
  String(process.env.PROXY_KEEP_ALIVE || "true").toLowerCase() !== "false";
const ENABLE_DEDUP =
  String(process.env.PROXY_DEDUP_ENABLED || "false").toLowerCase() === "true";
const DEDUP_WINDOW_MS = readIntEnv("PROXY_DEDUP_WINDOW_MS", 5000, 1000);
const DEDUP_MAX_ENTRIES = readIntEnv("PROXY_DEDUP_MAX_ENTRIES", 2000, 100);
const BODY_HASH_LIMIT = readIntEnv("PROXY_BODY_HASH_LIMIT", 16384, 1024);
const REQUEST_ID_MAX_LENGTH = 64;
const REQUEST_ID_ALLOWED_PATTERN = /[^a-zA-Z0-9._:-]/g;

const httpAgent = new http.Agent({
  keepAlive: ENABLE_KEEP_ALIVE,
  maxSockets: readIntEnv("PROXY_MAX_SOCKETS", 100, 1),
  maxFreeSockets: readIntEnv("PROXY_MAX_FREE_SOCKETS", 20, 1),
});

const httpsAgent = new https.Agent({
  keepAlive: ENABLE_KEEP_ALIVE,
  maxSockets: readIntEnv("PROXY_MAX_SOCKETS", 100, 1),
  maxFreeSockets: readIntEnv("PROXY_MAX_FREE_SOCKETS", 20, 1),
});

// 短窗口去重缓存：key -> 过期时间戳
const recentRequestMap = new Map();

function isLocalAddressHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(hostname || "").toLowerCase(),
  );
}

function setConfigProvider(getConfig) {
  configProvider =
    typeof getConfig === "function"
      ? getConfig
      : () => ({ mapping: { main: "pass" }, providers: {} });
}

function getBuiltinProviderUrl(providerId) {
  const urls = {
    anthropic: "https://api.anthropic.com",
    glm: "https://open.bigmodel.cn/api/anthropic",
    kimi: "https://api.moonshot.cn/anthropic",
    minimax: "https://api.minimaxi.com/anthropic",
    deepseek: "https://api.deepseek.com/anthropic",
  };
  return urls[providerId] || "https://api.anthropic.com";
}

function getProviderConfig(target, providers) {
  if (!target || target === "pass") {
    return null;
  }

  const separator = target.indexOf(":");
  if (separator === -1) {
    return null;
  }

  const providerId = target.substring(0, separator);
  const modelName = target.substring(separator + 1);

  if (providers[providerId]) {
    const providerSettings = providers[providerId] || {};
    const overrideBaseUrl = String(providerSettings.baseUrl || "").trim();
    let baseUrl = overrideBaseUrl || getBuiltinProviderUrl(providerId);

    // LiteLLM/CLIProxyAPI 默认走本地端口，可在配置中覆盖 baseUrl
    if (!overrideBaseUrl && ["litellm", "cliproxyapi"].includes(providerId)) {
      const localPort = Number(providerSettings.port);
      const safePort =
        Number.isFinite(localPort) && localPort > 0 ? localPort : 4100;
      baseUrl = `http://127.0.0.1:${safePort}`;
    }

    return {
      providerId,
      baseUrl,
      apiKey: providerSettings.apiKey,
      modelName,
    };
  }

  const customProviders = Array.isArray(providers.customProviders)
    ? providers.customProviders
    : [];
  const custom = customProviders.find((item) => item.id === providerId);

  if (custom) {
    return {
      providerId,
      baseUrl: custom.baseUrl,
      apiKey: custom.apiKey,
      modelName,
    };
  }

  return null;
}

function isDockerContainer() {
  if (String(process.env.DOCKER_CONTAINER || "").toLowerCase() === "true") {
    return true;
  }
  return fs.existsSync("/.dockerenv");
}

function normalizeBaseUrlForDocker(baseUrl) {
  // 容器内若配置 localhost 上游，则自动转为宿主机别名，避免回环到容器自身
  const normalized = String(baseUrl || "").replace(/\/$/, "");
  if (!normalized || !SHOULD_REWRITE_LOCALHOST || !isDockerContainer()) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (!isLocalAddressHost(parsed.hostname)) {
      return normalized;
    }

    parsed.hostname = DOCKER_HOST_ALIAS;
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return normalized;
  }
}

function buildProxyErrorHint(error, originalBaseUrl, targetUrl) {
  // 根据常见容器网络错误补充可执行提示，便于快速定位
  const base = String(originalBaseUrl || "");
  const isLocalOrigin =
    /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base);
  const targetHost = String(targetUrl?.hostname || "").toLowerCase();
  const targetPort =
    targetUrl?.port || (targetUrl?.protocol === "https:" ? "443" : "80");

  if (
    error?.code === "ECONNREFUSED" &&
    isDockerContainer() &&
    isLocalOrigin &&
    targetHost === DOCKER_HOST_ALIAS.toLowerCase()
  ) {
    return `容器内已自动改写为 http://${DOCKER_HOST_ALIAS}:${targetPort}，但连接被拒绝。请确认宿主机该端口服务已启动，且监听地址不是仅 localhost。`;
  }

  if (error?.code === "ECONNREFUSED" && isLocalOrigin && isDockerContainer()) {
    return "检测到容器内使用 localhost 上游地址，请改为 http://host.docker.internal:<port>。";
  }

  if (
    error?.code === "ENOTFOUND" &&
    targetHost === DOCKER_HOST_ALIAS.toLowerCase()
  ) {
    return `容器内无法解析 ${DOCKER_HOST_ALIAS}，请在 docker-compose 中配置 extra_hosts。`;
  }

  return "";
}

function readHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }
  return String(value || "");
}

function sanitizeTraceValue(value) {
  return String(value || "")
    .replace(/[\r\n\t]/g, "")
    .replace(REQUEST_ID_ALLOWED_PATTERN, "")
    .slice(0, REQUEST_ID_MAX_LENGTH)
    .trim();
}

function createRequestId(req) {
  const fromRequestId = sanitizeTraceValue(
    readHeaderValue(req.headers, "x-request-id"),
  );
  if (fromRequestId) {
    return fromRequestId;
  }

  const fromCorrelationId = sanitizeTraceValue(
    readHeaderValue(req.headers, "x-correlation-id"),
  );
  if (fromCorrelationId) {
    return fromCorrelationId;
  }

  return `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function getCallerFingerprint(req) {
  const remoteAddress = String(req.socket?.remoteAddress || "unknown");
  return crypto
    .createHash("sha1")
    .update(remoteAddress)
    .digest("hex")
    .slice(0, 12);
}

function getBodyHash(body) {
  if (!body) {
    return "empty";
  }

  const content = String(body);
  if (content.length <= BODY_HASH_LIMIT) {
    const fullHash = crypto
      .createHash("sha1")
      .update(content)
      .digest("hex")
      .slice(0, 16);
    return `${fullHash}:${content.length}`;
  }

  const half = Math.max(512, Math.floor(BODY_HASH_LIMIT / 2));
  const head = content.slice(0, half);
  const tail = content.slice(-half);
  const sampledHash = crypto
    .createHash("sha1")
    .update(`${head}|${tail}|${content.length}`)
    .digest("hex")
    .slice(0, 16);
  return `${sampledHash}:${content.length}`;
}

function pruneRecentRequests(now = Date.now()) {
  for (const [key, expiresAt] of recentRequestMap.entries()) {
    if (expiresAt <= now) {
      recentRequestMap.delete(key);
    }
  }

  while (recentRequestMap.size > DEDUP_MAX_ENTRIES) {
    const oldestKey = recentRequestMap.keys().next().value;
    if (!oldestKey) {
      break;
    }
    recentRequestMap.delete(oldestKey);
  }
}

function isDuplicateAndMark(key, now = Date.now()) {
  if (!ENABLE_DEDUP) {
    return false;
  }

  pruneRecentRequests(now);
  const existsUntil = recentRequestMap.get(key);
  if (typeof existsUntil === "number" && existsUntil > now) {
    return true;
  }

  recentRequestMap.set(key, now + DEDUP_WINDOW_MS);
  return false;
}

function logProxy(logCallback, type, message) {
  logCallback?.({
    message,
    type,
    timestamp: new Date().toISOString(),
  });
}

function parseRequestUrl(reqUrl) {
  try {
    return new URL(String(reqUrl || "/"), "http://127.0.0.1");
  } catch (_error) {
    return new URL("http://127.0.0.1/");
  }
}

function normalizePathname(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized) {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function isOpenAIChatCompletionsPath(pathname) {
  const normalized = normalizePathname(pathname);
  return (
    normalized === "/v1/chat/completions" || normalized === "/chat/completions"
  );
}

function isAnthropicCompatibleProvider(providerConfig) {
  const providerId = String(providerConfig?.providerId || "").toLowerCase();
  if (["anthropic", "glm", "kimi", "minimax", "deepseek"].includes(providerId)) {
    return true;
  }

  const baseUrl = String(providerConfig?.baseUrl || "").toLowerCase();
  return baseUrl.includes("/anthropic") || baseUrl.includes("api.anthropic.com");
}

function normalizeOpenAITextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        if (part.type === "text" || part.type === "input_text") {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }

  return "";
}

function convertOpenAIContentToAnthropicBlocks(content) {
  const text = normalizeOpenAITextContent(content);
  if (!text) {
    return [{ type: "text", text: "" }];
  }
  return [{ type: "text", text }];
}

function normalizeOpenAITools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(
      (item) =>
        item &&
        item.type === "function" &&
        item.function &&
        typeof item.function.name === "string",
    )
    .map((item) => ({
      name: item.function.name,
      description:
        typeof item.function.description === "string"
          ? item.function.description
          : "",
      input_schema:
        item.function.parameters && typeof item.function.parameters === "object"
          ? item.function.parameters
          : { type: "object", properties: {} },
    }));
}

// 将 OpenAI Chat Completions 请求体转换为 Anthropic Messages 请求体
function convertOpenAIChatRequestToAnthropic(openaiBody, forcedModel) {
  const body = openaiBody && typeof openaiBody === "object" ? openaiBody : {};
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemChunks = [];
  const messages = [];

  sourceMessages.forEach((item) => {
    const role = String(item?.role || "").toLowerCase();

    if (role === "system") {
      const systemText = normalizeOpenAITextContent(item?.content);
      if (systemText) {
        systemChunks.push(systemText);
      }
      return;
    }

    if (role !== "user" && role !== "assistant") {
      return;
    }

    const contentBlocks = convertOpenAIContentToAnthropicBlocks(item?.content);
    const toolCalls = Array.isArray(item?.tool_calls) ? item.tool_calls : [];

    if (role === "assistant" && toolCalls.length > 0) {
      const toolUseBlocks = toolCalls
        .filter((toolCall) => toolCall && toolCall.type === "function")
        .map((toolCall, index) => {
          let parsedInput = {};
          const rawArgs = String(toolCall?.function?.arguments || "").trim();
          if (rawArgs) {
            try {
              const candidate = JSON.parse(rawArgs);
              if (candidate && typeof candidate === "object") {
                parsedInput = candidate;
              }
            } catch (_error) {
              parsedInput = { raw: rawArgs };
            }
          }
          return {
            type: "tool_use",
            id:
              typeof toolCall.id === "string" && toolCall.id
                ? toolCall.id
                : `toolu_${Date.now()}_${index}`,
            name:
              typeof toolCall?.function?.name === "string" &&
              toolCall.function.name
                ? toolCall.function.name
                : "tool",
            input: parsedInput,
          };
        });

      messages.push({
        role,
        content: [...contentBlocks, ...toolUseBlocks],
      });
      return;
    }

    messages.push({
      role,
      content: contentBlocks,
    });
  });

  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: "" }],
    });
  }

  const maxTokensCandidate = [body.max_tokens, body.max_completion_tokens].find(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0,
  );
  const maxTokens = maxTokensCandidate
    ? Math.floor(Number(maxTokensCandidate))
    : 1024;

  const converted = {
    model: forcedModel || body.model || "unknown",
    messages,
    max_tokens: maxTokens,
  };

  if (systemChunks.length > 0) {
    converted.system = systemChunks.join("\n\n");
  }

  if (Number.isFinite(Number(body.temperature))) {
    converted.temperature = Number(body.temperature);
  }

  if (Number.isFinite(Number(body.top_p))) {
    converted.top_p = Number(body.top_p);
  }

  if (Number.isFinite(Number(body.top_k))) {
    converted.top_k = Math.floor(Number(body.top_k));
  }

  if (body.stream === true) {
    converted.stream = true;
  }

  if (Array.isArray(body.stop) && body.stop.length > 0) {
    converted.stop_sequences = body.stop.map((item) => String(item));
  } else if (typeof body.stop === "string" && body.stop) {
    converted.stop_sequences = [body.stop];
  }

  const convertedTools = normalizeOpenAITools(body.tools);
  if (convertedTools.length > 0) {
    converted.tools = convertedTools;
  }

  if (body.tool_choice === "required") {
    converted.tool_choice = { type: "any" };
  } else if (body.tool_choice === "auto") {
    converted.tool_choice = { type: "auto" };
  } else if (
    body.tool_choice &&
    typeof body.tool_choice === "object" &&
    body.tool_choice.type === "function" &&
    typeof body.tool_choice?.function?.name === "string"
  ) {
    converted.tool_choice = {
      type: "tool",
      name: body.tool_choice.function.name,
    };
  }

  if (body.metadata && typeof body.metadata === "object") {
    converted.metadata = body.metadata;
  }

  return converted;
}

function mapAnthropicStopReasonToOpenAI(stopReason, hasToolCalls = false) {
  const reason = String(stopReason || "");
  if (reason === "max_tokens") {
    return "length";
  }
  if (reason === "tool_use" || hasToolCalls) {
    return "tool_calls";
  }
  return "stop";
}

function extractOpenAIToolCallsFromAnthropic(content) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((block, index) => {
      if (!block || block.type !== "tool_use") {
        return null;
      }

      return {
        id:
          typeof block.id === "string" && block.id
            ? block.id
            : `call_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: typeof block.name === "string" ? block.name : "tool",
          arguments: JSON.stringify(block.input || {}),
        },
      };
    })
    .filter(Boolean);
}

function extractTextFromAnthropicContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!block || block.type !== "text") {
        return "";
      }
      return typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

function convertAnthropicUsageToOpenAI(usage) {
  const promptTokens = Math.max(0, Number(usage?.input_tokens || 0));
  const completionTokens = Math.max(0, Number(usage?.output_tokens || 0));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

// 将 Anthropic 非流式响应转换为 OpenAI Chat Completions 响应格式
function convertAnthropicMessageToOpenAIResponse(body, fallbackModel) {
  const message = body && typeof body === "object" ? body : {};
  const text = extractTextFromAnthropicContent(message.content);
  const toolCalls = extractOpenAIToolCallsFromAnthropic(message.content);
  const assistantMessage = {
    role: "assistant",
    content: text || (toolCalls.length > 0 ? null : ""),
  };

  if (toolCalls.length > 0) {
    assistantMessage.tool_calls = toolCalls;
  }

  const converted = {
    id:
      typeof message.id === "string" && message.id
        ? message.id
        : `chatcmpl_${crypto.randomBytes(8).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: message.model || fallbackModel || "unknown",
    choices: [
      {
        index: 0,
        message: assistantMessage,
        finish_reason: mapAnthropicStopReasonToOpenAI(
          message.stop_reason,
          toolCalls.length > 0,
        ),
      },
    ],
    usage: convertAnthropicUsageToOpenAI(message.usage),
  };

  return converted;
}

function getOpenAIErrorPayload(upstreamStatusCode, upstreamBody) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(upstreamBody || "{}"));
  } catch (_error) {
    parsed = null;
  }

  const defaultMessage = `Upstream ${upstreamStatusCode || 502} error`;
  const upstreamError = parsed?.error;
  const message =
    typeof upstreamError?.message === "string" && upstreamError.message
      ? upstreamError.message
      : typeof parsed?.message === "string" && parsed.message
        ? parsed.message
        : defaultMessage;

  return {
    error: {
      message,
      type:
        typeof upstreamError?.type === "string" && upstreamError.type
          ? upstreamError.type
          : "upstream_error",
      code:
        typeof upstreamError?.code === "string" && upstreamError.code
          ? upstreamError.code
          : "upstream_error",
    },
  };
}

function parseSseFrame(frame) {
  const lines = String(frame || "").split(/\r?\n/);
  let eventName = "message";
  const dataLines = [];

  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });

  return {
    eventName,
    data: dataLines.join("\n"),
  };
}

function writeOpenAIStreamChunk(res, state, delta, finishReason = null) {
  const chunk = {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta: delta || {},
        finish_reason: finishReason,
      },
    ],
  };

  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function finalizeOpenAIStream(res, state, finishReason = "stop") {
  if (!state.finished) {
    writeOpenAIStreamChunk(res, state, {}, finishReason);
    state.finished = true;
  }

  if (!state.done) {
    res.write("data: [DONE]\n\n");
    state.done = true;
  }
}

// 将 Anthropic SSE 流式事件转换为 OpenAI chunk 流式事件
function proxyAnthropicStreamAsOpenAI(proxyRes, res, fallbackModel, onComplete) {
  const state = {
    id: `chatcmpl_${crypto.randomBytes(8).toString("hex")}`,
    model: fallbackModel || "unknown",
    created: Math.floor(Date.now() / 1000),
    roleSent: false,
    finished: false,
    done: false,
    nextToolIndex: 0,
    toolIndexByBlock: new Map(),
  };

  res.writeHead(proxyRes.statusCode || 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let frameBuffer = "";
  let streamCompleted = false;
  const ensureRoleChunk = () => {
    if (state.roleSent) {
      return;
    }
    writeOpenAIStreamChunk(res, state, { role: "assistant" }, null);
    state.roleSent = true;
  };

  const processFrame = (frame) => {
    const { eventName, data } = parseSseFrame(frame);
    if (!data) {
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_error) {
      payload = null;
    }

    if (!payload || typeof payload !== "object") {
      return;
    }

    if (eventName === "message_start") {
      if (payload.message && typeof payload.message === "object") {
        if (payload.message.id) {
          state.id = String(payload.message.id);
        }
        if (payload.message.model) {
          state.model = String(payload.message.model);
        }
      }
      ensureRoleChunk();
      return;
    }

    if (eventName === "content_block_start") {
      const block = payload.content_block;
      if (!block || typeof block !== "object") {
        return;
      }
      ensureRoleChunk();

      if (block.type === "text" && typeof block.text === "string" && block.text) {
        writeOpenAIStreamChunk(res, state, { content: block.text }, null);
        return;
      }

      if (block.type === "tool_use") {
        const blockIndex = Number(payload.index);
        const safeBlockIndex = Number.isFinite(blockIndex) ? blockIndex : -1;
        const toolCallIndex = state.nextToolIndex;
        state.nextToolIndex += 1;
        if (safeBlockIndex >= 0) {
          state.toolIndexByBlock.set(safeBlockIndex, toolCallIndex);
        }
        writeOpenAIStreamChunk(
          res,
          state,
          {
            tool_calls: [
              {
                index: toolCallIndex,
                id:
                  typeof block.id === "string" && block.id
                    ? block.id
                    : `call_${Date.now()}_${toolCallIndex}`,
                type: "function",
                function: {
                  name: typeof block.name === "string" ? block.name : "tool",
                  arguments: "",
                },
              },
            ],
          },
          null,
        );
      }
      return;
    }

    if (eventName === "content_block_delta") {
      const delta = payload.delta;
      if (!delta || typeof delta !== "object") {
        return;
      }
      ensureRoleChunk();

      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        writeOpenAIStreamChunk(res, state, { content: delta.text }, null);
        return;
      }

      if (delta.type === "input_json_delta") {
        const blockIndex = Number(payload.index);
        const toolCallIndex = state.toolIndexByBlock.get(blockIndex);
        if (
          Number.isFinite(toolCallIndex) &&
          typeof delta.partial_json === "string" &&
          delta.partial_json
        ) {
          writeOpenAIStreamChunk(
            res,
            state,
            {
              tool_calls: [
                {
                  index: toolCallIndex,
                  function: {
                    arguments: delta.partial_json,
                  },
                },
              ],
            },
            null,
          );
        }
      }
      return;
    }

    if (eventName === "message_delta") {
      const finishReason = mapAnthropicStopReasonToOpenAI(
        payload?.delta?.stop_reason,
      );
      if (!state.finished) {
        writeOpenAIStreamChunk(res, state, {}, finishReason);
        state.finished = true;
      }
      return;
    }

    if (eventName === "message_stop") {
      finalizeOpenAIStream(res, state, "stop");
    }
  };

  const consumeFrames = () => {
    let boundaryMatch = frameBuffer.match(/\r?\n\r?\n/);
    while (boundaryMatch && typeof boundaryMatch.index === "number") {
      const boundaryIndex = boundaryMatch.index;
      const boundaryLength = boundaryMatch[0].length;
      const frame = frameBuffer.slice(0, boundaryIndex);
      frameBuffer = frameBuffer.slice(boundaryIndex + boundaryLength);
      processFrame(frame);
      boundaryMatch = frameBuffer.match(/\r?\n\r?\n/);
    }
  };

  proxyRes.on("data", (chunk) => {
    frameBuffer += chunk.toString();
    consumeFrames();
  });

  const finishStream = () => {
    if (streamCompleted) {
      return;
    }
    streamCompleted = true;
    if (frameBuffer.trim()) {
      processFrame(frameBuffer);
      frameBuffer = "";
    }
    finalizeOpenAIStream(res, state, "stop");
    res.end();
    onComplete();
  };

  proxyRes.on("end", finishStream);
  proxyRes.on("close", finishStream);
}

function handleProxyRequest(req, res, logCallback) {
  const requestStartedAt = Date.now();
  const requestId = createRequestId(req);
  const appConfig = configProvider() || {};
  const mainMapping = appConfig.mapping?.main || "pass";
  const providerConfig = getProviderConfig(
    mainMapping,
    appConfig.providers || {},
  );

  if (!providerConfig) {
    const errorMsg =
      mainMapping === "pass"
        ? "透传模式未实现，请配置目标 Provider"
        : `未找到 Provider 配置: ${mainMapping}`;

    logProxy(logCallback, "error", `[ERR][${requestId}] ${errorMsg}`);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: errorMsg, requestId }));
    return;
  }

  let body = "";
  let endHandled = false;
  let proxyReq = null;

  req.on("aborted", () => {
    if (proxyReq && !proxyReq.destroyed) {
      proxyReq.destroy(new Error("client aborted"));
    }
  });

  req.on("error", (error) => {
    const errorMessage = String(error?.message || "unknown error");
    logProxy(
      logCallback,
      "error",
      `[ERR][${requestId}] 读取请求体失败: ${errorMessage}`,
    );
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: `读取请求体失败: ${errorMessage}`, requestId }),
      );
    }
  });

  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    if (endHandled) {
      return;
    }
    endHandled = true;

    try {
      const receiveDoneAt = Date.now();
      const receiveMs = receiveDoneAt - requestStartedAt;
      const originalBaseUrl = String(providerConfig.baseUrl || "").replace(
        /\/$/,
        "",
      );
      const baseUrl = normalizeBaseUrlForDocker(originalBaseUrl);
      const incomingUrl = parseRequestUrl(req.url);
      const incomingPathname = normalizePathname(incomingUrl.pathname);
      const incomingSearch = String(incomingUrl.search || "");

      let finalBody = body;
      let modelDisplay = providerConfig.modelName || "unknown";
      let openAICompatMode = null;
      let openAIStreamRequested = false;
      const contentType = readHeaderValue(
        req.headers,
        "content-type",
      ).toLowerCase();
      const trimmedBody = String(body || "").trim();
      const hasBody = Boolean(trimmedBody);
      const isJsonLikeBody =
        hasBody &&
        (contentType.includes("application/json") ||
          trimmedBody.startsWith("{") ||
          trimmedBody.startsWith("["));
      let upstreamPathname = incomingPathname;
      let parsedBody = null;

      let rewriteMs = 0;
      if (isJsonLikeBody) {
        try {
          parsedBody = JSON.parse(body);
        } catch (_error) {
          parsedBody = null;
        }
      }

      const shouldUseOpenAICompat =
        isOpenAIChatCompletionsPath(incomingPathname) &&
        isAnthropicCompatibleProvider(providerConfig);
      if (shouldUseOpenAICompat && parsedBody && typeof parsedBody === "object") {
        const rewriteStartedAt = Date.now();
        const originalModel = parsedBody.model;
        const convertedBody = convertOpenAIChatRequestToAnthropic(
          parsedBody,
          providerConfig.modelName,
        );
        finalBody = JSON.stringify(convertedBody);
        modelDisplay = originalModel || providerConfig.modelName || modelDisplay;
        upstreamPathname = "/v1/messages";
        openAICompatMode = "chat_completions";
        openAIStreamRequested = convertedBody.stream === true;
        rewriteMs = Date.now() - rewriteStartedAt;
      } else if (
        Boolean(providerConfig.modelName) &&
        parsedBody &&
        typeof parsedBody === "object"
      ) {
        const rewriteStartedAt = Date.now();
        modelDisplay = parsedBody.model || providerConfig.modelName || modelDisplay;
        if (parsedBody.model !== providerConfig.modelName) {
          parsedBody.model = providerConfig.modelName;
          finalBody = JSON.stringify(parsedBody);
        }
        rewriteMs = Date.now() - rewriteStartedAt;
      }

      const reqPath = `${String(upstreamPathname || "/").replace(/^\/+/, "")}${incomingSearch}`;
      const targetUrl = new URL(`${baseUrl}/${reqPath}`);
      const targetPath = targetUrl.pathname + targetUrl.search;

      if (openAICompatMode === "chat_completions") {
        logProxy(
          logCallback,
          "info",
          `[MAP][${requestId}] OpenAI chat/completions -> Anthropic messages`,
        );
      }

      if (openAICompatMode === "chat_completions" && !openAIStreamRequested) {
        try {
          const parsedFinalBody = JSON.parse(String(finalBody || "{}"));
          openAIStreamRequested = parsedFinalBody?.stream === true;
        } catch (_error) {
          openAIStreamRequested = false;
        }
      }

      const dedupClientKey = getCallerFingerprint(req);
      const idempotencyKey = sanitizeTraceValue(
        readHeaderValue(req.headers, "idempotency-key"),
      );
      const dedupBodyKey = idempotencyKey || getBodyHash(finalBody);
      const dedupKey = `${dedupClientKey}|${req.method || "GET"}|${targetPath}|${providerConfig.modelName || "unknown"}|${dedupBodyKey}`;
      if (isDuplicateAndMark(dedupKey, receiveDoneAt)) {
        logProxy(
          logCallback,
          "warn",
          `[DUP][${requestId}] 命中去重窗口，已拒绝重复转发 | key=${dedupKey}`,
        );
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "检测到短时间重复请求，已阻止重复转发",
            requestId,
          }),
        );
        return;
      }

      const headers = { ...req.headers };

      delete headers.host;
      delete headers["content-length"];
      delete headers.connection;
      delete headers["transfer-encoding"];
      delete headers.authorization;
      delete headers["proxy-authorization"];
      delete headers["x-api-key"];
      delete headers["anthropic-api-key"];
      delete headers["x-forwarded-for"];
      delete headers["x-forwarded-host"];
      delete headers["x-forwarded-proto"];
      delete headers.forwarded;
      delete headers["x-real-ip"];

      headers.host = targetUrl.host;
      headers["x-request-id"] = requestId;
      if (providerConfig.apiKey) {
        headers["x-api-key"] = providerConfig.apiKey;
        headers.authorization = `Bearer ${providerConfig.apiKey}`;
      }

      const shouldAttachAnthropicVersion =
        openAICompatMode === "chat_completions" ||
        /\/v1\/messages(?:\?|$)/.test(targetPath);
      if (shouldAttachAnthropicVersion && !headers["anthropic-version"]) {
        headers["anthropic-version"] = "2023-06-01";
      }
      if (!headers["content-type"] && finalBody) {
        headers["content-type"] = "application/json";
      }

      if (finalBody && finalBody.length > 0) {
        headers["content-length"] = String(Buffer.byteLength(finalBody));
      }

      const isHttps = targetUrl.protocol === "https:";
      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetPath,
        method: req.method,
        headers,
        agent: isHttps ? httpsAgent : httpAgent,
      };

      logProxy(
        logCallback,
        "info",
        `[REQ][${requestId}] ${req.method} ${targetUrl.toString()} | Model: ${modelDisplay} | receive_ms=${receiveMs} rewrite_ms=${rewriteMs}`,
      );

      const protocol = isHttps ? https : http;
      const upstreamStartedAt = Date.now();
      let hasForwarded = false;

      proxyReq = protocol.request(options, (proxyRes) => {
        if (hasForwarded) {
          return;
        }
        hasForwarded = true;

        const upstreamWaitMs = Date.now() - upstreamStartedAt;
        const reusedSocket = Boolean(proxyReq?.reusedSocket);

        if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
          logProxy(
            logCallback,
            "error",
            `[ERR][${requestId}] Upstream ${proxyRes.statusCode} | upstream_wait_ms=${upstreamWaitMs}`,
          );
        }

        let responseLogged = false;
        const logResponseOnce = () => {
          if (responseLogged) {
            return;
          }
          responseLogged = true;
          const totalMs = Date.now() - requestStartedAt;
          logProxy(
            logCallback,
            "info",
            `[RES][${requestId}] status=${proxyRes.statusCode || 200} total_ms=${totalMs} upstream_wait_ms=${upstreamWaitMs} keep_alive_reused=${reusedSocket ? 1 : 0}`,
          );
        };

        const responseContentType = readHeaderValue(
          proxyRes.headers,
          "content-type",
        ).toLowerCase();

        if (openAICompatMode === "chat_completions") {
          const isStreamResponse =
            openAIStreamRequested ||
            responseContentType.includes("text/event-stream");

          if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
            let errorBody = "";
            proxyRes.on("data", (chunk) => {
              errorBody += chunk.toString();
            });
            proxyRes.on("end", () => {
              const errorPayload = getOpenAIErrorPayload(
                proxyRes.statusCode,
                errorBody,
              );
              res.writeHead(proxyRes.statusCode, {
                "Content-Type": "application/json",
              });
              res.end(JSON.stringify(errorPayload));
              logResponseOnce();
            });
            proxyRes.on("close", logResponseOnce);
            return;
          }

          if (isStreamResponse) {
            proxyAnthropicStreamAsOpenAI(
              proxyRes,
              res,
              providerConfig.modelName,
              logResponseOnce,
            );
            return;
          }

          let responseBody = "";
          proxyRes.on("data", (chunk) => {
            responseBody += chunk.toString();
          });
          proxyRes.on("end", () => {
            let responsePayload = responseBody;
            try {
              const parsedResponse = JSON.parse(responseBody);
              responsePayload = JSON.stringify(
                convertAnthropicMessageToOpenAIResponse(
                  parsedResponse,
                  providerConfig.modelName,
                ),
              );
            } catch (_error) {
              // 上游返回非 JSON 时透传原始内容，保证不中断
            }

            res.writeHead(proxyRes.statusCode || 200, {
              "Content-Type": "application/json",
            });
            res.end(responsePayload);
            logResponseOnce();
          });
          proxyRes.on("close", logResponseOnce);
          return;
        }

        proxyRes.on("end", logResponseOnce);
        proxyRes.on("close", logResponseOnce);
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
        const timeoutError = new Error(
          `upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`,
        );
        timeoutError.code = "ETIMEDOUT";
        proxyReq.destroy(timeoutError);
      });

      proxyReq.on("error", (error) => {
        const hint = buildProxyErrorHint(error, originalBaseUrl, targetUrl);
        const errorMessage =
          String(error?.message || "").trim() ||
          String(error?.code || "").trim() ||
          "unknown error";
        const detail = hint ? `${errorMessage} | ${hint}` : errorMessage;
        const totalMs = Date.now() - requestStartedAt;

        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          if (openAICompatMode === "chat_completions") {
            res.end(
              JSON.stringify({
                error: {
                  message: "Proxy Error: upstream request failed",
                  type: "upstream_error",
                  code: "upstream_request_failed",
                },
              }),
            );
          } else {
            res.end(
              JSON.stringify({
                error: "Proxy Error: upstream request failed",
                requestId,
              }),
            );
          }
        }

        logProxy(
          logCallback,
          "error",
          `[ERR][${requestId}] 请求失败: ${detail} | total_ms=${totalMs}`,
        );
      });

      if (finalBody && finalBody.length > 0) {
        proxyReq.write(finalBody);
      }
      proxyReq.end();
    } catch (error) {
      const errorMessage = String(error?.message || "unknown error");
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "代理请求处理失败",
            requestId,
          }),
        );
      }

      logProxy(
        logCallback,
        "error",
        `[ERR][${requestId}] 代理请求处理失败: ${errorMessage}`,
      );
    }
  });
}

function startProxyServer(port, logCallback) {
  return new Promise((resolve) => {
    if (server) {
      resolve({ success: false, error: "服务器已在运行", port: currentPort });
      return;
    }

    server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, x-api-key, anthropic-version, authorization, x-request-id, x-correlation-id, idempotency-key, openai-organization, openai-project",
      );

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      handleProxyRequest(req, res, logCallback);
    });

    server.listen(port, () => {
      currentPort = port;
      logProxy(logCallback, "info", `代理服务器已启动，监听端口 ${port}`);
      resolve({ success: true, port });
    });

    server.on("error", (error) => {
      server = null;
      resolve({ success: false, error: error.message, port });
    });
  });
}

function stopProxyServer(logCallback) {
  return new Promise((resolve) => {
    if (!server) {
      resolve({ success: true });
      return;
    }

    server.close(() => {
      server = null;
      logProxy(logCallback, "info", "代理服务器已停止");
      resolve({ success: true });
    });
  });
}

function getProxyStatus() {
  return {
    running: server !== null,
    port: currentPort,
  };
}

module.exports = {
  setConfigProvider,
  startProxyServer,
  stopProxyServer,
  getProxyStatus,
};

use std::{
    convert::Infallible,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use async_stream::stream;
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderValue, Method, Response, StatusCode, Uri},
    routing::any,
    Router,
};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use uuid::Uuid;

use crate::{
    config::{ConfigStore, BUILTIN_PROVIDER_KEYS},
    openai,
    types::{
        AppConfig, ConfigUpdatedPayload, CustomHeader, ProxyCommandResult, ProxyLogPayload,
        ProxyStatusPayload, RouterTarget, TestProviderModelRequest, TestProviderModelResponse,
        TokenUsagePayload, TokenUsageRecord, ROUTING_MODE_ROUTES,
    },
};

const UPSTREAM_TIMEOUT_MS: u64 = 120_000;
const MAX_PROXY_LOGS: usize = 500;
const MAX_TOKEN_RECORDS: usize = 10_000;
const DOCKER_HOST_ALIAS: &str = "host.docker.internal";

#[derive(Clone)]
pub struct ProxyManager {
    app_handle: AppHandle,
    config_store: Arc<ConfigStore>,
    logs: Arc<Mutex<Vec<ProxyLogPayload>>>,
    token_records: Arc<Mutex<Vec<TokenUsageRecord>>>,
    token_records_path: Arc<PathBuf>,
    client: Client,
    current_port: Arc<Mutex<u16>>,
    server_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl ProxyManager {
    pub fn new(
        app_handle: AppHandle,
        config_store: Arc<ConfigStore>,
        data_dir: PathBuf,
    ) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .pool_max_idle_per_host(20)
            .build()
            .map_err(|err| err.to_string())?;
        let token_records_path = data_dir.join("token-usage.json");
        let token_records = load_token_records(&token_records_path);

        let configured_port = config_store.get_config().settings.proxy_port;

        Ok(Self {
            app_handle,
            config_store,
            logs: Arc::new(Mutex::new(Vec::new())),
            token_records: Arc::new(Mutex::new(token_records)),
            token_records_path: Arc::new(token_records_path),
            client,
            current_port: Arc::new(Mutex::new(configured_port)),
            server_task: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        })
    }

    fn configured_port(&self) -> u16 {
        self.config_store.get_config().settings.proxy_port
    }

    fn persist_proxy_port(&self, port: u16) {
        if self.configured_port() == port {
            return;
        }

        if self
            .config_store
            .set_value(
                "settings.proxyPort",
                serde_json::Value::Number(serde_json::Number::from(port)),
            )
            .is_ok()
        {
            let _ = self.app_handle.emit(
                "config-updated",
                ConfigUpdatedPayload {
                    key: "settings.proxyPort".to_string(),
                    updated_at: chrono::Utc::now().timestamp_millis(),
                },
            );
        }
    }

    pub fn get_status(&self) -> ProxyStatusPayload {
        let running = self
            .server_task
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        let port = if running {
            self.current_port
                .lock()
                .map(|guard| *guard)
                .unwrap_or_else(|_| self.configured_port())
        } else {
            self.configured_port()
        };
        ProxyStatusPayload { running, port }
    }

    pub fn get_logs(&self) -> Vec<ProxyLogPayload> {
        self.logs
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn get_token_usage_records(&self) -> Vec<TokenUsageRecord> {
        self.token_records
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn emit_log(&self, kind: &str, message: impl Into<String>) {
        self.emit_log_payload(ProxyLogPayload {
            message: message.into(),
            r#type: kind.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            request_id: None,
            provider_id: None,
            provider_label: None,
            model: None,
            route_kind: None,
            token_usage: None,
            status_code: None,
            upstream_url: None,
            upstream_body_preview: None,
            error_stage: None,
            duration_ms: None,
        });
    }

    pub fn record_token_usage(
        &self,
        request_id: &str,
        provider_id: &str,
        provider_label: &str,
        model: &str,
        token_usage: TokenUsagePayload,
    ) {
        let now = Utc::now();
        let record = TokenUsageRecord {
            request_id: request_id.to_string(),
            provider_id: provider_id.trim().to_string(),
            provider_label: provider_label.trim().to_string(),
            model: model.trim().to_string(),
            input_tokens: token_usage.input_tokens,
            output_tokens: token_usage.output_tokens,
            total_tokens: token_usage.total_tokens,
            timestamp: now.to_rfc3339(),
            timestamp_ms: now.timestamp_millis(),
        };
        if let Ok(mut guard) = self.token_records.lock() {
            guard.push(record);
            if guard.len() > MAX_TOKEN_RECORDS {
                let overflow = guard.len() - MAX_TOKEN_RECORDS;
                guard.drain(0..overflow);
            }
            if let Err(err) = persist_token_records(&self.token_records_path, &guard) {
                self.emit_log("error", format!("持久化 token 统计失败: {err}"));
            }
        }

        let message = format!(
            "[TOKENS][{request_id}] provider={} model={} input={} output={} total={}",
            if provider_label.trim().is_empty() {
                provider_id.trim()
            } else {
                provider_label.trim()
            },
            if model.trim().is_empty() {
                "unknown"
            } else {
                model.trim()
            },
            token_usage.input_tokens,
            token_usage.output_tokens,
            token_usage.total_tokens,
        );
        self.emit_log_payload(ProxyLogPayload {
            message,
            r#type: "info".to_string(),
            timestamp: now.to_rfc3339(),
            request_id: Some(request_id.to_string()),
            provider_id: Some(provider_id.trim().to_string()),
            provider_label: Some(provider_label.trim().to_string()),
            model: Some(model.trim().to_string()),
            route_kind: None,
            token_usage: Some(token_usage),
            status_code: None,
            upstream_url: None,
            upstream_body_preview: None,
            error_stage: None,
            duration_ms: None,
        });
    }

    fn emit_log_payload(&self, payload: ProxyLogPayload) {
        let payload = ProxyLogPayload {
            message: payload.message,
            r#type: payload.r#type,
            timestamp: payload.timestamp,
            request_id: payload.request_id,
            provider_id: payload.provider_id,
            provider_label: payload.provider_label,
            model: payload.model,
            route_kind: payload.route_kind,
            token_usage: payload.token_usage,
            status_code: payload.status_code,
            upstream_url: payload.upstream_url,
            upstream_body_preview: payload.upstream_body_preview,
            error_stage: payload.error_stage,
            duration_ms: payload.duration_ms,
        };

        if let Ok(mut guard) = self.logs.lock() {
            guard.push(payload.clone());
            if guard.len() > MAX_PROXY_LOGS {
                let overflow = guard.len() - MAX_PROXY_LOGS;
                guard.drain(0..overflow);
            }
        }

        let _ = self.app_handle.emit("proxy-log", payload);
    }

    pub async fn clear_logs(&self) {
        if let Ok(mut guard) = self.logs.lock() {
            guard.clear();
        }
    }

    pub async fn clear_token_usage_records(&self) {
        if let Ok(mut guard) = self.token_records.lock() {
            guard.clear();
            let _ = persist_token_records(&self.token_records_path, &guard);
        }
    }

    pub async fn start(&self, port: u16) -> ProxyCommandResult {
        if self
            .server_task
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
        {
            return ProxyCommandResult {
                success: true,
                port: self.current_port.lock().map(|guard| *guard).unwrap_or(port),
                error: None,
                already_running: Some(true),
            };
        }

        let (listener, actual_port, fallback_message) = match TcpListener::bind(("127.0.0.1", port))
            .await
        {
            Ok(listener) => (listener, port, None),
            Err(err) => match TcpListener::bind(("127.0.0.1", 0)).await {
                Ok(listener) => {
                    let fallback_port = listener
                        .local_addr()
                        .map(|address| address.port())
                        .unwrap_or(port);
                    (
                            listener,
                            fallback_port,
                            Some(format!(
                                "配置端口 {port} 绑定失败（{err}），已自动切换到可用端口 {fallback_port}"
                            )),
                        )
                }
                Err(fallback_err) => {
                    return ProxyCommandResult {
                        success: false,
                        port,
                        error: Some(format!("{err}; fallback bind failed: {fallback_err}")),
                        already_running: None,
                    };
                }
            },
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let state = self.clone();
        let app = Router::new()
            .fallback(any(proxy_handler))
            .with_state(state.clone());

        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        if let Ok(mut guard) = self.current_port.lock() {
            *guard = actual_port;
        }
        if let Ok(mut guard) = self.shutdown_tx.lock() {
            *guard = Some(shutdown_tx);
        }
        if let Ok(mut guard) = self.server_task.lock() {
            *guard = Some(task);
        }

        if let Some(message) = fallback_message {
            self.persist_proxy_port(actual_port);
            self.emit_log("warn", message);
        }

        self.emit_log("info", format!("代理服务器已启动，监听端口 {actual_port}"));

        ProxyCommandResult {
            success: true,
            port: actual_port,
            error: None,
            already_running: None,
        }
    }

    pub async fn test_provider_model(
        &self,
        request: TestProviderModelRequest,
    ) -> TestProviderModelResponse {
        let started = Instant::now();
        let provider_id = request.provider_id.trim().to_string();
        let requested_model = request.model.trim().to_string();
        let prompt = request.prompt.trim();

        if provider_id.is_empty() {
            return test_response(
                false,
                provider_id,
                String::new(),
                requested_model,
                started,
                None,
                Some("providerId 不能为空".to_string()),
                None,
            );
        }
        if requested_model.is_empty() {
            return test_response(
                false,
                provider_id,
                String::new(),
                requested_model,
                started,
                None,
                Some("模型名不能为空".to_string()),
                None,
            );
        }
        if prompt.is_empty() {
            return test_response(
                false,
                provider_id,
                String::new(),
                requested_model,
                started,
                None,
                Some("测试语句不能为空".to_string()),
                None,
            );
        }

        let config = self.config_store.get_config();
        let provider_label = match validate_test_provider(&config, &provider_id, &requested_model) {
            Ok(label) => label,
            Err(message) => {
                return test_response(
                    false,
                    provider_id,
                    String::new(),
                    requested_model,
                    started,
                    None,
                    Some(message),
                    None,
                )
            }
        };

        let mut provider = match build_provider_config(
            &config,
            &provider_id,
            &requested_model,
            None,
            None,
            Some(&provider_label),
        ) {
            Ok(provider) => provider,
            Err(message) => {
                return test_response(
                    false,
                    provider_id,
                    provider_label,
                    requested_model,
                    started,
                    None,
                    Some(message),
                    None,
                )
            }
        };

        if provider.base_url.trim().is_empty() {
            return test_response(
                false,
                provider_id,
                provider_label,
                requested_model,
                started,
                None,
                Some("Provider 未配置代理地址".to_string()),
                None,
            );
        }

        let needs_1m_beta = provider.model_name.to_lowercase().contains("[1m]");
        if needs_1m_beta {
            provider.model_name = strip_1m_suffix(&provider.model_name);
        }

        let openai_body = json!({
            "model": provider.model_name.clone(),
            "messages": [{ "role": "user", "content": prompt }],
            "max_tokens": 64,
            "temperature": 0
        });
        let anthropic_compat =
            openai::is_anthropic_compatible_provider(&provider.provider_id, &provider.base_url);
        let (target_url, body) = if anthropic_compat {
            (
                test_messages_url(&provider.base_url),
                openai::convert_openai_chat_request_to_anthropic(
                    &openai_body,
                    &provider.model_name,
                ),
            )
        } else {
            (test_chat_completions_url(&provider.base_url), openai_body)
        };

        let mut builder = self.client.post(&target_url).json(&body);
        if !provider.api_key.is_empty() {
            builder = builder
                .header("x-api-key", &provider.api_key)
                .bearer_auth(&provider.api_key);
        }
        if anthropic_compat {
            builder = builder.header("anthropic-version", "2023-06-01");
        }
        if needs_1m_beta {
            builder = builder.header("anthropic-beta", "context-1m-2025-08-07");
        }
        for header in &provider.custom_headers {
            let name = header.name.trim();
            if name.is_empty() || skip_test_header(name) {
                continue;
            }
            builder = builder.header(name, header.value.as_str());
        }

        let response = match builder.send().await {
            Ok(response) => response,
            Err(err) => {
                let hint = build_proxy_error_hint(&err, &provider.base_url);
                let message = if hint.is_empty() {
                    err.to_string()
                } else {
                    format!("{} | {}", err, hint)
                };
                return test_response(
                    false,
                    provider_id,
                    provider_label,
                    requested_model,
                    started,
                    None,
                    Some(message),
                    None,
                );
            }
        };

        let status = response.status();
        let status_code = status.as_u16();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return test_response(
                false,
                provider_id,
                provider_label,
                requested_model,
                started,
                None,
                Some(format!(
                    "上游返回 HTTP {status_code}: {}",
                    truncate_text(text.trim(), 500)
                )),
                Some(status_code),
            );
        }

        let output = extract_test_output(&text);
        if output.is_empty() {
            return test_response(
                false,
                provider_id,
                provider_label,
                requested_model,
                started,
                None,
                Some("上游响应为空".to_string()),
                Some(status_code),
            );
        }

        test_response(
            true,
            provider_id,
            provider_label,
            requested_model,
            started,
            Some(output),
            None,
            Some(status_code),
        )
    }

    pub async fn stop(&self) {
        if let Ok(mut guard) = self.shutdown_tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
        let task = if let Ok(mut guard) = self.server_task.lock() {
            guard.take()
        } else {
            None
        };
        if let Some(task) = task {
            let _ = task.await;
        }
        self.emit_log("info", "代理服务器已停止");
    }
}

#[derive(Debug, Clone)]
struct ResolvedProviderConfig {
    provider_id: String,
    provider_label: String,
    base_url: String,
    api_key: String,
    model_name: String,
    resolution_source: &'static str,
    route_id: Option<String>,
    source_model: Option<String>,
    custom_headers: Vec<CustomHeader>,
    strip_fields: Vec<String>,
}

fn test_response(
    ok: bool,
    provider_id: String,
    provider_label: String,
    model: String,
    started: Instant,
    output: Option<String>,
    error: Option<String>,
    status_code: Option<u16>,
) -> TestProviderModelResponse {
    TestProviderModelResponse {
        ok,
        provider_id,
        provider_label,
        model,
        latency_ms: started.elapsed().as_millis(),
        output,
        error,
        status_code,
    }
}

fn validate_test_provider(
    config: &AppConfig,
    provider_id: &str,
    model: &str,
) -> Result<String, String> {
    if let Some(provider) = config
        .providers
        .custom_providers
        .iter()
        .find(|item| item.id == provider_id)
    {
        if !provider.provider.enabled {
            return Err(format!("Provider {} 未启用", provider.name));
        }
        if !provider_has_model(&provider.provider.models, model) {
            return Err(format!("Provider {} 未配置模型 {model}", provider.name));
        }
        return Ok(provider.name.clone());
    }

    let (label, provider) = match provider_id {
        "anthropic" => ("Anthropic", &config.providers.anthropic),
        "glm" => ("GLM", &config.providers.glm),
        "kimi" => ("Kimi", &config.providers.kimi),
        "minimax" => ("MiniMax", &config.providers.minimax),
        "deepseek" => ("DeepSeek", &config.providers.deepseek),
        "litellm" => ("LiteLLM", &config.providers.litellm),
        "cliproxyapi" => ("CLI Proxy API", &config.providers.cliproxyapi),
        _ => return Err(format!("未找到 Provider: {provider_id}")),
    };

    if !provider.enabled {
        return Err(format!("Provider {label} 未启用"));
    }
    if !provider_has_model(&provider.models, model) {
        return Err(format!("Provider {label} 未配置模型 {model}"));
    }
    Ok(label.to_string())
}

fn provider_has_model(models: &[String], model: &str) -> bool {
    let target = normalize_route_match_model(model);
    !target.is_empty()
        && models
            .iter()
            .any(|item| normalize_route_match_model(item) == target)
}

fn strip_1m_suffix(model: &str) -> String {
    model
        .replace("[1m]", "")
        .replace("[1M]", "")
        .trim()
        .to_string()
}

fn test_chat_completions_url(base_url: &str) -> String {
    let base = normalize_base_url_for_docker(base_url)
        .trim_end_matches('/')
        .to_string();
    let lower = base.to_lowercase();
    if lower.ends_with("/chat/completions") {
        base
    } else if lower.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

fn test_messages_url(base_url: &str) -> String {
    let base = normalize_base_url_for_docker(base_url)
        .trim_end_matches('/')
        .to_string();
    let lower = base.to_lowercase();
    if lower.ends_with("/messages") {
        base
    } else if lower.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

fn skip_test_header(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "host"
            | "content-length"
            | "content-type"
            | "connection"
            | "transfer-encoding"
            | "authorization"
            | "proxy-authorization"
            | "x-api-key"
            | "anthropic-api-key"
            | "anthropic-beta"
            | "x-request-id"
    )
}

fn extract_test_output(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return truncate_text(trimmed, 500);
    };

    if let Some(text) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("message"))
        .and_then(|message| message.get("content"))
        .map(text_from_content_value)
        .filter(|text| !text.is_empty())
    {
        return text;
    }

    if let Some(text) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .map(text_from_content_value)
        .filter(|text| !text.is_empty())
    {
        return text;
    }

    if let Some(text) = value
        .get("content")
        .map(text_from_content_value)
        .filter(|text| !text.is_empty())
    {
        return text;
    }

    truncate_text(trimmed, 500)
}

fn text_from_content_value(value: &Value) -> String {
    match value {
        Value::String(text) => truncate_text(text.trim(), 500),
        Value::Array(items) => truncate_text(
            &items
                .iter()
                .map(text_from_content_value)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            500,
        ),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .map(text_from_content_value)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn upstream_error_preview(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        let error = value.get("error");
        let message = error
            .and_then(|item| item.get("message"))
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .map(|text| truncate_text(text, 200));
        let kind = error
            .and_then(|item| item.get("type"))
            .and_then(Value::as_str)
            .or_else(|| value.get("type").and_then(Value::as_str));
        let code = error
            .and_then(|item| item.get("code"))
            .and_then(Value::as_str)
            .or_else(|| value.get("code").and_then(Value::as_str));

        let mut parts = Vec::new();
        if let Some(kind) = kind.filter(|item| !item.is_empty()) {
            parts.push(format!("type={}", truncate_text(kind, 80)));
        }
        if let Some(code) = code.filter(|item| !item.is_empty()) {
            parts.push(format!("code={}", truncate_text(code, 80)));
        }
        if let Some(message) = message.filter(|item| !item.is_empty()) {
            parts.push(format!("message={message}"));
        }
        if !parts.is_empty() {
            return parts.join("; ");
        }
    }

    "上游返回了非 JSON 错误体，已隐藏正文".to_string()
}

fn sanitize_logged_url(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or(url).to_string()
}

fn truncate_text(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let mut chars = trimmed.chars();
    let mut output = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        output.push('…');
    }
    output
}

fn resolution_source_to_route_kind(source: &str) -> Option<String> {
    if let Some(kind) = source.strip_prefix("router:") {
        return Some(kind.to_string());
    }

    match source {
        "modelRoute" => Some("modelRoute".to_string()),
        "providerInference" => Some("providerInference".to_string()),
        "legacyMapping" => Some("legacyMapping".to_string()),
        _ => None,
    }
}

fn load_token_records(path: &Path) -> Vec<TokenUsageRecord> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<TokenUsageRecord>>(&raw)
        .map(trim_token_records)
        .unwrap_or_default()
}

fn persist_token_records(path: &Path, records: &[TokenUsageRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(records).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn trim_token_records(mut records: Vec<TokenUsageRecord>) -> Vec<TokenUsageRecord> {
    if records.len() > MAX_TOKEN_RECORDS {
        let overflow = records.len() - MAX_TOKEN_RECORDS;
        records.drain(0..overflow);
    }
    records
}

async fn proxy_handler(
    State(manager): State<ProxyManager>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    if method == Method::OPTIONS {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::OK;
        add_cors_headers(response.headers_mut());
        return response;
    }

    let request_id = create_request_id(&headers);
    let request_started = Instant::now();
    let body_text = String::from_utf8(body.to_vec()).unwrap_or_default();
    let content_type = read_header_value(&headers, "content-type").to_lowercase();
    let is_json_like_body = !body_text.trim().is_empty()
        && (content_type.contains("application/json")
            || body_text.trim_start().starts_with('{')
            || body_text.trim_start().starts_with('['));
    let parsed_body = if is_json_like_body {
        serde_json::from_str::<serde_json::Value>(&body_text).ok()
    } else {
        None
    };
    let requested_model = parsed_body
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    let app_config = manager.config_store.get_config();
    let resolution =
        resolve_request_provider_config(&app_config, &requested_model, parsed_body.as_ref());
    let mut provider = match resolution {
        Ok(provider) => provider,
        Err(message) => {
            manager.emit_log_payload(ProxyLogPayload {
                message: format!(
                    "[ERR][{request_id}] {message} | requested_model={}",
                    if requested_model.is_empty() {
                        "(empty)"
                    } else {
                        &requested_model
                    }
                ),
                r#type: "error".to_string(),
                timestamp: Utc::now().to_rfc3339(),
                request_id: Some(request_id.clone()),
                provider_id: None,
                provider_label: None,
                model: Some(if requested_model.is_empty() {
                    "unknown".to_string()
                } else {
                    requested_model.clone()
                }),
                route_kind: None,
                token_usage: None,
                status_code: Some(StatusCode::BAD_REQUEST.as_u16()),
                upstream_url: None,
                upstream_body_preview: None,
                error_stage: Some("routeResolution".to_string()),
                duration_ms: Some(request_started.elapsed().as_millis() as u64),
            });
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": message,
                    "requestId": request_id
                }),
            );
        }
    };

    // `[1m]` 后缀处理：虚拟变体，剥离后发上游，并在 anthropic-beta 注入 context-1m-2025-08-07。
    // new-api 不认识带 [1m] 的模型名，会 nil 指针 panic。
    let needs_1m_beta = provider.model_name.to_lowercase().contains("[1m]");
    if needs_1m_beta {
        let cleaned = provider
            .model_name
            .replace("[1m]", "")
            .replace("[1M]", "")
            .trim()
            .to_string();
        provider.model_name = cleaned;
    }

    let route_kind = resolution_source_to_route_kind(provider.resolution_source);
    let emit_request_log = |kind: &str, message: String| {
        manager.emit_log_payload(ProxyLogPayload {
            message,
            r#type: kind.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            request_id: Some(request_id.clone()),
            provider_id: Some(provider.provider_id.clone()),
            provider_label: Some(provider.provider_label.clone()),
            model: Some(provider.model_name.clone()),
            route_kind: route_kind.clone(),
            token_usage: None,
            status_code: None,
            upstream_url: None,
            upstream_body_preview: None,
            error_stage: None,
            duration_ms: Some(request_started.elapsed().as_millis() as u64),
        });
    };

    if provider.resolution_source == "modelRoute" {
        emit_request_log(
            "info",
            format!(
                "[ROUTE][{request_id}] model_route_hit route={} source={} target={} provider={}",
                provider
                    .route_id
                    .clone()
                    .unwrap_or_else(|| "unknown".into()),
                provider
                    .source_model
                    .clone()
                    .unwrap_or_else(|| requested_model.clone()),
                if provider.model_name.is_empty() {
                    "(empty)"
                } else {
                    &provider.model_name
                },
                provider.provider_label
            ),
        );
    } else if provider.resolution_source.starts_with("router:") {
        emit_request_log(
            "info",
            format!(
                "[ROUTE][{request_id}] category_hit category={} target={} provider={} requested_model={}",
                provider.resolution_source.trim_start_matches("router:"),
                if provider.model_name.is_empty() { "(empty)" } else { &provider.model_name },
                provider.provider_label,
                if requested_model.is_empty() { "(empty)" } else { &requested_model }
            ),
        );
    } else if provider.resolution_source == "providerInference" {
        emit_request_log(
            "info",
            format!(
                "[ROUTE][{request_id}] provider_inferred provider={} requested_model={}",
                provider.provider_label,
                if requested_model.is_empty() {
                    "(empty)"
                } else {
                    &requested_model
                }
            ),
        );
    } else {
        emit_request_log(
            "info",
            format!(
                "[ROUTE][{request_id}] legacy_fallback requested_model={}",
                if requested_model.is_empty() {
                    "(empty)"
                } else {
                    &requested_model
                }
            ),
        );
    }

    let incoming_path = normalize_path(uri.path());
    let incoming_search = uri
        .path_and_query()
        .map(|value| value.as_str())
        .and_then(|value| {
            value
                .split_once('?')
                .map(|(_, search)| format!("?{search}"))
        })
        .unwrap_or_default();

    let provider_uses_anthropic_compat =
        openai::is_anthropic_compatible_provider(&provider.provider_id, &provider.base_url);
    let should_use_openai_chat_compat =
        openai::is_openai_chat_completions_path(&incoming_path) && provider_uses_anthropic_compat;
    let should_use_openai_responses_compat =
        openai::is_openai_responses_path(&incoming_path) && provider_uses_anthropic_compat;
    let should_use_openai_compat =
        should_use_openai_chat_compat || should_use_openai_responses_compat;

    let mut upstream_path = incoming_path.clone();
    let mut final_body = body_text.clone();
    let mut openai_stream_requested = false;

    if should_use_openai_chat_compat {
        if let Some(parsed) = parsed_body.as_ref() {
            let converted =
                openai::convert_openai_chat_request_to_anthropic(parsed, &provider.model_name);
            openai_stream_requested = converted
                .get("stream")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            final_body = serde_json::to_string(&converted).unwrap_or_default();
            upstream_path = "/v1/messages".into();
            emit_request_log(
                "info",
                format!("[MAP][{request_id}] OpenAI chat/completions -> Anthropic messages"),
            );
        }
    } else if should_use_openai_responses_compat {
        if let Some(parsed) = parsed_body.as_ref() {
            let converted =
                openai::convert_openai_responses_request_to_anthropic(parsed, &provider.model_name);
            openai_stream_requested = converted
                .get("stream")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            final_body = serde_json::to_string(&converted).unwrap_or_default();
            upstream_path = "/v1/messages".into();
            emit_request_log(
                "info",
                format!("[MAP][{request_id}] OpenAI responses -> Anthropic messages"),
            );
        }
    } else if !provider.model_name.is_empty() {
        if let Some(mut parsed) = parsed_body.clone() {
            parsed["model"] = serde_json::Value::String(provider.model_name.clone());
            final_body = serde_json::to_string(&parsed).unwrap_or_default();
        }
    }

    // 按 provider 配置剥离请求体字段
    if !provider.strip_fields.is_empty() && !final_body.trim().is_empty() {
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(&final_body) {
            let mut removed = Vec::new();
            for field in &provider.strip_fields {
                if parsed.get(field).is_some() {
                    if let Some(obj) = parsed.as_object_mut() {
                        obj.remove(field);
                        removed.push(field.clone());
                    }
                }
            }
            if !removed.is_empty() {
                final_body = serde_json::to_string(&parsed).unwrap_or_default();
                emit_request_log(
                    "info",
                    format!("[STRIP][{request_id}] 移除字段: {}", removed.join(", ")),
                );
            }
        }
    }

    let base_url = normalize_base_url_for_docker(&provider.base_url);
    let target_url = format!(
        "{}/{}{}",
        base_url.trim_end_matches('/'),
        upstream_path.trim_start_matches('/'),
        incoming_search
    );
    let log_target_url = sanitize_logged_url(&target_url);

    emit_request_log(
        "info",
        format!(
            "[REQ][{request_id}] {} {} | Model: {}",
            method,
            log_target_url,
            if provider.model_name.is_empty() {
                "unknown"
            } else {
                &provider.model_name
            }
        ),
    );

    // 请求体摘要：列出实际发出的顶层字段，便于判断 thinking/output_config/context_management 是否齐全
    if let Ok(preview_value) = serde_json::from_str::<serde_json::Value>(&final_body) {
        if let Some(obj) = preview_value.as_object() {
            let keys: Vec<&str> = obj.keys().map(String::as_str).collect();
            let has_thinking = obj.get("thinking").map(|v| !v.is_null()).unwrap_or(false);
            let has_output_config = obj
                .get("output_config")
                .map(|v| !v.is_null())
                .unwrap_or(false);
            let has_context_management = obj
                .get("context_management")
                .map(|v| !v.is_null())
                .unwrap_or(false);
            let has_metadata = obj.get("metadata").map(|v| !v.is_null()).unwrap_or(false);
            let system_kind = obj
                .get("system")
                .map(|v| match v {
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::String(_) => "string",
                    serde_json::Value::Null => "null",
                    _ => "other",
                })
                .unwrap_or("missing");
            let has_temperature = obj.contains_key("temperature");
            emit_request_log(
                "info",
                format!(
                    "[BODY][{request_id}] keys=[{}] thinking={} output_config={} context_management={} metadata={} system={} temperature={}",
                    keys.join(","),
                    has_thinking,
                    has_output_config,
                    has_context_management,
                    has_metadata,
                    system_kind,
                    has_temperature,
                ),
            );
        }
    }

    let mut request_builder = manager.client.request(method.clone(), &target_url);
    let custom_header_names: std::collections::HashSet<String> = provider
        .custom_headers
        .iter()
        .map(|h| h.name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
        .collect();

    // 收集最终 anthropic-beta 值：provider 自定义头覆盖客户端，1m 变体再注入 context-1m-2025-08-07
    let mut effective_beta: Option<String> = None;
    if !custom_header_names.contains("anthropic-beta") {
        if let Some(text) = headers
            .get("anthropic-beta")
            .and_then(|value| value.to_str().ok())
        {
            effective_beta = Some(text.to_string());
        }
    }
    for header in &provider.custom_headers {
        if header.name.trim().to_ascii_lowercase() == "anthropic-beta" {
            effective_beta = Some(header.value.clone());
        }
    }
    if needs_1m_beta {
        let mut parts: Vec<String> = effective_beta
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        if !parts
            .iter()
            .any(|value| value.eq_ignore_ascii_case("context-1m-2025-08-07"))
        {
            parts.push("context-1m-2025-08-07".to_string());
        }
        effective_beta = Some(parts.join(","));
    }

    // 按 new-api 已知坑过滤 beta：黑名单 + body 字段配对缺失剥离，避免 nil-deref panic
    if let Some(beta_text) = effective_beta.as_deref() {
        let body_fields: std::collections::HashSet<String> =
            serde_json::from_str::<serde_json::Value>(&final_body)
                .ok()
                .and_then(|value| {
                    value.as_object().map(|map| {
                        map.iter()
                            .filter(|(_, value)| !value.is_null())
                            .map(|(key, _)| key.clone())
                            .collect()
                    })
                })
                .unwrap_or_default();
        let filtered = filter_anthropic_beta(beta_text, &body_fields);
        if filtered.dropped.len() > 0 {
            emit_request_log(
                "info",
                format!(
                    "[BETA][{request_id}] dropped={} kept={}",
                    filtered.dropped.join(","),
                    if filtered.kept.is_empty() {
                        "(none)"
                    } else {
                        &filtered.kept
                    }
                ),
            );
        }
        effective_beta = if filtered.kept.is_empty() {
            None
        } else {
            Some(filtered.kept)
        };
    }

    for (name, value) in headers.iter() {
        let key = name.as_str().to_ascii_lowercase();
        if matches!(
            key.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "authorization"
                | "proxy-authorization"
                | "x-api-key"
                | "anthropic-api-key"
                | "anthropic-beta"
                | "x-forwarded-for"
                | "x-forwarded-host"
                | "x-forwarded-proto"
                | "forwarded"
                | "x-real-ip"
        ) {
            continue;
        }
        if custom_header_names.contains(&key) {
            continue;
        }
        if let Ok(text) = value.to_str() {
            request_builder = request_builder.header(name.as_str(), text);
        }
    }

    for header in &provider.custom_headers {
        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "authorization"
                | "proxy-authorization"
                | "x-api-key"
                | "anthropic-api-key"
                | "anthropic-beta"
                | "x-request-id"
        ) {
            continue;
        }
        request_builder = request_builder.header(name, header.value.as_str());
    }

    if let Some(beta_value) = effective_beta.as_deref() {
        if !beta_value.is_empty() {
            request_builder = request_builder.header("anthropic-beta", beta_value);
        }
    }

    request_builder = request_builder.header("x-request-id", &request_id);
    if !provider.api_key.is_empty() {
        request_builder = request_builder.header("x-api-key", &provider.api_key);
        request_builder = request_builder.bearer_auth(&provider.api_key);
    }

    if (should_use_openai_compat || upstream_path == "/v1/messages")
        && !headers.contains_key("anthropic-version")
    {
        request_builder = request_builder.header("anthropic-version", "2023-06-01");
    }

    if !final_body.is_empty() {
        request_builder = request_builder.body(final_body.clone());
    }

    let upstream_response = match request_builder.send().await {
        Ok(response) => response,
        Err(err) => {
            let hint = build_proxy_error_hint(&err, &provider.base_url);
            let detail = if hint.is_empty() {
                err.to_string()
            } else {
                format!("{} | {}", err, hint)
            };
            manager.emit_log_payload(ProxyLogPayload {
                message: format!("[ERR][{request_id}] 请求失败: {detail}"),
                r#type: "error".to_string(),
                timestamp: Utc::now().to_rfc3339(),
                request_id: Some(request_id.clone()),
                provider_id: Some(provider.provider_id.clone()),
                provider_label: Some(provider.provider_label.clone()),
                model: Some(provider.model_name.clone()),
                route_kind: route_kind.clone(),
                token_usage: None,
                status_code: Some(StatusCode::BAD_GATEWAY.as_u16()),
                upstream_url: Some(log_target_url.clone()),
                upstream_body_preview: None,
                error_stage: Some("upstreamConnect".to_string()),
                duration_ms: Some(request_started.elapsed().as_millis() as u64),
            });
            if should_use_openai_compat {
                return json_response(
                    StatusCode::BAD_GATEWAY,
                    openai::get_openai_error_payload(502, "{}"),
                );
            }
            return json_response(
                StatusCode::BAD_GATEWAY,
                serde_json::json!({
                    "error": "Proxy Error: upstream request failed",
                    "requestId": request_id
                }),
            );
        }
    };

    let status = StatusCode::from_u16(upstream_response.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream_response.headers().clone();
    let response_content_type = upstream_response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_lowercase();

    if should_use_openai_compat {
        if status.is_client_error() || status.is_server_error() {
            let body = upstream_response.text().await.unwrap_or_default();
            let preview = upstream_error_preview(&body);
            manager.emit_log_payload(ProxyLogPayload {
                message: format!(
                    "[ERR][{request_id}] Upstream {} body_preview={}",
                    status.as_u16(),
                    if preview.is_empty() {
                        "(empty)"
                    } else {
                        "available"
                    }
                ),
                r#type: "error".to_string(),
                timestamp: Utc::now().to_rfc3339(),
                request_id: Some(request_id.clone()),
                provider_id: Some(provider.provider_id.clone()),
                provider_label: Some(provider.provider_label.clone()),
                model: Some(provider.model_name.clone()),
                route_kind: route_kind.clone(),
                token_usage: None,
                status_code: Some(status.as_u16()),
                upstream_url: Some(log_target_url.clone()),
                upstream_body_preview: if preview.is_empty() {
                    None
                } else {
                    Some(preview)
                },
                error_stage: Some("openaiCompat".to_string()),
                duration_ms: Some(request_started.elapsed().as_millis() as u64),
            });
            return json_response(
                status,
                openai::get_openai_error_payload(status.as_u16(), &body),
            );
        }

        if openai_stream_requested || response_content_type.contains("text/event-stream") {
            let manager_for_usage = manager.clone();
            let request_id_for_usage = request_id.clone();
            let provider_id_for_usage = provider.provider_id.clone();
            let provider_label_for_usage = provider.provider_label.clone();
            let model_for_usage = provider.model_name.clone();
            let manager_for_stream_error = manager.clone();
            let request_id_for_stream_error = request_id.clone();
            let provider_id_for_stream_error = provider.provider_id.clone();
            let provider_label_for_stream_error = provider.provider_label.clone();
            let model_for_stream_error = provider.model_name.clone();
            let route_kind_for_stream_error = route_kind.clone();
            let target_url_for_stream_error = log_target_url.clone();
            let stream_started = request_started;
            let usage_callback: Arc<dyn Fn(TokenUsagePayload) + Send + Sync> =
                Arc::new(move |usage: TokenUsagePayload| {
                    manager_for_usage.record_token_usage(
                        &request_id_for_usage,
                        &provider_id_for_usage,
                        &provider_label_for_usage,
                        &model_for_usage,
                        usage,
                    );
                });
            let error_callback: Arc<dyn Fn(String) + Send + Sync> =
                Arc::new(move |error: String| {
                    manager_for_stream_error.emit_log_payload(ProxyLogPayload {
                        message: format!(
                            "[ERR][{request_id_for_stream_error}] 上游流中断: {error}"
                        ),
                        r#type: "error".to_string(),
                        timestamp: Utc::now().to_rfc3339(),
                        request_id: Some(request_id_for_stream_error.clone()),
                        provider_id: Some(provider_id_for_stream_error.clone()),
                        provider_label: Some(provider_label_for_stream_error.clone()),
                        model: Some(model_for_stream_error.clone()),
                        route_kind: route_kind_for_stream_error.clone(),
                        token_usage: None,
                        status_code: None,
                        upstream_url: Some(target_url_for_stream_error.clone()),
                        upstream_body_preview: None,
                        error_stage: Some("upstreamStream".to_string()),
                        duration_ms: Some(stream_started.elapsed().as_millis() as u64),
                    });
                });
            let response_body = if should_use_openai_responses_compat {
                Body::from_stream(openai::proxy_anthropic_stream_as_openai_responses(
                    upstream_response.bytes_stream(),
                    provider.model_name.clone(),
                    Some(usage_callback.clone()),
                    Some(error_callback.clone()),
                ))
            } else {
                Body::from_stream(openai::proxy_anthropic_stream_as_openai(
                    upstream_response.bytes_stream(),
                    provider.model_name.clone(),
                    Some(usage_callback.clone()),
                    Some(error_callback.clone()),
                ))
            };
            let mut response = Response::new(response_body);
            *response.status_mut() = status;
            add_cors_headers(response.headers_mut());
            response.headers_mut().insert(
                "content-type",
                HeaderValue::from_static("text/event-stream; charset=utf-8"),
            );
            response
                .headers_mut()
                .insert("cache-control", HeaderValue::from_static("no-cache"));
            response
                .headers_mut()
                .insert("x-accel-buffering", HeaderValue::from_static("no"));
            emit_request_log(
                "info",
                format!("[RES][{request_id}] status={}", status.as_u16()),
            );
            return response;
        }

        let response_body = upstream_response.text().await.unwrap_or_default();
        let transformed = serde_json::from_str::<serde_json::Value>(&response_body)
            .map(|value| {
                if let Some(token_usage) = extract_token_usage_from_value(&value) {
                    manager.record_token_usage(
                        &request_id,
                        &provider.provider_id,
                        &provider.provider_label,
                        &provider.model_name,
                        token_usage,
                    );
                }
                if should_use_openai_responses_compat {
                    openai::convert_anthropic_message_to_openai_responses_response(
                        &value,
                        &provider.model_name,
                    )
                } else {
                    openai::convert_anthropic_message_to_openai_response(
                        &value,
                        &provider.model_name,
                    )
                }
            })
            .unwrap_or_else(|_| serde_json::Value::String(response_body));
        emit_request_log(
            "info",
            format!("[RES][{request_id}] status={}", status.as_u16()),
        );
        return json_response(status, transformed);
    }

    // 非 OpenAI 兼容路径：上游返回错误状态时，捕获响应体并打印预览，便于定位
    if status.is_client_error() || status.is_server_error() {
        let bytes = upstream_response.bytes().await.unwrap_or_default();
        let preview = upstream_error_preview(&String::from_utf8_lossy(&bytes));
        manager.emit_log_payload(ProxyLogPayload {
            message: format!(
                "[ERR][{request_id}] Upstream {} body={}",
                status.as_u16(),
                if preview.is_empty() {
                    "(empty)"
                } else {
                    &preview
                }
            ),
            r#type: "error".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            request_id: Some(request_id.clone()),
            provider_id: Some(provider.provider_id.clone()),
            provider_label: Some(provider.provider_label.clone()),
            model: Some(provider.model_name.clone()),
            route_kind: route_kind.clone(),
            token_usage: None,
            status_code: Some(status.as_u16()),
            upstream_url: Some(log_target_url.clone()),
            upstream_body_preview: if preview.is_empty() {
                None
            } else {
                Some(preview)
            },
            error_stage: Some("upstreamStatus".to_string()),
            duration_ms: Some(request_started.elapsed().as_millis() as u64),
        });
        let mut response = Response::new(Body::from(bytes));
        *response.status_mut() = status;
        add_cors_headers(response.headers_mut());
        copy_response_headers(response.headers_mut(), &upstream_headers);
        return response;
    }

    if response_content_type.contains("text/event-stream") {
        let manager_for_usage = manager.clone();
        let request_id_for_usage = request_id.clone();
        let provider_id_for_usage = provider.provider_id.clone();
        let provider_label_for_usage = provider.provider_label.clone();
        let model_for_usage = provider.model_name.clone();
        let manager_for_stream_error = manager.clone();
        let request_id_for_stream_error = request_id.clone();
        let provider_id_for_stream_error = provider.provider_id.clone();
        let provider_label_for_stream_error = provider.provider_label.clone();
        let model_for_stream_error = provider.model_name.clone();
        let route_kind_for_stream_error = route_kind.clone();
        let target_url_for_stream_error = target_url.clone();
        let stream_started = request_started;
        let raw_stream = stream! {
            let mut upstream = upstream_response.bytes_stream();
            let mut frame_buffer = String::new();
            let mut token_usage = None;
            let mut sanitizer = openai::AnthropicReadToolSseSanitizerState::default();
            while let Some(item) = upstream.next().await {
                if let Ok(chunk) = item {
                    frame_buffer.push_str(&String::from_utf8_lossy(&chunk));
                    while let Some(boundary_index) = frame_buffer.find("\r\n\r\n").or_else(|| frame_buffer.find("\n\n")) {
                        let frame = frame_buffer[..boundary_index].to_string();
                        let boundary_len = if frame_buffer[boundary_index..].starts_with("\r\n\r\n") { 4 } else { 2 };
                        frame_buffer = frame_buffer[boundary_index + boundary_len..].to_string();
                        merge_token_usage(&mut token_usage, parse_sse_usage_frame(&frame));
                        let sanitized = openai::sanitize_anthropic_read_tool_sse_frame(&frame, &mut sanitizer);
                        yield Ok::<Bytes, Infallible>(Bytes::from(sanitized));
                    }
                } else if let Err(err) = item {
                    manager_for_stream_error.emit_log_payload(ProxyLogPayload {
                        message: format!("[ERR][{request_id_for_stream_error}] 上游流中断: {err}"),
                        r#type: "error".to_string(),
                        timestamp: Utc::now().to_rfc3339(),
                        request_id: Some(request_id_for_stream_error.clone()),
                        provider_id: Some(provider_id_for_stream_error.clone()),
                        provider_label: Some(provider_label_for_stream_error.clone()),
                        model: Some(model_for_stream_error.clone()),
                        route_kind: route_kind_for_stream_error.clone(),
                        token_usage: None,
                        status_code: None,
                        upstream_url: Some(target_url_for_stream_error.clone()),
                        upstream_body_preview: None,
                        error_stage: Some("upstreamStream".to_string()),
                        duration_ms: Some(stream_started.elapsed().as_millis() as u64),
                    });
                    break;
                }
            }
            if !frame_buffer.trim().is_empty() {
                merge_token_usage(&mut token_usage, parse_sse_usage_frame(&frame_buffer));
                let sanitized = openai::sanitize_anthropic_read_tool_sse_frame(&frame_buffer, &mut sanitizer);
                yield Ok::<Bytes, Infallible>(Bytes::from(sanitized));
            }
            if let Some(usage) = token_usage {
                manager_for_usage.record_token_usage(
                    &request_id_for_usage,
                    &provider_id_for_usage,
                    &provider_label_for_usage,
                    &model_for_usage,
                    usage,
                );
            }
        };
        let mut response = Response::new(Body::from_stream(raw_stream));
        *response.status_mut() = status;
        add_cors_headers(response.headers_mut());
        copy_response_headers(response.headers_mut(), &upstream_headers);
        emit_request_log(
            "info",
            format!("[RES][{request_id}] status={}", status.as_u16()),
        );
        return response;
    }

    let mut bytes = upstream_response.bytes().await.unwrap_or_default();
    if response_content_type.contains("application/json") {
        if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(token_usage) = extract_token_usage_from_value(&value) {
                manager.record_token_usage(
                    &request_id,
                    &provider.provider_id,
                    &provider.provider_label,
                    &provider.model_name,
                    token_usage,
                );
            }
            if openai::sanitize_anthropic_read_tool_pages(&mut value) {
                bytes = Bytes::from(serde_json::to_vec(&value).unwrap_or_else(|_| bytes.to_vec()));
            }
        }
    }
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    add_cors_headers(response.headers_mut());
    copy_response_headers(response.headers_mut(), &upstream_headers);
    emit_request_log(
        "info",
        format!("[RES][{request_id}] status={}", status.as_u16()),
    );
    response
}

fn resolve_request_provider_config(
    config: &AppConfig,
    requested_model: &str,
    body: Option<&serde_json::Value>,
) -> Result<ResolvedProviderConfig, String> {
    let is_routes_mode = config.routing_mode == ROUTING_MODE_ROUTES;

    // gateway 模式：仅走 modelRoutes；routes 模式：跳过 modelRoutes 直接走 router 分类
    if !is_routes_mode {
        if let Some(route) = config.model_routes.iter().find(|route| {
            route.enabled && route_matches_requested_model(&route.source_model, requested_model)
        }) {
            let routed_model = resolve_route_target_model(config, route, requested_model);
            let provider = build_provider_config(
                config,
                &route.provider_id,
                &routed_model,
                Some(route.base_url.trim()),
                Some(route.api_key.trim()),
                Some(route.provider_label.trim()),
            )?;
            return Ok(ResolvedProviderConfig {
                resolution_source: "modelRoute",
                route_id: Some(route.id.clone()),
                source_model: Some(route.source_model.clone()),
                ..provider
            });
        }
    }

    if is_routes_mode {
        // 分类路由优先级：image -> webSearch -> think -> longContext -> background -> default
        if let Some(body) = body {
            if router_target_active(&config.router.image) && body_has_image_block(body) {
                return resolve_router_target(config, &config.router.image, "router:image");
            }

            if router_target_active(&config.router.web_search) && body_has_web_search_tool(body) {
                return resolve_router_target(
                    config,
                    &config.router.web_search,
                    "router:webSearch",
                );
            }

            if router_target_active(&config.router.think) && body_has_thinking(body) {
                return resolve_router_target(config, &config.router.think, "router:think");
            }

            if router_target_active(&config.router.long_context) {
                let estimated = estimate_input_tokens(body);
                if estimated > u64::from(config.router.long_context_threshold) {
                    return resolve_router_target(
                        config,
                        &config.router.long_context,
                        "router:longContext",
                    );
                }
            }
        }

        if router_target_active(&config.router.background)
            && is_background_requested_model(requested_model)
        {
            return resolve_router_target(config, &config.router.background, "router:background");
        }

        if router_target_active(&config.router.default) {
            return resolve_router_target(config, &config.router.default, "router:default");
        }
    }

    let fallback = config.mapping.main.trim();
    let (provider_id, model_name) = if let Some(parts) = fallback.split_once(':') {
        parts
    } else if fallback == "pass" {
        if let Some(inferred) = infer_provider_config_from_enabled_models(config, requested_model)?
        {
            return Ok(inferred);
        }
        return Err("未命中模型路由，且默认回退映射未配置".to_string());
    } else {
        return Err(format!(
            "未命中模型路由，且默认回退 Provider 配置无效: {fallback}"
        ));
    };

    let mut provider = build_provider_config(config, provider_id, model_name, None, None, None)?;
    provider.resolution_source = "legacyMapping";
    Ok(provider)
}

fn router_target_active(target: &RouterTarget) -> bool {
    target.enabled && !target.provider_id.trim().is_empty()
}

fn resolve_router_target(
    config: &AppConfig,
    target: &RouterTarget,
    source: &'static str,
) -> Result<ResolvedProviderConfig, String> {
    let label = if target.provider_label.trim().is_empty() {
        None
    } else {
        Some(target.provider_label.trim())
    };
    let mut provider = build_provider_config(
        config,
        &target.provider_id,
        &target.target_model,
        None,
        None,
        label,
    )?;
    provider.resolution_source = source;
    Ok(provider)
}

// 判定请求是否携带图片内容块（Anthropic `image` / OpenAI `image_url`）
fn body_has_image_block(body: &serde_json::Value) -> bool {
    let Some(messages) = body.get("messages").and_then(|value| value.as_array()) else {
        return false;
    };
    latest_routable_message_content(messages)
        .map(content_has_image_block)
        .unwrap_or(false)
}

fn latest_routable_message_content<'a>(
    messages: &'a [serde_json::Value],
) -> Option<&'a serde_json::Value> {
    messages
        .iter()
        .rev()
        .find(|message| {
            message
                .get("role")
                .and_then(|value| value.as_str())
                .map(|role| role.eq_ignore_ascii_case("user"))
                .unwrap_or(false)
        })
        .or_else(|| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("content").is_some())
        })
        .and_then(|message| message.get("content"))
}

fn content_has_image_block(content: &serde_json::Value) -> bool {
    match content {
        serde_json::Value::Array(blocks) => blocks.iter().any(block_has_image_content),
        serde_json::Value::Object(_) => block_has_image_content(content),
        _ => false,
    }
}

fn block_has_image_content(block: &serde_json::Value) -> bool {
    let block_type = block
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if matches!(block_type, "image" | "image_url" | "input_image") {
        return true;
    }

    block.get("image_url").is_some()
}

// 判定 tools 数组中是否含 web_search 工具
fn body_has_web_search_tool(body: &serde_json::Value) -> bool {
    let Some(tools) = body.get("tools").and_then(|value| value.as_array()) else {
        return false;
    };
    tools.iter().any(|tool| {
        let name = tool
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_lowercase();
        let kind = tool
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_lowercase();
        name.contains("web_search") || kind.contains("web_search")
    })
}

// 判定是否命中 Plan Mode / thinking
fn body_has_thinking(body: &serde_json::Value) -> bool {
    body.get("thinking")
        .map(|value| match value {
            serde_json::Value::Object(map) => map
                .get("type")
                .and_then(|item| item.as_str())
                .map(|item| !item.is_empty())
                .unwrap_or(!map.is_empty()),
            serde_json::Value::Bool(flag) => *flag,
            serde_json::Value::Null => false,
            _ => true,
        })
        .unwrap_or(false)
}

// 粗略估算输入 token（chars / 4），仅统计文本字段，避免 base64 图片膨胀
fn estimate_input_tokens(body: &serde_json::Value) -> u64 {
    let mut chars = 0u64;
    if let Some(system) = body.get("system") {
        chars += count_text_chars(system);
    }
    if let Some(messages) = body.get("messages").and_then(|value| value.as_array()) {
        for message in messages {
            if let Some(content) = message.get("content") {
                chars += count_text_chars(content);
            }
        }
    }
    chars / 4
}

fn count_text_chars(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::String(text) => text.chars().count() as u64,
        serde_json::Value::Array(items) => items.iter().map(count_text_chars).sum(),
        serde_json::Value::Object(map) => map
            .iter()
            .filter(|(key, _)| {
                matches!(
                    key.as_str(),
                    "text" | "content" | "input" | "name" | "arguments"
                )
            })
            .map(|(_, value)| count_text_chars(value))
            .sum(),
        _ => 0,
    }
}

fn is_background_requested_model(model: &str) -> bool {
    model.to_lowercase().contains("haiku")
}

fn infer_provider_config_from_enabled_models(
    config: &AppConfig,
    requested_model: &str,
) -> Result<Option<ResolvedProviderConfig>, String> {
    let normalized_requested_model = normalize_route_match_model(requested_model);
    if normalized_requested_model.is_empty() {
        return Ok(None);
    }

    let mut matches = Vec::new();

    for provider_id in BUILTIN_PROVIDER_KEYS {
        let provider = match provider_id {
            "anthropic" => &config.providers.anthropic,
            "glm" => &config.providers.glm,
            "kimi" => &config.providers.kimi,
            "minimax" => &config.providers.minimax,
            "deepseek" => &config.providers.deepseek,
            "litellm" => &config.providers.litellm,
            "cliproxyapi" => &config.providers.cliproxyapi,
            _ => continue,
        };

        if provider.enabled
            && provider
                .models
                .iter()
                .any(|model| normalize_route_match_model(model) == normalized_requested_model)
        {
            matches.push((provider_id.to_string(), provider_id.to_string()));
        }
    }

    for provider in &config.providers.custom_providers {
        if provider.provider.enabled
            && provider
                .provider
                .models
                .iter()
                .any(|model| normalize_route_match_model(model) == normalized_requested_model)
        {
            matches.push((provider.id.clone(), provider.name.clone()));
        }
    }

    if matches.is_empty() {
        return Ok(None);
    }

    if matches.len() > 1 {
        let providers = matches
            .iter()
            .map(|(_, label)| label.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "未命中模型路由，且默认回退映射未配置；检测到多个可匹配该模型的 Provider: {providers}"
        ));
    }

    let (provider_id, provider_label) = &matches[0];
    let mut provider = build_provider_config(
        config,
        provider_id,
        requested_model,
        None,
        None,
        Some(provider_label),
    )?;
    provider.resolution_source = "providerInference";
    Ok(Some(provider))
}

fn resolve_route_target_model(
    config: &AppConfig,
    route: &crate::types::ModelRoute,
    requested_model: &str,
) -> String {
    let explicit_target = route.target_model.trim();
    if !explicit_target.is_empty() {
        return explicit_target.to_string();
    }

    if route.source_model.trim() == "*" {
        if let Some(provider_model) = get_first_provider_model(config, &route.provider_id) {
            return provider_model;
        }
    }

    requested_model.trim().to_string()
}

fn get_first_provider_model(config: &AppConfig, provider_id: &str) -> Option<String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return None;
    }

    if let Some(custom) = config
        .providers
        .custom_providers
        .iter()
        .find(|item| item.id == provider_id)
    {
        return custom
            .provider
            .models
            .iter()
            .map(|model| model.trim())
            .find(|model| !model.is_empty())
            .map(ToOwned::to_owned);
    }

    let provider = match provider_id {
        "anthropic" => &config.providers.anthropic,
        "glm" => &config.providers.glm,
        "kimi" => &config.providers.kimi,
        "minimax" => &config.providers.minimax,
        "deepseek" => &config.providers.deepseek,
        "litellm" => &config.providers.litellm,
        "cliproxyapi" => &config.providers.cliproxyapi,
        _ => return None,
    };

    provider
        .models
        .iter()
        .map(|model| model.trim())
        .find(|model| !model.is_empty())
        .map(ToOwned::to_owned)
}

fn build_provider_config(
    config: &AppConfig,
    provider_id: &str,
    model_name: &str,
    override_base_url: Option<&str>,
    override_api_key: Option<&str>,
    provider_label: Option<&str>,
) -> Result<ResolvedProviderConfig, String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err("providerId 不能为空".into());
    }

    if let Some(custom) = config
        .providers
        .custom_providers
        .iter()
        .find(|item| item.id == provider_id)
    {
        let base_url = override_base_url
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| custom.provider.base_url.clone())
            .unwrap_or_default();
        return Ok(ResolvedProviderConfig {
            provider_id: provider_id.into(),
            provider_label: provider_label
                .filter(|value| !value.is_empty())
                .unwrap_or(&custom.name)
                .to_string(),
            base_url,
            api_key: override_api_key
                .filter(|value| !value.is_empty())
                .unwrap_or(&custom.provider.api_key)
                .to_string(),
            model_name: model_name.trim().to_string(),
            resolution_source: "legacyMapping",
            route_id: None,
            source_model: None,
            custom_headers: custom.custom_headers.clone(),
            strip_fields: custom.provider.strip_fields.clone(),
        });
    }

    let provider = match provider_id {
        "anthropic" => &config.providers.anthropic,
        "glm" => &config.providers.glm,
        "kimi" => &config.providers.kimi,
        "minimax" => &config.providers.minimax,
        "deepseek" => &config.providers.deepseek,
        "litellm" => &config.providers.litellm,
        "cliproxyapi" => &config.providers.cliproxyapi,
        _ => return Err(format!("未找到可用的上游配置: {provider_id}")),
    };

    let base_url = override_base_url
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| provider.base_url.clone())
        .unwrap_or_else(|| get_builtin_provider_url(provider_id));

    Ok(ResolvedProviderConfig {
        provider_id: provider_id.into(),
        provider_label: provider_label
            .filter(|value| !value.is_empty())
            .unwrap_or(provider_id)
            .to_string(),
        base_url,
        api_key: override_api_key
            .filter(|value| !value.is_empty())
            .unwrap_or(&provider.api_key)
            .to_string(),
        model_name: model_name.trim().to_string(),
        resolution_source: "legacyMapping",
        route_id: None,
        source_model: None,
        custom_headers: Vec::new(),
        strip_fields: provider.strip_fields.clone(),
    })
}

fn get_builtin_provider_url(provider_id: &str) -> String {
    match provider_id {
        "anthropic" => "https://api.anthropic.com",
        "glm" => "https://open.bigmodel.cn/api/anthropic",
        "kimi" => "https://api.moonshot.cn/anthropic",
        "minimax" => "https://api.minimaxi.com/anthropic",
        "deepseek" => "https://api.deepseek.com/anthropic",
        _ => "https://api.anthropic.com",
    }
    .to_string()
}

fn normalize_route_match_model(model: &str) -> String {
    let normalized = model.trim().to_lowercase();
    if normalized.starts_with("claude-") {
        normalized.replace('.', "-")
    } else {
        normalized
    }
}

fn extract_token_usage_from_value(value: &serde_json::Value) -> Option<TokenUsagePayload> {
    let usage = if value.get("usage").is_some() {
        value.get("usage")
    } else {
        Some(value)
    }?;

    let input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(input_tokens + output_tokens);

    if input_tokens == 0 && output_tokens == 0 && total_tokens == 0 {
        return None;
    }

    Some(TokenUsagePayload {
        input_tokens,
        output_tokens,
        total_tokens,
    })
}

fn merge_token_usage(current: &mut Option<TokenUsagePayload>, incoming: Option<TokenUsagePayload>) {
    let Some(incoming_usage) = incoming else {
        return;
    };

    match current {
        Some(existing) => {
            existing.input_tokens = existing.input_tokens.max(incoming_usage.input_tokens);
            existing.output_tokens = existing.output_tokens.max(incoming_usage.output_tokens);
            existing.total_tokens = existing.total_tokens.max(incoming_usage.total_tokens);
        }
        None => *current = Some(incoming_usage),
    }
}

fn parse_sse_usage_frame(frame: &str) -> Option<TokenUsagePayload> {
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }

    let data = data_lines.join("\n");
    if data.is_empty() {
        return None;
    }

    let payload = serde_json::from_str::<serde_json::Value>(&data).ok()?;
    extract_token_usage_from_value(&payload)
        .or_else(|| {
            payload
                .get("message")
                .and_then(extract_token_usage_from_value)
        })
        .or_else(|| {
            payload
                .get("delta")
                .and_then(extract_token_usage_from_value)
        })
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    if pattern.is_empty() || value.is_empty() {
        return false;
    }
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern == value;
    }

    let starts_with_wildcard = pattern.starts_with('*');
    let ends_with_wildcard = pattern.ends_with('*');
    let parts = pattern
        .split('*')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return true;
    }

    let mut cursor = 0usize;
    for (index, part) in parts.iter().enumerate() {
        if index == 0 && !starts_with_wildcard {
            if !value[cursor..].starts_with(part) {
                return false;
            }
            cursor += part.len();
            continue;
        }

        let Some(offset) = value[cursor..].find(part) else {
            return false;
        };
        cursor += offset + part.len();
    }

    if !ends_with_wildcard {
        if let Some(last) = parts.last() {
            return value.ends_with(last);
        }
    }

    true
}

fn route_matches_requested_model(route_model: &str, requested_model: &str) -> bool {
    let route_model = route_model.trim();
    let requested_model = requested_model.trim();
    if route_model.is_empty() || requested_model.is_empty() {
        return false;
    }

    if route_model == "*" || route_model == requested_model {
        return true;
    }

    let normalized_route = normalize_route_match_model(route_model);
    let normalized_requested = normalize_route_match_model(requested_model);
    wildcard_match(&normalized_route, &normalized_requested)
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        "/".into()
    } else if trimmed.starts_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        format!("/{}", trimmed.trim_end_matches('/'))
    }
}

fn create_request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .or_else(|| headers.get("x-correlation-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("req_{}", Uuid::new_v4().simple()))
}

fn read_header_value(headers: &HeaderMap, key: &str) -> String {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

fn json_response(status: StatusCode, payload: serde_json::Value) -> Response<Body> {
    let mut response = Response::new(Body::from(payload.to_string()));
    *response.status_mut() = status;
    add_cors_headers(response.headers_mut());
    response
        .headers_mut()
        .insert("content-type", HeaderValue::from_static("application/json"));
    response
}

fn copy_response_headers(target: &mut HeaderMap, source: &reqwest::header::HeaderMap) {
    for (name, value) in source.iter() {
        if matches!(
            name.as_str().to_ascii_lowercase().as_str(),
            "content-length" | "connection" | "transfer-encoding" | "content-encoding"
        ) {
            continue;
        }
        target.insert(name.clone(), value.clone());
    }
}

fn add_cors_headers(headers: &mut HeaderMap) {
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Content-Type, x-api-key, anthropic-version, authorization, x-request-id, x-correlation-id, idempotency-key, openai-organization, openai-project"),
    );
}

fn normalize_base_url_for_docker(base_url: &str) -> String {
    let should_rewrite = std::env::var("REWRITE_LOCALHOST_FOR_DOCKER")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let normalized = base_url.trim().trim_end_matches('/').to_string();
    if !should_rewrite || !is_docker_container() {
        return normalized;
    }

    if normalized.contains("://localhost")
        || normalized.contains("://127.0.0.1")
        || normalized.contains("://[::1]")
    {
        return normalized
            .replace("://localhost", &format!("://{DOCKER_HOST_ALIAS}"))
            .replace("://127.0.0.1", &format!("://{DOCKER_HOST_ALIAS}"))
            .replace("://[::1]", &format!("://{DOCKER_HOST_ALIAS}"));
    }

    normalized
}

struct FilteredBeta {
    kept: String,
    dropped: Vec<String>,
}

// new-api 对未知 beta 或 beta/body 字段不匹配会 nil-deref，提前剥离
fn filter_anthropic_beta(
    value: &str,
    body_fields: &std::collections::HashSet<String>,
) -> FilteredBeta {
    // 无条件黑名单：未识别就 panic 的 beta
    const BETA_REMOVE: &[&str] = &["structured-outputs-2025-12-15"];
    // beta -> 必需 body 字段；body 缺则剥离该 beta
    const BETA_REQUIRES_FIELD: &[(&str, &str)] = &[
        ("interleaved-thinking-2025-05-14", "thinking"),
        ("redact-thinking-2026-02-12", "thinking"),
        ("context-management-2025-06-27", "context_management"),
        ("effort-2025-11-24", "output_config"),
    ];

    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for raw in value.split(',') {
        let flag = raw.trim();
        if flag.is_empty() {
            continue;
        }
        let lower = flag.to_ascii_lowercase();
        if BETA_REMOVE
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&lower))
        {
            dropped.push(flag.to_string());
            continue;
        }
        if let Some((_, required)) = BETA_REQUIRES_FIELD
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(&lower))
        {
            if !body_fields.contains(*required) {
                dropped.push(flag.to_string());
                continue;
            }
        }
        kept.push(flag.to_string());
    }
    FilteredBeta {
        kept: kept.join(","),
        dropped,
    }
}

fn is_docker_container() -> bool {
    std::env::var("DOCKER_CONTAINER")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or_else(|_| std::path::Path::new("/.dockerenv").exists())
}

fn build_proxy_error_hint(error: &reqwest::Error, original_base_url: &str) -> String {
    let is_local_origin = original_base_url.contains("localhost")
        || original_base_url.contains("127.0.0.1")
        || original_base_url.contains("[::1]");

    if error.is_connect() && is_docker_container() && is_local_origin {
        return format!(
            "容器内检测到 localhost 上游，请改为 http://{DOCKER_HOST_ALIAS}:<port> 或启用对应 host-network 设置。"
        );
    }

    String::new()
}

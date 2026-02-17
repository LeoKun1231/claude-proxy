const http = require('http');
const https = require('https');
const fs = require('fs');

let server = null;
let currentPort = 5055;
let configProvider = () => ({ mapping: { main: 'pass' }, providers: {} });
const SHOULD_REWRITE_LOCALHOST = String(process.env.REWRITE_LOCALHOST_FOR_DOCKER || '').toLowerCase() === 'true';
const DOCKER_HOST_ALIAS = String(process.env.DOCKER_HOST_ALIAS || 'host.docker.internal');

function setConfigProvider(getConfig) {
    configProvider = typeof getConfig === 'function'
        ? getConfig
        : () => ({ mapping: { main: 'pass' }, providers: {} });
}

function getBuiltinProviderUrl(providerId) {
    const urls = {
        anthropic: 'https://api.anthropic.com',
        glm: 'https://open.bigmodel.cn/api/anthropic',
        kimi: 'https://api.moonshot.cn/anthropic',
        minimax: 'https://api.minimaxi.com/anthropic',
        deepseek: 'https://api.deepseek.com/anthropic',
    };
    return urls[providerId] || 'https://api.anthropic.com';
}

function getProviderConfig(target, providers) {
    if (!target || target === 'pass') {
        return null;
    }

    const separator = target.indexOf(':');
    if (separator === -1) {
        return null;
    }

    const providerId = target.substring(0, separator);
    const modelName = target.substring(separator + 1);

    if (providers[providerId]) {
        return {
            baseUrl: getBuiltinProviderUrl(providerId),
            apiKey: providers[providerId].apiKey,
            modelName,
        };
    }

    const customProviders = Array.isArray(providers.customProviders)
        ? providers.customProviders
        : [];
    const custom = customProviders.find((item) => item.id === providerId);

    if (custom) {
        return {
            baseUrl: custom.baseUrl,
            apiKey: custom.apiKey,
            modelName,
        };
    }

    return null;
}

function isDockerContainer() {
    if (String(process.env.DOCKER_CONTAINER || '').toLowerCase() === 'true') {
        return true;
    }
    return fs.existsSync('/.dockerenv');
}

function normalizeBaseUrlForDocker(baseUrl) {
    // 容器内若配置 localhost 上游，则自动转为宿主机别名，避免回环到容器自身
    const normalized = String(baseUrl || '').replace(/\/$/, '');
    if (!normalized || !SHOULD_REWRITE_LOCALHOST || !isDockerContainer()) {
        return normalized;
    }

    try {
        const parsed = new URL(normalized);
        const localHosts = ['localhost', '127.0.0.1', '::1'];
        if (!localHosts.includes(parsed.hostname)) {
            return normalized;
        }

        parsed.hostname = DOCKER_HOST_ALIAS;
        return parsed.toString().replace(/\/$/, '');
    } catch (_error) {
        return normalized;
    }
}

function buildProxyErrorHint(error, originalBaseUrl, targetUrl) {
    // 根据常见容器网络错误补充可执行提示，便于快速定位
    const base = String(originalBaseUrl || '');
    const isLocalOrigin = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base);

    if (error?.code === 'ECONNREFUSED' && isLocalOrigin && isDockerContainer()) {
        return '检测到容器内使用 localhost 上游地址，请改为 http://host.docker.internal:<port>。';
    }

    if (error?.code === 'ENOTFOUND' && targetUrl?.hostname === 'host.docker.internal') {
        return '容器内无法解析 host.docker.internal，请在 docker-compose 中配置 extra_hosts。';
    }

    return '';
}

function handleProxyRequest(req, res, logCallback) {
    const appConfig = configProvider() || {};
    const mainMapping = appConfig.mapping?.main || 'pass';
    const providerConfig = getProviderConfig(mainMapping, appConfig.providers || {});

    if (!providerConfig) {
        const errorMsg = mainMapping === 'pass'
            ? '透传模式未实现，请配置目标 Provider'
            : `未找到 Provider 配置: ${mainMapping}`;

        logCallback?.({
            message: `[ERR] ${errorMsg}`,
            type: 'error',
            timestamp: new Date().toISOString(),
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMsg }));
        return;
    }

    let body = '';
    req.on('data', (chunk) => {
        body += chunk.toString();
    });

    req.on('end', () => {
        try {
            const originalBaseUrl = String(providerConfig.baseUrl || '').replace(/\/$/, '');
            const baseUrl = normalizeBaseUrlForDocker(originalBaseUrl);
            const reqPath = String(req.url || '').replace(/^\//, '');
            const targetUrl = new URL(`${baseUrl}/${reqPath}`);
            const targetPath = targetUrl.pathname + targetUrl.search;

            let finalBody = body;
            let parsedBody = {};

            if (body && body.trim()) {
                try {
                    parsedBody = JSON.parse(body);
                    if (providerConfig.modelName) {
                        parsedBody.model = providerConfig.modelName;
                    }
                    finalBody = JSON.stringify(parsedBody);
                } catch (error) {
                    // 非 JSON 请求体保持原样透传
                }
            }

            const headers = { ...req.headers };

            delete headers.host;
            delete headers['content-length'];
            delete headers.connection;
            delete headers['transfer-encoding'];
            delete headers.authorization;
            delete headers['proxy-authorization'];
            delete headers['x-api-key'];
            delete headers['anthropic-api-key'];

            headers.host = targetUrl.host;
            if (providerConfig.apiKey) {
                headers['x-api-key'] = providerConfig.apiKey;
                headers.authorization = `Bearer ${providerConfig.apiKey}`;
            }

            if (!headers['anthropic-version']) {
                headers['anthropic-version'] = '2023-06-01';
            }
            if (!headers['content-type']) {
                headers['content-type'] = 'application/json';
            }
            headers['content-length'] = String(Buffer.byteLength(finalBody));

            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: targetPath,
                method: req.method,
                headers,
            };

            const modelDisplay = parsedBody.model || 'unknown';
            logCallback?.({
                message: `[REQ] ${req.method} ${targetUrl.toString()} | Model: ${modelDisplay}`,
                type: 'info',
                timestamp: new Date().toISOString(),
            });

            const protocol = targetUrl.protocol === 'https:' ? https : http;
            const proxyReq = protocol.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

                if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
                    logCallback?.({
                        message: `[ERR] Upstream ${proxyRes.statusCode}`,
                        type: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }

                proxyRes.pipe(res);
            });

            proxyReq.on('error', (error) => {
                const hint = buildProxyErrorHint(error, originalBaseUrl, targetUrl);
                const detail = hint ? `${error.message} | ${hint}` : error.message;
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Proxy Error: ${detail}` }));
                }

                logCallback?.({
                    message: `[ERR] 请求失败: ${detail}`,
                    type: 'error',
                    timestamp: new Date().toISOString(),
                });
            });

            proxyReq.write(finalBody);
            proxyReq.end();
        } catch (error) {
            if (!res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: `代理请求处理失败: ${error.message}`,
                }));
            }
        }
    });
}

function startProxyServer(port, logCallback) {
    return new Promise((resolve) => {
        if (server) {
            resolve({ success: false, error: '服务器已在运行', port: currentPort });
            return;
        }

        server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, authorization');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            handleProxyRequest(req, res, logCallback);
        });

        server.listen(port, () => {
            currentPort = port;
            logCallback?.({
                message: `代理服务器已启动，监听端口 ${port}`,
                type: 'info',
                timestamp: new Date().toISOString(),
            });
            resolve({ success: true, port });
        });

        server.on('error', (error) => {
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
            logCallback?.({
                message: '代理服务器已停止',
                type: 'info',
                timestamp: new Date().toISOString(),
            });
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

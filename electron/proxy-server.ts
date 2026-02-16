/**
 * 代理服务器模块
 * 负责转发 Claude API 请求到配置的 Provider
 */
import http from 'http';
import https from 'https';
import ElectronStore from 'electron-store';

const store = new ElectronStore();

interface ProxyConfig {
    port: number;
    mapping: {
        main: string;
        haiku: string;
    };
}

let server: http.Server | null = null;
let currentPort = 5055;

// 获取 Provider 配置
function getProviderConfig(target: string) {
    if (target === 'pass') {
        return null;
    }

    // 使用 indexOf 查找第一个冒号，防止 providerId 本身包含冒号导致分割错误
    const firstColonIndex = target.indexOf(':');
    if (firstColonIndex === -1) {
        return null;
    }

    const providerId = target.substring(0, firstColonIndex);
    const modelName = target.substring(firstColonIndex + 1);

    const providers = store.get('providers', {}) as any;

    // 查找内置 Provider
    if (providers[providerId]) {
        return {
            baseUrl: getBuiltinProviderUrl(providerId),
            apiKey: providers[providerId].apiKey,
            modelName
        };
    }

    // 查找自定义 Provider
    const customProviders = providers.customProviders || [];
    const customProvider = customProviders.find((p: any) => p.id === providerId);
    if (customProvider) {
        return {
            baseUrl: customProvider.baseUrl,
            apiKey: customProvider.apiKey,
            modelName
        };
    }

    return null;
}

// 获取内置 Provider 的 URL
function getBuiltinProviderUrl(providerId: string): string {
    const urls: Record<string, string> = {
        'anthropic': 'https://api.anthropic.com',
        'glm': 'https://open.bigmodel.cn/api/anthropic',
        'kimi': 'https://api.moonshot.cn/anthropic',
        'minimax': 'https://api.minimaxi.com/anthropic',
        'deepseek': 'https://api.deepseek.com/anthropic',
    };
    return urls[providerId] || 'https://api.anthropic.com';
}

// 代理请求处理
function handleProxyRequest(req: http.IncomingMessage, res: http.ServerResponse, logCallback?: (log: any) => void) {
    const mainMapping = store.get('mapping.main', 'pass') as string;
    const providerConfig = getProviderConfig(mainMapping);

    // 透传模式或未找到 Provider
    if (!providerConfig) {
        const errorMsg = mainMapping === 'pass'
            ? '透传模式未实现，请配置目标 Provider'
            : `未找到 Provider 配置: ${mainMapping}`;

        logCallback?.({
            message: `[ERR] ${errorMsg}`,
            type: 'error',
            timestamp: new Date().toISOString()
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMsg }));
        return;
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        try {
            // 修复 path 拼接问题：手动拼接以保留 baseUrl 中的 path
            const baseUrlStr = providerConfig.baseUrl.replace(/\/$/, '');
            const reqPath = (req.url || '').replace(/^\//, '');
            const targetUrl = new URL(`${baseUrlStr}/${reqPath}`);
            const targetPath = targetUrl.pathname + targetUrl.search;

            // 计算新的 Body
            let finalBody = body;
            let parsedBody: any = {};

            // 尝试解析并修改 body (仅针对有内容的请求)
            if (body && body.trim().length > 0) {
                try {
                    parsedBody = JSON.parse(body);
                    // 替换模型名称
                    if (providerConfig.modelName) {
                        parsedBody.model = providerConfig.modelName;
                    }
                    finalBody = JSON.stringify(parsedBody);
                } catch (e) {
                    console.warn('Failed to parse body:', e);
                }
            }

            // 复制 Headers 并进行清理
            const headers: http.IncomingHttpHeaders = { ...req.headers };

            // 移除可能干扰的 Header
            delete headers['host'];
            delete headers['content-length'];
            delete headers['connection'];
            delete headers['transfer-encoding'];
            // 清理来路鉴权头，避免终端 token 和目标 Provider key 冲突
            delete headers['authorization'];
            delete headers['proxy-authorization'];
            delete headers['x-api-key'];
            delete headers['anthropic-api-key'];

            // 强制设置目标 Header
            headers['host'] = targetUrl.host;
            if (providerConfig.apiKey) {
                headers['x-api-key'] = providerConfig.apiKey;
                headers['authorization'] = `Bearer ${providerConfig.apiKey}`;
            }

            // 默认 header 
            if (!headers['anthropic-version']) {
                headers['anthropic-version'] = '2023-06-01';
            }
            if (!headers['content-type']) {
                headers['content-type'] = 'application/json';
            }

            // 显式设置 Content-Length
            headers['content-length'] = String(Buffer.byteLength(finalBody));

            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: targetPath,
                method: req.method,
                headers: headers
            };

            // 记录请求日志
            const modelDisplay = parsedBody.model || 'unknown';
            logCallback?.({
                message: `[REQ] ${req.method} ${targetUrl.toString()} | Model: ${modelDisplay}`,
                type: 'info',
                timestamp: new Date().toISOString()
            });

            const protocol = targetUrl.protocol === 'https:' ? https : http;
            const proxyReq = protocol.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

                if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
                    logCallback?.({
                        message: `[ERR] Upstream ${proxyRes.statusCode}`,
                        type: 'error',
                        timestamp: new Date().toISOString()
                    });
                }

                proxyRes.pipe(res);
            });

            proxyReq.on('error', (error) => {
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Proxy Error: ${error.message}` }));
                }

                logCallback?.({
                    message: `[ERR] 请求失败: ${error.message}`,
                    type: 'error',
                    timestamp: new Date().toISOString()
                });
            });

            // 写入 body
            proxyReq.write(finalBody);
            proxyReq.end();

        } catch (error: any) {
            if (!res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '代理请求处理失败: ' + error.message }));
            }
        }
    });
}

// 启动代理服务器
export function startProxyServer(port: number, logCallback?: (log: any) => void): Promise<{ success: boolean; port: number; error?: string }> {
    return new Promise((resolve) => {
        if (server) {
            resolve({ success: false, error: '服务器已在运行', port: currentPort });
            return;
        }

        try {
            server = http.createServer((req, res) => {
                // CORS 处理
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                handleProxyRequest(req, res, logCallback);
            });

            server.listen(port, () => {
                currentPort = port;
                if (logCallback) {
                    logCallback({
                        message: `代理服务器已启动，监听端口 ${port}`,
                        type: 'info',
                        timestamp: new Date().toISOString()
                    });
                }
                resolve({ success: true, port });
            });

            server.on('error', (error: any) => {
                server = null;
                resolve({ success: false, error: error.message, port });
            });

        } catch (error: any) {
            resolve({ success: false, error: error.message, port });
        }
    });
}

// 停止代理服务器
export function stopProxyServer(logCallback?: (log: any) => void): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
        if (!server) {
            resolve({ success: true });
            return;
        }

        server.close(() => {
            server = null;
            if (logCallback) {
                logCallback({
                    message: '代理服务器已停止',
                    type: 'info',
                    timestamp: new Date().toISOString()
                });
            }
            resolve({ success: true });
        });
    });
}

// 获取服务器状态
export function getProxyStatus(): { running: boolean; port: number } {
    return {
        running: server !== null,
        port: currentPort
    };
}

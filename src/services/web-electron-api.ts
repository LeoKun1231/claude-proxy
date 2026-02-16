type ProxyLogPayload = { message: string; type: 'info' | 'warn' | 'error'; timestamp: string };
type ConfigUpdatePayload = { key: string; updatedAt: number };

type JsonBody = Record<string, any>;

const API_BASE = '/api';

const proxyLogCallbacks = new Set<(data: ProxyLogPayload) => void>();
const configUpdatedCallbacks = new Set<(payload: ConfigUpdatePayload) => void>();
const configImportedCallbacks = new Set<() => void>();
let eventSource: EventSource | null = null;

async function requestJson<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `请求失败: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json() as Promise<T>;
    }

    return null as T;
}

function closeEventSourceIfIdle() {
    if (!eventSource) {
        return;
    }

    const hasAnyListener =
        proxyLogCallbacks.size > 0 ||
        configUpdatedCallbacks.size > 0 ||
        configImportedCallbacks.size > 0;

    if (!hasAnyListener) {
        eventSource.close();
        eventSource = null;
    }
}

function ensureEventSource() {
    if (eventSource) {
        return;
    }

    eventSource = new EventSource(`${API_BASE}/events`);

    eventSource.addEventListener('proxy-log', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as ProxyLogPayload;
        proxyLogCallbacks.forEach((callback) => callback(payload));
    });

    eventSource.addEventListener('config-updated', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as ConfigUpdatePayload;
        configUpdatedCallbacks.forEach((callback) => callback(payload));
    });

    eventSource.addEventListener('config-imported', () => {
        configImportedCallbacks.forEach((callback) => callback());
    });

    eventSource.onerror = () => {
        // SSE 断开时由浏览器自动重连
    };
}

function post(path: string, body: JsonBody = {}) {
    return requestJson(path, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

function createWebElectronAPI() {
    return {
        async getConfig(key: string) {
            const encoded = encodeURIComponent(key);
            return requestJson(`/config?key=${encoded}`);
        },
        async setConfig(key: string, value: any) {
            await post('/config', { key, value });
        },
        async getAllConfig() {
            return requestJson('/config/all');
        },
        async getAutoLaunch() {
            return requestJson<boolean>('/auto-launch');
        },
        async setAutoLaunch(enabled: boolean) {
            const result = await post('/auto-launch', { enabled }) as { success: boolean };
            return Boolean(result?.success);
        },
        async getMapping(modelType: 'haiku' | 'main') {
            return requestJson<string>(`/mapping/${modelType}`);
        },
        async setMapping(modelType: 'haiku' | 'main', value: string) {
            await post(`/mapping/${modelType}`, { value });
        },
        async getAvailableTargets() {
            return requestJson<string[]>('/targets');
        },
        async checkSystemEnv() {
            return requestJson<string | null>('/system-env');
        },
        async setSystemEnv(url: string | null) {
            const result = await post('/system-env', { url }) as { success: boolean };
            return Boolean(result?.success);
        },
        async startProxy() {
            return post('/proxy/start') as Promise<{ success: boolean; port: number; error?: string }>;
        },
        async stopProxy() {
            await post('/proxy/stop');
        },
        async getProxyStatus() {
            return requestJson<{ running: boolean; port: number }>('/proxy/status');
        },
        async restartProxy() {
            return post('/proxy/restart') as Promise<{ success: boolean; port: number; error?: string }>;
        },
        async showFloatWindow() {
            // Web 模式无悬浮窗
        },
        async hideFloatWindow() {
            // Web 模式无悬浮窗
        },
        async showMainWindow() {
            // Web 模式无主窗体控制
        },
        async hideMainWindow() {
            // Web 模式无主窗体控制
        },
        async moveFloatWindow(_x: number, _y: number) {
            // Web 模式无悬浮窗
        },
        async exportConfig() {
            const result = await post('/export') as { success: boolean; config?: any; error?: string };
            return { success: result.success, path: undefined, error: result.error };
        },
        async importConfig() {
            return {
                success: false,
                error: 'Web 版本暂不支持文件导入，请通过 API 调用 /api/import',
            };
        },
        showContextMenu(_options: { label: string; value: string; checked?: boolean }[]) {
            // Web 模式不支持原生右键菜单
        },
        onContextMenuCommand(_callback: (value: string) => void) {
            // Web 模式不支持原生右键菜单
        },
        removeContextMenuListener() {
            // Web 模式不支持原生右键菜单
        },
        onProxyLog(callback: (data: ProxyLogPayload) => void) {
            proxyLogCallbacks.add(callback);
            ensureEventSource();
        },
        removeProxyLogListener() {
            proxyLogCallbacks.clear();
            closeEventSourceIfIdle();
        },
        onConfigUpdated(callback: (payload: ConfigUpdatePayload) => void) {
            configUpdatedCallbacks.add(callback);
            ensureEventSource();
        },
        removeConfigUpdatedListener() {
            configUpdatedCallbacks.clear();
            closeEventSourceIfIdle();
        },
        onConfigImported(callback: () => void) {
            configImportedCallbacks.add(callback);
            ensureEventSource();
        },
        removeConfigImportedListener() {
            configImportedCallbacks.clear();
            closeEventSourceIfIdle();
        },
    };
}

export function installWebElectronAPI() {
    if (typeof window === 'undefined') {
        return;
    }

    if (!window.electronAPI) {
        window.electronAPI = createWebElectronAPI() as any;
    }
}

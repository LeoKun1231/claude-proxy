import type { AppConfig, LegacyMappingType } from '../types/config';

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

function createTimestamp() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${date}-${time}`;
}

function downloadJsonFile(data: any, fileName: string) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
}

function selectImportFile(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', () => {
            const file = input.files && input.files.length > 0 ? input.files[0] : null;
            document.body.removeChild(input);
            resolve(file);
        });

        input.click();
    });
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsText(file, 'utf-8');
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
            return requestJson<AppConfig>('/config/all');
        },
        async getAutoLaunch() {
            return requestJson<boolean>('/auto-launch');
        },
        async setAutoLaunch(enabled: boolean) {
            const result = await post('/auto-launch', { enabled }) as { success: boolean };
            return Boolean(result?.success);
        },
        async getMapping(modelType: LegacyMappingType) {
            return requestJson<string>(`/mapping/${modelType}`);
        },
        async setMapping(modelType: LegacyMappingType, value: string) {
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
            if (!result.success) {
                return { success: false, error: result.error || '导出失败' };
            }

            const fileName = `claude-proxy-config-${createTimestamp()}.json`;
            downloadJsonFile(result.config || {}, fileName);
            return { success: true, path: fileName };
        },
        async importConfig() {
            const file = await selectImportFile();
            if (!file) {
                return { success: false, error: '已取消' };
            }

            try {
                const raw = await readFileAsText(file);
                const parsed = JSON.parse(raw);
                const result = await post('/import', { config: parsed }) as { success: boolean; error?: string };
                return { success: Boolean(result?.success), error: result?.error };
            } catch (error: any) {
                return { success: false, error: error?.message || '导入失败' };
            }
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
        removeProxyLogListener(callback?: (data: ProxyLogPayload) => void) {
            if (callback) {
                proxyLogCallbacks.delete(callback);
            } else {
                proxyLogCallbacks.clear();
            }
            closeEventSourceIfIdle();
        },
        onConfigUpdated(callback: (payload: ConfigUpdatePayload) => void) {
            configUpdatedCallbacks.add(callback);
            ensureEventSource();
        },
        removeConfigUpdatedListener(callback?: (payload: ConfigUpdatePayload) => void) {
            if (callback) {
                configUpdatedCallbacks.delete(callback);
            } else {
                configUpdatedCallbacks.clear();
            }
            closeEventSourceIfIdle();
        },
        onConfigImported(callback: () => void) {
            configImportedCallbacks.add(callback);
            ensureEventSource();
        },
        removeConfigImportedListener(callback?: () => void) {
            if (callback) {
                configImportedCallbacks.delete(callback);
            } else {
                configImportedCallbacks.clear();
            }
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

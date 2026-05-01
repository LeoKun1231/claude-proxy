import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    DEFAULT_PROXY_PORT,
    DEFAULT_TEST_PROMPT,
    createDefaultRouterConfig,
    type AppConfig,
    type LegacyMappingType,
    type ProviderConfigData,
    type TestProviderModelRequest,
    type TestProviderModelResponse,
} from '../types/config';
import type { TokenUsagePayload, TokenUsageRecord } from '../types/token-usage';

type ProxyLogPayload = {
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    requestId?: string;
    providerId?: string;
    providerLabel?: string;
    model?: string;
    routeKind?: string;
    tokenUsage?: TokenUsagePayload;
    statusCode?: number;
    upstreamUrl?: string;
    upstreamBodyPreview?: string;
    errorStage?: string;
    durationMs?: number;
};
type ConfigUpdatePayload = { key: string; updatedAt: number };
type ReleasePortResult = {
    success: boolean;
    port: number;
    stoppedSelfProxy: boolean;
    processes: Array<{ pid: number; name: string }>;
    message: string;
};

const BROWSER_CONFIG_STORAGE_KEY = 'claude-proxy:web-config';
const proxyLogCallbacks = new Set<(data: ProxyLogPayload) => void>();
const configUpdatedCallbacks = new Set<(payload: ConfigUpdatePayload) => void>();
const configImportedCallbacks = new Set<() => void>();
let proxyLogUnlisten: UnlistenFn | null = null;
let configUpdatedUnlisten: UnlistenFn | null = null;
let configImportedUnlisten: UnlistenFn | null = null;
let proxyLogListenPromise: Promise<void> | null = null;
let configUpdatedListenPromise: Promise<void> | null = null;
let configImportedListenPromise: Promise<void> | null = null;

function isTauriRuntime() {
    return typeof window !== 'undefined'
        && typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function';
}

function defaultProvider(): ProviderConfigData {
    return {
        enabled: false,
        apiKey: '',
        models: [],
    };
}

function createDefaultBrowserConfig(): AppConfig {
    return {
        configVersion: 6,
        mapping: { main: 'pass', haiku: 'pass' },
        router: createDefaultRouterConfig(),
        routingMode: 'gateway',
        globalModels: [],
        modelRoutes: [],
        providers: {
            anthropic: defaultProvider(),
            glm: defaultProvider(),
            kimi: defaultProvider(),
            minimax: defaultProvider(),
            deepseek: defaultProvider(),
            litellm: defaultProvider(),
            cliproxyapi: defaultProvider(),
            customProviders: [],
        } as unknown as AppConfig['providers'],
        settings: {
            autoLaunch: false,
            proxyPort: DEFAULT_PROXY_PORT,
            theme: 'dark',
            defaultTestPrompt: DEFAULT_TEST_PROMPT,
            gatewayModelOrder: [],
        },
    };
}

function normalizeBrowserConfig(value: Partial<AppConfig> | null | undefined): AppConfig {
    const fallback = createDefaultBrowserConfig();
    const config = value || {};
    const providers = config.providers || fallback.providers;

    const normalizedProviders = {
        ...fallback.providers,
        ...providers,
        customProviders: Array.isArray(providers.customProviders) ? providers.customProviders : [],
    } as AppConfig['providers'];

    return {
        ...fallback,
        ...config,
        mapping: { ...fallback.mapping, ...(config.mapping || {}) },
        router: { ...fallback.router, ...(config.router || {}) },
        globalModels: Array.isArray(config.globalModels) ? config.globalModels : fallback.globalModels,
        modelRoutes: Array.isArray(config.modelRoutes) ? config.modelRoutes : fallback.modelRoutes,
        providers: normalizedProviders,
        settings: { ...fallback.settings, ...(config.settings || {}) },
    };
}

function getBrowserConfig(): AppConfig {
    if (typeof window === 'undefined') return createDefaultBrowserConfig();
    try {
        const raw = window.localStorage.getItem(BROWSER_CONFIG_STORAGE_KEY);
        return normalizeBrowserConfig(raw ? JSON.parse(raw) : null);
    } catch {
        return createDefaultBrowserConfig();
    }
}

function saveBrowserConfig(config: AppConfig) {
    window.localStorage.setItem(BROWSER_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function getByPath(value: any, path: string) {
    if (!path.trim()) return value;
    return path.split('.').reduce((current, key) => current?.[key], value);
}

function setByPath(value: any, path: string, nextValue: any) {
    const keys = path.split('.').filter(Boolean);
    if (keys.length === 0) return nextValue;
    let target = value;
    for (const key of keys.slice(0, -1)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        target = target[key];
    }
    target[keys[keys.length - 1]] = nextValue;
    return value;
}

function emitBrowserConfigUpdated(key: string) {
    const payload = { key, updatedAt: Date.now() };
    configUpdatedCallbacks.forEach(callback => callback(payload));
}

function downloadBrowserConfig() {
    const fileName = `claude-proxy-config-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    const blob = new Blob([JSON.stringify(getBrowserConfig(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return fileName;
}

function pickBrowserConfigFile(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                reject(new Error('已取消'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取配置文件失败'));
            reader.readAsText(file);
        };
        input.click();
    });
}

function createBrowserAPI() {
    let status = { running: false, port: getBrowserConfig().settings.proxyPort };

    return {
        async getConfig(key: string) {
            return getByPath(getBrowserConfig(), key);
        },
        async setConfig(key: string, value: any) {
            const next = setByPath(JSON.parse(JSON.stringify(getBrowserConfig())), key, value);
            const normalized = normalizeBrowserConfig(next);
            saveBrowserConfig(normalized);
            if (key === 'settings.proxyPort') status = { ...status, port: normalized.settings.proxyPort };
            emitBrowserConfigUpdated(key);
        },
        async getAllConfig() {
            return getBrowserConfig();
        },
        async getAutoLaunch() {
            return getBrowserConfig().settings.autoLaunch;
        },
        async setAutoLaunch(enabled: boolean) {
            const config = getBrowserConfig();
            config.settings.autoLaunch = enabled;
            saveBrowserConfig(config);
            emitBrowserConfigUpdated('settings.autoLaunch');
            return enabled;
        },
        async getMapping(modelType: LegacyMappingType) {
            return getBrowserConfig().mapping[modelType];
        },
        async setMapping(modelType: LegacyMappingType, value: string) {
            const config = getBrowserConfig();
            config.mapping[modelType] = value;
            saveBrowserConfig(config);
            emitBrowserConfigUpdated(`mapping.${modelType}`);
        },
        async getAvailableTargets() {
            const config = getBrowserConfig();
            const customTargets = config.providers.customProviders.flatMap(provider =>
                provider.models.map(model => `${provider.id}:${model}`)
            );
            return ['pass', ...customTargets];
        },
        async checkSystemEnv() {
            return null;
        },
        async setSystemEnv() {
            return false;
        },
        async startProxy() {
            status = { running: true, port: getBrowserConfig().settings.proxyPort };
            return { success: true, port: status.port, alreadyRunning: false };
        },
        async stopProxy() {
            status = { ...status, running: false };
        },
        async getProxyStatus() {
            return status;
        },
        async restartProxy() {
            status = { running: true, port: getBrowserConfig().settings.proxyPort };
            return { success: true, port: status.port, alreadyRunning: false };
        },
        async releasePortProcess(port?: number): Promise<ReleasePortResult> {
            return {
                success: true,
                port: port || status.port,
                stoppedSelfProxy: false,
                processes: [],
                message: 'Web 预览模式没有可释放的本地端口进程',
            };
        },
        async testProviderModel(request: TestProviderModelRequest): Promise<TestProviderModelResponse> {
            return {
                ok: false,
                providerId: request.providerId,
                providerLabel: request.providerId,
                model: request.model,
                latencyMs: 0,
                error: 'Web 预览模式无法直连上游，请在桌面模式测试真实请求',
            };
        },
        async exportConfig() {
            try {
                return { success: true, path: downloadBrowserConfig() };
            } catch (error: any) {
                return { success: false, error: error?.message || '导出失败' };
            }
        },
        async importConfig() {
            try {
                const raw = await pickBrowserConfigFile();
                const config = normalizeBrowserConfig(JSON.parse(raw));
                saveBrowserConfig(config);
                emitBrowserConfigUpdated('all');
                configImportedCallbacks.forEach(callback => callback());
                return { success: true, path: '浏览器本地配置' };
            } catch (error: any) {
                return { success: false, error: error?.message || '导入失败' };
            }
        },
        async getLogs() {
            return [] as ProxyLogPayload[];
        },
        async clearLogs() {},
        async getTokenUsageRecords() {
            return [] as TokenUsageRecord[];
        },
        async clearTokenUsageRecords() {},
        onProxyLog(callback: (data: ProxyLogPayload) => void) {
            proxyLogCallbacks.add(callback);
        },
        removeProxyLogListener(callback?: (data: ProxyLogPayload) => void) {
            if (callback) proxyLogCallbacks.delete(callback);
            else proxyLogCallbacks.clear();
        },
        onConfigUpdated(callback: (payload: ConfigUpdatePayload) => void) {
            configUpdatedCallbacks.add(callback);
        },
        removeConfigUpdatedListener(callback?: (payload: ConfigUpdatePayload) => void) {
            if (callback) configUpdatedCallbacks.delete(callback);
            else configUpdatedCallbacks.clear();
        },
        onConfigImported(callback: () => void) {
            configImportedCallbacks.add(callback);
        },
        removeConfigImportedListener(callback?: () => void) {
            if (callback) configImportedCallbacks.delete(callback);
            else configImportedCallbacks.clear();
        },
    };
}

async function ensureProxyLogListener() {
    if (proxyLogUnlisten || proxyLogListenPromise) return;
    proxyLogListenPromise = listen<ProxyLogPayload>('proxy-log', (event) => {
        proxyLogCallbacks.forEach((callback) => callback(event.payload));
    }).then((unlisten) => {
        proxyLogUnlisten = unlisten;
    }).finally(() => {
        proxyLogListenPromise = null;
    });
    await proxyLogListenPromise;
}

async function ensureConfigUpdatedListener() {
    if (configUpdatedUnlisten || configUpdatedListenPromise) return;
    configUpdatedListenPromise = listen<{ key: string; updatedAt: number }>('config-updated', (event) => {
        const payload: ConfigUpdatePayload = {
            key: event.payload.key,
            updatedAt: event.payload.updatedAt,
        };
        configUpdatedCallbacks.forEach((callback) => callback(payload));
    }).then((unlisten) => {
        configUpdatedUnlisten = unlisten;
    }).finally(() => {
        configUpdatedListenPromise = null;
    });
    await configUpdatedListenPromise;
}

async function ensureConfigImportedListener() {
    if (configImportedUnlisten || configImportedListenPromise) return;
    configImportedListenPromise = listen('config-imported', () => {
        configImportedCallbacks.forEach((callback) => callback());
    }).then((unlisten) => {
        configImportedUnlisten = unlisten;
    }).finally(() => {
        configImportedListenPromise = null;
    });
    await configImportedListenPromise;
}

function createDesktopAPI() {
    return {
        async getConfig(key: string) {
            return invoke('get_config', { key });
        },
        async setConfig(key: string, value: any) {
            await invoke('set_config', { key, value });
        },
        async getAllConfig() {
            return invoke<AppConfig>('get_all_config');
        },
        async getAutoLaunch() {
            return invoke<boolean>('get_auto_launch');
        },
        async setAutoLaunch(enabled: boolean) {
            return invoke<boolean>('set_auto_launch', { enabled });
        },
        async getMapping(modelType: LegacyMappingType) {
            return invoke<string>('get_mapping', { modelType });
        },
        async setMapping(modelType: LegacyMappingType, value: string) {
            await invoke('set_mapping', { modelType, value });
        },
        async getAvailableTargets() {
            return invoke<string[]>('get_available_targets');
        },
        async checkSystemEnv() {
            return invoke<string | null>('check_system_env');
        },
        async setSystemEnv(url: string | null) {
            return invoke<boolean>('set_system_env', { url });
        },
        async startProxy() {
            return invoke<{ success: boolean; port: number; error?: string; alreadyRunning?: boolean }>('start_proxy');
        },
        async stopProxy() {
            await invoke('stop_proxy');
        },
        async getProxyStatus() {
            return invoke<{ running: boolean; port: number }>('get_proxy_status');
        },
        async restartProxy() {
            return invoke<{ success: boolean; port: number; error?: string; alreadyRunning?: boolean }>('restart_proxy');
        },
        async releasePortProcess(port?: number) {
            return invoke<ReleasePortResult>('release_port_process', { port });
        },
        async testProviderModel(request: TestProviderModelRequest) {
            return invoke<TestProviderModelResponse>('test_provider_model', { request });
        },
        async exportConfig() {
            try {
                const path = await invoke<string>('export_config');
                return { success: true, path };
            } catch (error: any) {
                return { success: false, error: error?.message || '导出失败' };
            }
        },
        async importConfig() {
            try {
                const path = await invoke<string>('import_config');
                return { success: true, path };
            } catch (error: any) {
                return { success: false, error: error?.message || '导入失败' };
            }
        },
        async getLogs() {
            return invoke<ProxyLogPayload[]>('get_logs');
        },
        async clearLogs() {
            await invoke('clear_logs');
        },
        async getTokenUsageRecords() {
            return invoke<TokenUsageRecord[]>('get_token_usage_records');
        },
        async clearTokenUsageRecords() {
            await invoke('clear_token_usage_records');
        },
        onProxyLog(callback: (data: ProxyLogPayload) => void) {
            proxyLogCallbacks.add(callback);
            void ensureProxyLogListener();
        },
        removeProxyLogListener(callback?: (data: ProxyLogPayload) => void) {
            if (callback) proxyLogCallbacks.delete(callback);
            else proxyLogCallbacks.clear();
        },
        onConfigUpdated(callback: (payload: ConfigUpdatePayload) => void) {
            configUpdatedCallbacks.add(callback);
            void ensureConfigUpdatedListener();
        },
        removeConfigUpdatedListener(callback?: (payload: ConfigUpdatePayload) => void) {
            if (callback) configUpdatedCallbacks.delete(callback);
            else configUpdatedCallbacks.clear();
        },
        onConfigImported(callback: () => void) {
            configImportedCallbacks.add(callback);
            void ensureConfigImportedListener();
        },
        removeConfigImportedListener(callback?: () => void) {
            if (callback) configImportedCallbacks.delete(callback);
            else configImportedCallbacks.clear();
        },
    };
}

export async function installDesktopTauriAPI() {
    window.electronAPI = (isTauriRuntime() ? createDesktopAPI() : createBrowserAPI()) as any;
}

export async function canUseDesktopTauriAPI() {
    if (typeof window === 'undefined' || !isTauriRuntime()) return false;
    try {
        await invoke('get_proxy_status');
        return true;
    } catch {
        return false;
    }
}

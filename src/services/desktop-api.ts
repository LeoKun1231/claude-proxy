import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppConfig, LegacyMappingType } from '../types/config';
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
};
type ConfigUpdatePayload = { key: string; updatedAt: number };
type ReleasePortResult = {
    success: boolean;
    port: number;
    stoppedSelfProxy: boolean;
    processes: Array<{ pid: number; name: string }>;
    message: string;
};

const proxyLogCallbacks = new Set<(data: ProxyLogPayload) => void>();
const configUpdatedCallbacks = new Set<(payload: ConfigUpdatePayload) => void>();
const configImportedCallbacks = new Set<() => void>();
let proxyLogUnlisten: UnlistenFn | null = null;
let configUpdatedUnlisten: UnlistenFn | null = null;
let configImportedUnlisten: UnlistenFn | null = null;

async function ensureProxyLogListener() {
    if (proxyLogUnlisten) return;
    proxyLogUnlisten = await listen<ProxyLogPayload>('proxy-log', (event) => {
        proxyLogCallbacks.forEach((callback) => callback(event.payload));
    });
}

async function ensureConfigUpdatedListener() {
    if (configUpdatedUnlisten) return;
    configUpdatedUnlisten = await listen<{ key: string; updated_at: number }>('config-updated', (event) => {
        const payload: ConfigUpdatePayload = {
            key: event.payload.key,
            updatedAt: event.payload.updated_at,
        };
        configUpdatedCallbacks.forEach((callback) => callback(payload));
    });
}

async function ensureConfigImportedListener() {
    if (configImportedUnlisten) return;
    configImportedUnlisten = await listen('config-imported', () => {
        configImportedCallbacks.forEach((callback) => callback());
    });
}

async function cleanupEventListener(kind: 'proxy' | 'configUpdated' | 'configImported') {
    if (kind === 'proxy' && proxyLogCallbacks.size === 0 && proxyLogUnlisten) {
        await proxyLogUnlisten();
        proxyLogUnlisten = null;
    }
    if (kind === 'configUpdated' && configUpdatedCallbacks.size === 0 && configUpdatedUnlisten) {
        await configUpdatedUnlisten();
        configUpdatedUnlisten = null;
    }
    if (kind === 'configImported' && configImportedCallbacks.size === 0 && configImportedUnlisten) {
        await configImportedUnlisten();
        configImportedUnlisten = null;
    }
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
            void cleanupEventListener('proxy');
        },
        onConfigUpdated(callback: (payload: ConfigUpdatePayload) => void) {
            configUpdatedCallbacks.add(callback);
            void ensureConfigUpdatedListener();
        },
        removeConfigUpdatedListener(callback?: (payload: ConfigUpdatePayload) => void) {
            if (callback) configUpdatedCallbacks.delete(callback);
            else configUpdatedCallbacks.clear();
            void cleanupEventListener('configUpdated');
        },
        onConfigImported(callback: () => void) {
            configImportedCallbacks.add(callback);
            void ensureConfigImportedListener();
        },
        removeConfigImportedListener(callback?: () => void) {
            if (callback) configImportedCallbacks.delete(callback);
            else configImportedCallbacks.clear();
            void cleanupEventListener('configImported');
        },
    };
}

export async function installDesktopTauriAPI() {
    window.electronAPI = createDesktopAPI() as any;
}

export async function canUseDesktopTauriAPI() {
    if (typeof window === 'undefined') return false;
    try {
        await invoke('get_proxy_status');
        return true;
    } catch {
        return false;
    }
}

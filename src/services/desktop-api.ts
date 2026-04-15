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
    tokenUsage?: TokenUsagePayload;
};
type ConfigUpdatePayload = { key: string; updatedAt: number };

const proxyLogCallbacks = new Set<(data: ProxyLogPayload) => void>();
const configUpdatedCallbacks = new Set<(payload: ConfigUpdatePayload) => void>();
const configImportedCallbacks = new Set<() => void>();
const contextMenuCommandCallbacks = new Set<(value: string) => void>();
let proxyLogUnlisten: UnlistenFn | null = null;
let configUpdatedUnlisten: UnlistenFn | null = null;
let configImportedUnlisten: UnlistenFn | null = null;
let contextMenuCommandUnlisten: UnlistenFn | null = null;

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

async function ensureContextMenuCommandListener() {
    if (contextMenuCommandUnlisten) return;
    contextMenuCommandUnlisten = await listen<{ value: string }>('context-menu-command', (event) => {
        contextMenuCommandCallbacks.forEach((callback) => callback(event.payload.value));
    });
}

async function cleanupEventListener(kind: 'proxy' | 'configUpdated' | 'configImported' | 'contextMenuCommand') {
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
    if (kind === 'contextMenuCommand' && contextMenuCommandCallbacks.size === 0 && contextMenuCommandUnlisten) {
        await contextMenuCommandUnlisten();
        contextMenuCommandUnlisten = null;
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
        async showFloatWindow() {
            await invoke('show_float_window');
        },
        async hideFloatWindow() {
            await invoke('hide_float_window');
        },
        async showMainWindow() {
            await invoke('show_main_window');
        },
        async hideMainWindow() {
            await invoke('hide_main_window');
        },
        async moveFloatWindow(x: number, y: number) {
            await invoke('move_float_window', { x, y });
        },
        async exportConfig() {
            const config = await invoke('export_config');
            const fileName = `claude-proxy-config-${createTimestamp()}.json`;
            downloadJsonFile(config, fileName);
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
                await invoke('import_config', { config: parsed });
                return { success: true };
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
        showContextMenu(options: { label: string; value: string; checked?: boolean }[]) {
            void invoke('show_context_menu', { options });
        },
        onContextMenuCommand(callback: (value: string) => void) {
            contextMenuCommandCallbacks.add(callback);
            void ensureContextMenuCommandListener();
        },
        removeContextMenuListener() {
            contextMenuCommandCallbacks.clear();
            void cleanupEventListener('contextMenuCommand');
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

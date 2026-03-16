/// <reference types="vite/client" />

// 扩展 CSS 属性类型以支持 Electron 特有属性
import 'react';
import type { AppConfig, LegacyMappingType } from './types/config';

declare module 'react' {
    interface CSSProperties {
        WebkitAppRegion?: 'drag' | 'no-drag';
    }
}

interface ElectronAPI {
    getConfig: (key: string) => Promise<any>;
    setConfig: (key: string, value: any) => Promise<void>;
    getAllConfig: () => Promise<AppConfig>;
    getAutoLaunch: () => Promise<boolean>;
    setAutoLaunch: (enabled: boolean) => Promise<boolean>;
    getMapping: (modelType: LegacyMappingType) => Promise<string>;
    setMapping: (modelType: LegacyMappingType, value: string) => Promise<void>;
    getAvailableTargets: () => Promise<string[]>;
    checkSystemEnv: () => Promise<string | null>;
    setSystemEnv: (url: string | null) => Promise<boolean>;
    startProxy: () => Promise<{ success: boolean; port: number; error?: string; alreadyRunning?: boolean }>;
    stopProxy: () => Promise<void>;
    getProxyStatus: () => Promise<{ running: boolean; port: number }>;
    restartProxy: () => Promise<{ success: boolean; port: number; error?: string; alreadyRunning?: boolean }>;
    showFloatWindow: () => Promise<void>;
    hideFloatWindow: () => Promise<void>;
    showMainWindow: () => Promise<void>;
    hideMainWindow: () => Promise<void>;
    moveFloatWindow: (x: number, y: number) => Promise<void>;
    exportConfig: () => Promise<{ success: boolean; path?: string; error?: string }>;
    importConfig: () => Promise<{ success: boolean; error?: string }>;
    showContextMenu: (options: { label: string; value: string; checked?: boolean }[]) => void;
    onContextMenuCommand: (callback: (value: string) => void) => void;
    removeContextMenuListener: () => void;
    onProxyLog: (callback: (data: { message: string; type: string; timestamp: string }) => void) => void;
    removeProxyLogListener: (callback?: (data: { message: string; type: string; timestamp: string }) => void) => void;
    onConfigUpdated: (callback: (payload: { key: string; updatedAt: number }) => void) => void;
    removeConfigUpdatedListener: (callback?: (payload: { key: string; updatedAt: number }) => void) => void;
    onConfigImported: (callback: () => void) => void;
    removeConfigImportedListener: (callback?: () => void) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };

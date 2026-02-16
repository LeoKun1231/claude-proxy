import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    getConfig: (key: string) => ipcRenderer.invoke('get-config', key),
    setConfig: (key: string, value: any) => ipcRenderer.invoke('set-config', key, value),
    getAllConfig: () => ipcRenderer.invoke('get-all-config'),
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),
    getMapping: (modelType: string) => ipcRenderer.invoke('get-mapping', modelType),
    setMapping: (modelType: string, value: string) => ipcRenderer.invoke('set-mapping', modelType, value),
    getAvailableTargets: () => ipcRenderer.invoke('get-available-targets'),
    checkSystemEnv: () => ipcRenderer.invoke('check-system-env'),
    setSystemEnv: (url: string | null) => ipcRenderer.invoke('set-system-env', url),
    startProxy: () => ipcRenderer.invoke('start-proxy'),
    stopProxy: () => ipcRenderer.invoke('stop-proxy'),
    getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
    restartProxy: () => ipcRenderer.invoke('restart-proxy'),
    showFloatWindow: () => ipcRenderer.invoke('show-float-window'),
    hideFloatWindow: () => ipcRenderer.invoke('hide-float-window'),
    showMainWindow: () => ipcRenderer.invoke('show-main-window'),
    hideMainWindow: () => ipcRenderer.invoke('hide-main-window'),
    moveFloatWindow: (x: number, y: number) => ipcRenderer.invoke('move-float-window', x, y),
    exportConfig: () => ipcRenderer.invoke('export-config'),
    importConfig: () => ipcRenderer.invoke('import-config'),
    showContextMenu: (options: any[]) => ipcRenderer.send('show-context-menu', options),
    onContextMenuCommand: (callback: any) => ipcRenderer.on('context-menu-command', (_event, value) => callback(value)),
    removeContextMenuListener: () => ipcRenderer.removeAllListeners('context-menu-command'),
    onProxyLog: (callback: any) => ipcRenderer.on('proxy-log', (_event, data) => callback(data)),
    removeProxyLogListener: () => ipcRenderer.removeAllListeners('proxy-log'),
    onConfigImported: (callback: any) => ipcRenderer.on('config-imported', () => callback()),
})

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector: string, text: string) => {
        const element = document.getElementById(selector)
        if (element) element.innerText = text
    }

    for (const type of ['chrome', 'node', 'electron'] as const) {
        const version = process.versions[type]
        if (version) replaceText(`${type}-version`, version)
    }
})

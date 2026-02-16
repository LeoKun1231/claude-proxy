import { app, BrowserWindow, shell, ipcMain, Tray, Menu } from 'electron'
import { release } from 'os'
import path from 'path'
import ElectronStore from 'electron-store'
import { startProxyServer, stopProxyServer, getProxyStatus } from './proxy-server'

// Initialize electron store
const store = new ElectronStore()

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// 在 WSL/Linux 图形兼容性较差的环境中降级到软件渲染，避免 GPU 进程崩溃
const isWslLikeLinux = process.platform === 'linux' && release().toLowerCase().includes('microsoft')
if (isWslLikeLinux) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-software-rasterizer')
}

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}

// 设置资源路径
process.env.DIST = path.join(__dirname, '../dist')
process.env.PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null = null
let floatWin: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// 广播配置变更，确保主窗口和悬浮球都能实时刷新
function broadcastConfigUpdated(key: string) {
    const payload = { key, updatedAt: Date.now() };
    for (const windowInstance of BrowserWindow.getAllWindows()) {
        if (!windowInstance.isDestroyed()) {
            windowInstance.webContents.send('config-updated', payload);
        }
    }
}

// Here, you can also use other preload
const preload = path.join(__dirname, 'preload.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = path.join(process.env.DIST, 'index.html')

async function createWindow() {
    win = new BrowserWindow({
        title: 'Claude Proxy',
        width: 1200,
        height: 800,
        icon: path.join(process.env.PUBLIC || '', 'icon.png'),
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: true,
        },
    })

    if (process.env.VITE_DEV_SERVER_URL && url) {
        win.loadURL(url)
    } else {
        win.loadFile(indexHtml)
    }

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', new Date().toLocaleString())
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) shell.openExternal(url)
        return { action: 'deny' }
    })

    // 点击关闭按钮时隐藏窗口而不是退出
    win.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault()
            win?.hide()
        }
    })

    // 创建系统托盘
    createTray()
}

// 创建系统托盘
function createTray() {
    const iconPath = path.join(process.env.PUBLIC || '', 'icon.png')
    tray = new Tray(iconPath)

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                win?.show()
            }
        },
        {
            label: '隐藏窗口',
            click: () => {
                win?.hide()
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                isQuitting = true
                app.quit()
            }
        }
    ])

    tray.setToolTip('Claude Proxy')
    tray.setContextMenu(contextMenu)

    // 双击托盘图标显示窗口
    tray.on('double-click', () => {
        win?.show()
    })
}

// 创建悬浮球窗口
function createFloatWindow() {
    if (floatWin) {
        floatWin.show();
        return;
    }

    floatWin = new BrowserWindow({
        width: 60,
        height: 60,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: true,
        },
    });

    if (process.env.VITE_DEV_SERVER_URL && url) {
        floatWin.loadURL(`${url}#/float`);
    } else {
        floatWin.loadFile(indexHtml, { hash: '/float' });
    }

    floatWin.setIgnoreMouseEvents(false);

    floatWin.on('closed', () => {
        floatWin = null;
    });
}

// --- Business Logic Handlers (注册在 app.whenReady 之前) ---

// Config
ipcMain.handle('get-config', (_, key) => store.get(key));
ipcMain.handle('set-config', (_, key, value) => {
    store.set(key, value);
    broadcastConfigUpdated(key);
    return true;
});
ipcMain.handle('get-all-config', () => store.store);

// 开机自启
ipcMain.handle('get-auto-launch', () => {
    return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('set-auto-launch', (_, enabled: boolean) => {
    app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false
    });
    return true;
});

// Mapping
ipcMain.handle('get-mapping', (_, type) => {
    const value = store.get(`mapping.${type}`);
    return value || 'pass';
});
ipcMain.handle('set-mapping', (_, type, value) => {
    store.set(`mapping.${type}`, value);
    return true;
});

// Proxy Server
ipcMain.handle('get-available-targets', () => {
    const targets = ['pass'];

    // 从配置中读取 Provider 的模型
    const providers = store.get('providers', {}) as any;
    if (providers && typeof providers === 'object') {
        // 遍历内置 providers
        Object.keys(providers).forEach(key => {
            if (key !== 'customProviders') {
                const provider = providers[key];
                if (provider && provider.enabled && Array.isArray(provider.models)) {
                    provider.models.forEach((model: string) => {
                        const target = `${key}:${model}`;
                        if (model && !targets.includes(target)) {
                            targets.push(target);
                        }
                    });
                }
            }
        });

        // 读取自定义 Provider 的模型
        const customProviders = providers.customProviders;
        if (Array.isArray(customProviders)) {
            customProviders.forEach((provider: any) => {
                if (provider.enabled && Array.isArray(provider.models)) {
                    provider.models.forEach((model: string) => {
                        const target = `${provider.id}:${model}`;
                        if (model && !targets.includes(target)) {
                            targets.push(target);
                        }
                    });
                }
            });
        }
    }

    return targets;
});
ipcMain.handle('check-system-env', () => {
    const value = store.get('system_env_url', null);
    return value;
});
ipcMain.handle('set-system-env', (_, url) => {
    if (url === null) {
        store.delete('system_env_url');
    } else {
        store.set('system_env_url', url);
    }
    return true;
});

ipcMain.handle('start-proxy', async () => {
    const result = await startProxyServer(5055, (log) => {
        if (win) {
            win.webContents.send('proxy-log', log);
        }
    });
    return result;
});

ipcMain.handle('stop-proxy', async () => {
    const result = await stopProxyServer((log) => {
        if (win) {
            win.webContents.send('proxy-log', log);
        }
    });
    return result;
});

ipcMain.handle('get-proxy-status', () => {
    return getProxyStatus();
});

ipcMain.handle('restart-proxy', async () => {
    await stopProxyServer();
    const result = await startProxyServer(5055, (log) => {
        if (win) {
            win.webContents.send('proxy-log', log);
        }
    });
    return result;
});

// Window Control
ipcMain.handle('show-main-window', () => {
    if (win) {
        win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});
ipcMain.handle('hide-main-window', () => {
    if (win) {
        win.hide();
    }
});

// Float Window
ipcMain.handle('show-float-window', () => {
    createFloatWindow();
});
ipcMain.handle('hide-float-window', () => {
    if (floatWin) {
        floatWin.hide();
    }
});
ipcMain.handle('move-float-window', (_, x, y) => {
    if (floatWin) {
        floatWin.setPosition(x, y);
    }
});

// 悬浮球右键菜单 - 模型切换
ipcMain.on('show-context-menu', (event, options: Array<{ label: string; value: string; checked: boolean }>) => {
    const menuItems = options.map((option) => ({
        label: option.label,
        type: 'radio' as const,
        checked: option.checked,
        click: () => {
            // 发送选中的模型值回渲染进程
            event.sender.send('context-menu-command', option.value);
        }
    }));

    // 添加分隔线和其他选项
    menuItems.push({ type: 'separator' } as any);
    menuItems.push({
        label: '显示主窗口',
        type: 'normal' as any,
        checked: false,
        click: () => {
            if (win) {
                win.show();
                win.focus();
            }
        }
    } as any);
    menuItems.push({
        label: '隐藏悬浮球',
        type: 'normal' as any,
        checked: false,
        click: () => {
            if (floatWin) {
                floatWin.hide();
            }
        }
    } as any);

    const contextMenu = Menu.buildFromTemplate(menuItems);
    contextMenu.popup();
});

// Import/Export
ipcMain.handle('export-config', () => {
    return { success: true };
});
ipcMain.handle('import-config', () => {
    return { success: true };
});

// New window
ipcMain.handle('open-win', (_, arg) => {
    const childWindow = new BrowserWindow({
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: true,
        },
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        childWindow.loadURL(`${url}#${arg}`)
    } else {
        childWindow.loadFile(indexHtml, { hash: arg })
    }
});

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    // 保持应用在托盘中运行，不退出
    win = null
})

app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
    }
})

app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length) {
        allWindows[0].focus()
    } else {
        createWindow()
    }
})

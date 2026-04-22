/**
 * 悬浮球组件 - 点击展开菜单，菜单显示在球下方
 */
import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Rocket, Check, Wifi, WifiOff, Power } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import './FloatBall.css';

// 球体和窗口的尺寸常量
const BALL_SIZE = 48;
const WINDOW_COLLAPSED = 72; // 收起时的窗口大小
const MENU_WIDTH = 296;
const MENU_ITEM_HEIGHT = 36;
const MENU_MAX_LIST_HEIGHT = 320;
const MENU_CHROME_HEIGHT = 120; // header + section label + divider + action + padding
const BALL_MENU_GAP = 8;

interface MenuOption {
    label: string;
    value: string;
    checked: boolean;
}

function FloatBall() {
    const [activeLabel, setActiveLabel] = useState<string>('透传 (不修改)');
    const [providers, setProviders] = useState<any[]>([]);
    const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number }>({ running: false, port: 5055 });
    const [activeTarget, setActiveTarget] = useState<string>('pass');
    const [menuVisible, setMenuVisible] = useState(false);
    const [toggling, setToggling] = useState(false);
    const ballRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);


    // 加载数据
    const loadData = useCallback(async () => {
        try {
            const [status, allConfig] = await Promise.all([
                window.electronAPI.getProxyStatus(),
                window.electronAPI.getAllConfig()
            ]);

            setProxyStatus(prev => {
                if (prev.running !== status.running || prev.port !== status.port) {
                    return status;
                }
                return prev;
            });

            const customProviders = Array.isArray(allConfig.providers?.customProviders) 
                ? allConfig.providers.customProviders 
                : [];
            setProviders(customProviders);

            // Determine active provider from modelRoutes
            const routes = Array.isArray(allConfig.modelRoutes) ? allConfig.modelRoutes : [];
            let currentTarget = 'pass';
            let currentLabel = '透传 (未选择)';
            
            if (routes.length === 1 && routes[0].sourceModel === '*') {
                const r = routes[0];
                currentTarget = `${r.providerId}:${r.targetModel || ''}`;
                const providerObj = customProviders.find((p: any) => p.id === r.providerId);
                currentLabel = providerObj ? `${providerObj.name}${r.targetModel ? ` / ${r.targetModel}` : ''}` : `未知服务商 (${r.providerId})`;
            }

            setActiveTarget(currentTarget);
            setActiveLabel(currentLabel);
        } catch (error) {
            console.error('加载数据失败:', error);
        }
    }, []);

    // 窗口挂载时强制置顶（Linux/Wayland 下 show 后可能丢失 always_on_top）
    useEffect(() => {
        const win = getCurrentWindow();
        win.setAlwaysOnTop(true).catch((err) => {
            console.warn('设置置顶失败:', err);
        });
    }, []);

    // 轮询与事件监听
    useEffect(() => {
        const interval = setInterval(loadData, 5000);
        loadData();

        const handleConfigImported = () => loadData();
        const handleConfigUpdated = () => loadData();

        window.electronAPI.onConfigImported?.(handleConfigImported);
        window.electronAPI.onConfigUpdated?.(handleConfigUpdated);

        return () => {
            clearInterval(interval);
            window.electronAPI.removeConfigImportedListener?.(handleConfigImported);
            window.electronAPI.removeConfigUpdatedListener?.(handleConfigUpdated);
        };
    }, [loadData]);

    // 计算菜单需要的窗口高度
    const getMenuOptions = useCallback((): MenuOption[] => {
        const options: MenuOption[] = [{
            label: '透传 (不拦截)',
            value: 'pass',
            checked: activeTarget === 'pass'
        }];

        providers.forEach(p => {
            if (p.models && p.models.length > 0) {
                p.models.forEach((m: string) => {
                    const val = `${p.id}:${m}`;
                    options.push({
                        label: `${p.name} - ${m}`,
                        value: val,
                        checked: activeTarget === val
                    });
                });
            } else {
                const val = `${p.id}:`;
                options.push({
                    label: `${p.name} (全局匹配)`,
                    value: val,
                    checked: activeTarget === val
                });
            }
        });

        return options;
    }, [providers, activeTarget]);

    const menuOptions = getMenuOptions();

    // 展开/收起菜单时动态调整窗口尺寸
    const resizeWindow = useCallback(async (expanded: boolean) => {
        const win = getCurrentWindow();
        if (expanded) {
            const menuHeight = Math.min(menuOptions.length * MENU_ITEM_HEIGHT, MENU_MAX_LIST_HEIGHT) + MENU_CHROME_HEIGHT;
            const totalHeight = WINDOW_COLLAPSED + BALL_MENU_GAP + menuHeight;
            const totalWidth = Math.max(WINDOW_COLLAPSED, MENU_WIDTH + 24);
            await win.setSize(new LogicalSize(totalWidth, totalHeight));
        } else {
            await win.setSize(new LogicalSize(WINDOW_COLLAPSED, WINDOW_COLLAPSED));
        }
    }, [menuOptions.length]);

    // 打开菜单
    const openMenu = useCallback(async () => {
        await resizeWindow(true);
        // 短暂延迟等窗口 resize 完成
        requestAnimationFrame(() => {
            setMenuVisible(true);
        });
    }, [resizeWindow]);

    // 关闭菜单
    const closeMenu = useCallback(async () => {
        setMenuVisible(false);
        requestAnimationFrame(() => {
            void resizeWindow(false);
        });
    }, [resizeWindow]);

    // 点击外部关闭菜单
    useEffect(() => {
        if (!menuVisible) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                ballRef.current && !ballRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                closeMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuVisible, closeMenu]);

    const handleOpenMain = useCallback(() => {
        closeMenu();
        window.electronAPI.showMainWindow?.();
    }, [closeMenu]);

    // 启动/停止代理引擎
    const handleToggleProxy = useCallback(async () => {
        if (toggling) return;
        setToggling(true);
        try {
            if (proxyStatus.running) {
                await window.electronAPI.stopProxy();
            } else {
                await window.electronAPI.startProxy();
            }
            await loadData();
        } catch (error) {
            console.error('切换代理状态失败:', error);
        } finally {
            setToggling(false);
        }
    }, [toggling, proxyStatus.running, loadData]);

    const handleSwitchTarget = useCallback(async (value: string) => {
        // 先关闭菜单
        await closeMenu();
        try {
            if (value === 'pass') {
                await window.electronAPI.setConfig('modelRoutes', []);
            } else {
                const [pid, ...rest] = value.split(':');
                const targetModel = rest.join(':');
                const cfg = await window.electronAPI.getAllConfig();
                const cp = (cfg.providers?.customProviders || []).find((p: any) => p.id === pid);
                
                if (cp) {
                    const catchAllRoute = {
                        id: `route_catchall_${Date.now()}`,
                        enabled: true,
                        sourceModel: '*',
                        targetModel: targetModel || '',
                        providerId: cp.id,
                        providerLabel: cp.name,
                        baseUrl: cp.baseUrl,
                        apiKey: cp.apiKey || '',
                    };
                    await window.electronAPI.setConfig('modelRoutes', [catchAllRoute]);
                }
            }
            
            await window.electronAPI.setMapping('main', 'pass');
            await window.electronAPI.setMapping('haiku', 'pass');
            await window.electronAPI.restartProxy();
            loadData();
        } catch (error) {
            console.error('切换失败:', error);
        }
    }, [loadData, closeMenu]);

    // 左键：区分点击 vs 拖拽
    // mousedown → 记录起点，监听 mousemove/mouseup
    // mousemove → 位移>5px 时调用 startDragging()（Tauri 接管，mouseup 不再触发）
    // mouseup → 位移<5px，视为点击，toggle 菜单
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        let dragStarted = false;

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (dragStarted) return;
            const dx = Math.abs(moveEvent.clientX - startX);
            const dy = Math.abs(moveEvent.clientY - startY);
            if (dx > 5 || dy > 5) {
                dragStarted = true;
                cleanup();
                // 菜单展开时先关闭再拖
                if (menuVisible) {
                    closeMenu();
                }
                void getCurrentWindow().startDragging().catch(() => {});
            }
        };

        const onMouseUp = () => {
            cleanup();
            if (!dragStarted) {
                // 没有拖拽 → 视为点击
                if (menuVisible) {
                    closeMenu();
                } else {
                    openMenu();
                }
            }
        };

        const cleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [menuVisible, closeMenu, openMenu]);

    // 右键也可以打开菜单
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (menuVisible) {
            closeMenu();
        } else {
            openMenu();
        }
    }, [menuVisible, closeMenu, openMenu]);

    return (
        <div className="float-ball-stage">
            {/* 球体 */}
            <div
                ref={ballRef}
                className={`float-ball ${proxyStatus.running ? 'running' : 'stopped'} ${menuVisible ? 'menu-open' : ''}`}
                title={`引擎状态: ${proxyStatus.running ? `运转中 (端口 ${proxyStatus.port})` : '已停止'}\n当前网关: ${activeLabel}`}
                onMouseDown={handleMouseDown}
                onContextMenu={handleContextMenu}
                onDoubleClick={handleOpenMain}
            >
                <Rocket className="float-ball-icon" />
                <span className={`float-ball-status-dot ${proxyStatus.running ? 'dot-running' : 'dot-stopped'}`} />
            </div>

            {/* 菜单 - 固定在球下方 */}
            {menuVisible && (
                <div
                    ref={menuRef}
                    className="float-context-menu"
                >
                    {/* 菜单头部 - 状态信息 + 启停按钮 */}
                    <div className="float-menu-header">
                        <span className={`float-menu-status-icon ${proxyStatus.running ? 'status-running' : 'status-stopped'}`}>
                            {proxyStatus.running
                                ? <Wifi className="w-3 h-3" />
                                : <WifiOff className="w-3 h-3" />
                            }
                        </span>
                        <span className="float-menu-status-text">{proxyStatus.running ? `运行中 :${proxyStatus.port}` : '已停止'}</span>
                        <button
                            className={`float-menu-power-btn ${proxyStatus.running ? 'power-running' : 'power-stopped'} ${toggling ? 'power-toggling' : ''}`}
                            onClick={handleToggleProxy}
                            title={proxyStatus.running ? '停止引擎' : '启动引擎'}
                        >
                            <Power className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="float-menu-section-label">切换网关</div>
                    <div className="float-menu-options">
                        {menuOptions.map((opt) => (
                            <div
                                key={opt.value}
                                className={`float-menu-item ${opt.checked ? 'active' : ''}`}
                                onClick={() => handleSwitchTarget(opt.value)}
                            >
                                <span className="float-menu-check">
                                    {opt.checked && <Check className="w-3 h-3" />}
                                </span>
                                <span className="float-menu-label">{opt.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="float-menu-divider" />
                    <div className="float-menu-item float-menu-item-action" onClick={handleOpenMain}>
                        <span className="float-menu-check" />
                        <span className="float-menu-label">打开主窗口</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default memo(FloatBall);

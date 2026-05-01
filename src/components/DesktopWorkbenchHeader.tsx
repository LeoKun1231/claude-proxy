import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

interface DesktopWorkbenchHeaderProps {
    isDesktopRuntime: boolean;
    proxyStatus: { running: boolean; port: number };
    onCopyProxyUrl: () => void;
    onCopyCommand: () => void;
    onExport: () => void;
    onImport: () => void;
}

export default function DesktopWorkbenchHeader({
    isDesktopRuntime,
    proxyStatus,
    onCopyProxyUrl,
    onCopyCommand,
    onExport,
    onImport,
}: DesktopWorkbenchHeaderProps) {
    const [isFullscreen, setIsFullscreen] = useState(false);

    // 监听窗口状态变化
    useEffect(() => {
        if (!isDesktopRuntime) return;

        const appWindow = getCurrentWindow();
        appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});

        let unlisten: (() => void) | undefined;
        appWindow.onResized(async () => {
            try {
                setIsFullscreen(await appWindow.isFullscreen());
            } catch {}
        }).then((fn) => { unlisten = fn; });

        return () => { unlisten?.(); };
    }, [isDesktopRuntime]);

    const handleMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (event.button !== 0 || !isDesktopRuntime) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-no-drag="true"]')) return;

        event.preventDefault();
        void getCurrentWindow().startDragging().catch((error) => {
            console.error('拖拽主窗口失败:', error);
        });
    }, [isDesktopRuntime]);

    // 双击标题栏切换全屏
    const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (!isDesktopRuntime) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-no-drag="true"]')) return;

        event.preventDefault();
        const appWindow = getCurrentWindow();
        appWindow.isFullscreen().then((fs) => {
            void appWindow.setFullscreen(!fs);
            setIsFullscreen(!fs);
        }).catch(console.error);
    }, [isDesktopRuntime]);

    const handleMinimize = useCallback(async () => {
        try {
            await getCurrentWindow().minimize();
        } catch (e) {
            console.error('最小化失败:', e);
        }
    }, []);

    const handleToggleFullscreen = useCallback(async () => {
        try {
            const appWindow = getCurrentWindow();
            const fs = await appWindow.isFullscreen();
            await appWindow.setFullscreen(!fs);
            setIsFullscreen(!fs);
        } catch (e) {
            console.error('切换全屏失败:', e);
        }
    }, []);

    const handleClose = useCallback(async () => {
        try {
            await getCurrentWindow().hide();
        } catch (e) {
            console.error('隐藏窗口失败:', e);
        }
    }, []);

    return (
        <header
            className="title-bar sticky top-0 z-30 flex h-[52px] items-center justify-between gap-4 border-b border-border/40 px-4 bg-background/60 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
            data-tauri-drag-region
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary text-primary-foreground shadow-sm">
                    <Icon icon="ph:terminal-bold" className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex flex-col justify-center pt-0.5">
                    <p className="truncate text-[15px] font-semibold tracking-tight text-foreground/90 leading-none">Claude 代理网关</p>
                    <p className="truncate text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground mt-1 leading-none">Rust 桌面引擎</p>
                </div>
            </div>

            <div className="hidden min-w-0 items-center gap-2 lg:flex" data-no-drag="true">
                <Badge variant="outline" className="rounded-full border-border/50 bg-muted/20 text-[11px] backdrop-blur-sm px-2.5 py-0.5 shadow-sm">
                    {proxyStatus.running ? `端口 ${proxyStatus.port} 在线` : '代理已离线'}
                </Badge>
                <Badge variant="outline" className="rounded-full border-border/50 bg-muted/20 font-mono text-[11px] backdrop-blur-sm px-2.5 py-0.5 shadow-sm">
                    127.0.0.1:{proxyStatus.port}
                </Badge>
            </div>

            <div className="flex items-center gap-1.5" data-no-drag="true">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px] hover:bg-muted/50 transition-colors" title="复制代理地址" onClick={onCopyProxyUrl}>
                    <Icon icon="ph:copy-bold" className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px] hover:bg-muted/50 transition-colors" title="导出配置" onClick={onExport}>
                    <Icon icon="ph:download-simple-bold" className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px] hover:bg-muted/50 transition-colors" title="导入配置" onClick={onImport}>
                    <Icon icon="ph:upload-simple-bold" className="h-4 w-4 text-muted-foreground" />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Icon icon="ph:dots-three-bold" className="h-4.5 w-4.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="bottom" align="end" className="w-44 rounded-xl border-border/40 bg-background/80 backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
                        <DropdownMenuItem onClick={onCopyCommand} className="cursor-pointer rounded-lg hover:bg-muted/50 font-medium">
                            <Icon icon="ph:copy-bold" className="mr-2 h-4 w-4 text-muted-foreground" /> 复制环境命令
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* 窗口控制按钮 */}
                {isDesktopRuntime && (
                    <div className="ml-2 flex items-center border-l border-border/30 pl-2">
                        <button
                            onClick={handleMinimize}
                            className="inline-flex h-8 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                            title="最小化"
                        >
                            <Icon icon="ph:minus-bold" className="h-4 w-4" />
                        </button>
                        <button
                            onClick={handleToggleFullscreen}
                            className="inline-flex h-8 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                            title={isFullscreen ? '退出全屏' : '全屏'}
                        >
                            {isFullscreen
                                ? <Icon icon="ph:corners-in-bold" className="h-4 w-4" />
                                : <Icon icon="ph:corners-out-bold" className="h-4 w-4" />
                            }
                        </button>
                        <button
                            onClick={handleClose}
                            className="inline-flex h-8 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/90 hover:text-destructive-foreground"
                            title="关闭"
                        >
                            <Icon icon="ph:x-bold" className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

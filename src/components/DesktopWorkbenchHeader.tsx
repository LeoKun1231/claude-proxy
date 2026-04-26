import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Maximize2, Minimize2, MoreHorizontal, Shrink, Terminal, Upload, X } from 'lucide-react';
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
            className="title-bar sticky top-0 z-30 flex h-10 items-center justify-between gap-3 border-b px-3"
            data-tauri-drag-region
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground">
                    <Terminal className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <p className="truncate text-[16px] font-medium tracking-normal text-foreground">Claude 代理网关</p>
                    <p className="truncate text-[11px] uppercase tracking-[1.4px] text-muted-foreground mt-0.5">Rust 桌面引擎</p>
                </div>
            </div>

            <div className="hidden min-w-0 items-center gap-2 lg:flex" data-no-drag="true">
                <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[11px]">
                    {proxyStatus.running ? `端口 ${proxyStatus.port} 在线` : '代理已离线'}
                </Badge>
                <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 font-mono text-[11px]">
                    127.0.0.1:{proxyStatus.port}
                </Badge>
            </div>

            <div className="flex items-center gap-1" data-no-drag="true">
                <Button size="icon" variant="ghost" className="h-7 w-7" title="复制代理地址" onClick={onCopyProxyUrl}>
                    <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="导出配置" onClick={onExport}>
                    <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="导入配置" onClick={onImport}>
                    <Upload className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="bottom" align="end" className="w-44">
                        <DropdownMenuItem onClick={onCopyCommand} className="cursor-pointer">
                            <Copy className="mr-2 h-4 w-4" /> 复制环境命令
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* 窗口控制按钮 */}
                {isDesktopRuntime && (
                    <div className="ml-1.5 flex items-center border-l border-white/10 pl-1.5">
                        <button
                            onClick={handleMinimize}
                            className="inline-flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                            title="最小化"
                        >
                            <Minimize2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={handleToggleFullscreen}
                            className="inline-flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                            title={isFullscreen ? '退出全屏' : '全屏'}
                        >
                            {isFullscreen
                                ? <Shrink className="h-3.5 w-3.5" />
                                : <Maximize2 className="h-3.5 w-3.5" />
                            }
                        </button>
                        <button
                            onClick={handleClose}
                            className="inline-flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500/80 hover:text-white"
                            title="关闭"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

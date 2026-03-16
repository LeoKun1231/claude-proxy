import { useState, useCallback } from 'react';
import {
    Terminal, Download, Upload, Eye, EyeOff,
    Route, KeyRound, ScrollText, Settings, CircleDot,
    Copy, MoreHorizontal
} from 'lucide-react';
import EnvConfig from './components/EnvConfig';
import AppSettings from './components/Settings';
import StatusBar from './components/StatusBar';
import ModelMapping from './components/ModelMapping';
import ModelRoutes from './components/ModelRoutes';
import ProviderConfig from './components/ProviderConfig';
import LogViewer from './components/LogViewer';
import FloatBall from './components/FloatBall';
import { useProxyStatus, useLogs } from './hooks';

import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Separator } from './components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './components/ui/tooltip';
import { toast } from 'sonner';

type TabKey = 'routing' | 'providers' | 'logs' | 'settings';

const NAV_ITEMS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'routing', label: '路由设置', icon: Route },
    { key: 'providers', label: '服务商', icon: KeyRound },
    { key: 'logs', label: '运行日志', icon: ScrollText },
    { key: 'settings', label: '系统设置', icon: Settings },
];

export default function App() {
    const { status: proxyStatus, loading: proxyLoading, start, stop, restart } = useProxyStatus({
        pollInterval: 5000,
        backgroundPollInterval: 30000,
        fastPollCount: 3,
        fastPollInterval: 1000,
    });
    const { logs, clearLogs } = useLogs({ maxLogs: 200, autoScroll: false });
    const [activeTab, setActiveTab] = useState<TabKey>('routing');
    const isDesktopRuntime = typeof window !== 'undefined' && window.location.protocol === 'file:';

    const isFloatMode = window.location.hash === '#/float';
    if (isFloatMode) return <FloatBall />;

    const handleStart = useCallback(async () => {
        const result = await start();
        if (result.success) {
            if (result.alreadyRunning) {
                toast.info(`代理已在端口 ${result.port} 运行`);
            } else {
                toast.success(`已在端口 ${result.port} 启动`);
            }
            return;
        }

        toast.error('启动失败: ' + result.error);
    }, [start]);

    const handleStop = useCallback(async () => {
        await stop();
        toast.info('代理已停止');
    }, [stop]);

    const handleRestart = useCallback(async () => {
        const result = await restart();
        result.success ? toast.success('重启成功') : toast.error('重启失败: ' + result.error);
    }, [restart]);

    const handleExport = useCallback(async () => {
        if (!window.electronAPI?.exportConfig) return;
        const result = await window.electronAPI.exportConfig();
        if (result.success) toast.success('配置已导出');
        else if (result.error !== '已取消') toast.error('导出失败: ' + result.error);
    }, []);

    const handleImport = useCallback(async () => {
        if (!window.electronAPI?.importConfig) return;
        const result = await window.electronAPI.importConfig();
        if (result.success) {
            toast.success('配置已导入');
            setTimeout(() => window.location.reload(), 500);
        } else if (result.error !== '已取消') toast.error('导入失败: ' + result.error);
    }, []);

    const handleCopyProxyUrl = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(`http://127.0.0.1:${proxyStatus.port}`);
            toast.success('代理地址已复制');
        } catch { toast.error('复制失败'); }
    }, [proxyStatus.port]);

    return (
        <TooltipProvider>
            <div className="app-shell flex overflow-hidden bg-background">
                {/* ── Sidebar ── */}
                <aside className="w-56 flex flex-col border-r bg-sidebar shrink-0">
                    {/* Brand */}
                    <div className="px-5 pt-6 pb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-foreground text-background">
                                <Terminal className="w-4 h-4" />
                            </div>
                            <div>
                                <h1 className="text-sm font-semibold tracking-tight leading-none">Claude Proxy</h1>
                                <p className="text-[11px] text-muted-foreground mt-0.5">本地 API 网关</p>
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Status pill */}
                    <div className="px-4 py-4">
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
                            <CircleDot className={`w-3.5 h-3.5 ${proxyStatus.running ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                            <span className="text-xs font-medium">
                                {proxyStatus.running ? `已在端口 ${proxyStatus.port} 运行` : '已离线'}
                            </span>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-3 space-y-0.5">
                        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                                    activeTab === key
                                        ? 'bg-accent text-accent-foreground'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                {label}
                                {key === 'logs' && logs.length > 0 && (
                                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-5 min-w-5 justify-center">
                                        {logs.length}
                                    </Badge>
                                )}
                            </button>
                        ))}
                    </nav>

                    {/* Bottom actions */}
                    <div className="mt-auto border-t px-3 py-3 space-y-1">
                        <button onClick={handleCopyProxyUrl} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer transition-colors">
                            <Copy className="w-4 h-4" />
                            <span className="font-mono text-xs">127.0.0.1:{proxyStatus.port}</span>
                        </button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer transition-colors">
                                    <MoreHorizontal className="w-4 h-4" />
                                    更多选项
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side="right" align="end" className="w-44">
                                <DropdownMenuItem onClick={handleExport} className="cursor-pointer">
                                    <Download className="w-4 h-4 mr-2" /> 导出配置
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleImport} className="cursor-pointer">
                                    <Upload className="w-4 h-4 mr-2" /> 导入配置
                                </DropdownMenuItem>
                                {isDesktopRuntime && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => window.electronAPI?.showFloatWindow?.()} className="cursor-pointer">
                                            <Eye className="w-4 h-4 mr-2" /> 显示悬浮窗
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => window.electronAPI?.hideFloatWindow?.()} className="cursor-pointer">
                                            <EyeOff className="w-4 h-4 mr-2" /> 隐藏悬浮窗
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </aside>

                {/* ── Main Content ── */}
                <main className="flex-1 overflow-y-auto w-full min-w-0">
                    <div className="w-full px-8 py-8 space-y-6">
                        {/* Page Header */}
                        <div>
                            <h2 className="text-2xl font-semibold tracking-tight">
                                {NAV_ITEMS.find(n => n.key === activeTab)?.label}
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                {activeTab === 'routing' && '配置模型路由规则与回退策略'}
                                {activeTab === 'providers' && '管理后端 API 凭证与服务商设定'}
                                {activeTab === 'logs' && '监控代理请求与响应活动'}
                                {activeTab === 'settings' && '环境配置与系统偏好设置'}
                            </p>
                        </div>

                        <Separator />

                        {/* Tab Content */}
                        {activeTab === 'routing' && (
                            <div className="space-y-6">
                                <StatusBar status={proxyStatus} loading={proxyLoading} onStart={handleStart} onStop={handleStop} onRestart={handleRestart} />
                                <ModelMapping />
                                <ModelRoutes />
                            </div>
                        )}

                        {activeTab === 'providers' && (
                            <div className="space-y-6">
                                <ProviderConfig />
                            </div>
                        )}

                        {activeTab === 'logs' && (
                            <LogViewer logs={logs} onClear={clearLogs} />
                        )}

                        {activeTab === 'settings' && (
                            <div className="space-y-6">
                                <EnvConfig />
                                <AppSettings />
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </TooltipProvider>
    );
}

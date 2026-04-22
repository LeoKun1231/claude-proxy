import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Route, ScrollText, Settings, Activity, BarChart3 } from 'lucide-react';
import DesktopWorkbenchHeader from './DesktopWorkbenchHeader';
import EnvConfig from './EnvConfig';
import LogViewer from './LogViewer';
import ActiveProviderSwitcher from './ActiveProviderSwitcher';
import ProviderConfig from './ProviderConfig';
import RouterConfigPanel from './RouterConfig';
import AppSettings from './Settings';
import StatusBar from './StatusBar';
import TokenStatsPanel from './TokenStatsPanel';
import { cn } from '@/lib/utils';
import type { RoutingMode } from '@/types/config';

function RoutingModeView() {
    const [mode, setMode] = useState<RoutingMode | null>(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            if (!window.electronAPI?.getAllConfig) {
                if (mounted) setMode('gateway');
                return;
            }
            const cfg = await window.electronAPI.getAllConfig();
            if (!mounted) return;
            const raw = (cfg as any)?.routingMode;
            setMode(raw === 'routes' ? 'routes' : 'gateway');
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onConfigUpdated) return;
        const handler = ({ key }: { key: string }) => {
            if (key !== 'all' && key !== 'routingMode') return;
            void (async () => {
                const cfg = await window.electronAPI.getAllConfig();
                const raw = (cfg as any)?.routingMode;
                setMode(raw === 'routes' ? 'routes' : 'gateway');
            })();
        };
        window.electronAPI.onConfigUpdated(handler);
        return () => window.electronAPI.removeConfigUpdatedListener?.(handler);
    }, []);

    const switchMode = async (next: RoutingMode) => {
        if (next === mode) return;
        setMode(next);
        try {
            await window.electronAPI?.setConfig('routingMode', next);
        } catch {
            // 回滚发生错误时不处理，由配置事件拉回
        }
    };

    if (mode === null) return null;

    return (
        <div className="space-y-6">
            <div className="inline-flex rounded-[50px] border border-[rgba(226,226,226,0.15)] bg-white/[0.02] p-1">
                <button
                    type="button"
                    onClick={() => switchMode('gateway')}
                    className={cn(
                        'px-5 py-2 rounded-[50px] text-[14px] font-medium transition-all outline-none',
                        mode === 'gateway'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    活跃网关
                </button>
                <button
                    type="button"
                    onClick={() => switchMode('routes')}
                    className={cn(
                        'px-5 py-2 rounded-[50px] text-[14px] font-medium transition-all outline-none',
                        mode === 'routes'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    路由规则
                </button>
            </div>
            {mode === 'gateway' ? <ActiveProviderSwitcher /> : <RouterConfigPanel />}
        </div>
    );
}

export type TabKey = 'routing' | 'providers' | 'tokens' | 'logs' | 'settings';

interface LogItem {
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    id?: string;
    repeatCount?: number;
}

interface DesktopWorkbenchProps {
    isDesktopRuntime: boolean;
    proxyStatus: { running: boolean; port: number };
    proxyLoading: boolean;
    logs: LogItem[];
    logsPaused: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
    onReleasePort: () => void;
    onClearLogs: () => void;
    onToggleLogsPause: () => void;
    onCopyProxyUrl: () => void;
    onCopyCommand: () => void;
    onExport: () => void;
    onImport: () => void;
}

const TAB_ITEMS = [
    {
        key: 'routing',
        label: '活跃网关',
        title: '网关代理节点',
        description: '一键选择并切换当前的全局代理网络，将流量无缝转发至目标底层服务商。',
        icon: Route,
    },
    {
        key: 'providers',
        label: '服务商列表',
        title: 'API 服务商与凭证池',
        description: '维护所有可用的上游 API 地址与鉴权信息，为路由规则提供共享的流媒体层。',
        icon: KeyRound,
    },
    {
        key: 'tokens',
        label: 'Token 统计',
        title: 'Token 消耗统计',
        description: '独立查看所有 provider 的 token 消耗，并按 provider 和时间范围筛选。',
        icon: BarChart3,
    },
    {
        key: 'logs',
        label: '实时日志',
        title: '交互日志与链路追踪',
        description: '直观跟踪 Rust 进程转发轨迹，定位上游兼容性及网络故障。',
        icon: ScrollText,
    },
    {
        key: 'settings',
        label: '系统偏好',
        title: '系统级配置',
        description: '桌面级启动管理、环境变量映射与其他偏好修改。',
        icon: Settings,
    },
] as const;

function SectionContent({
    activeTab,
    proxyStatus,
    proxyLoading,
    logs,
    logsPaused,
    onClearLogs,
    onToggleLogsPause,
    onStart,
    onStop,
    onRestart,
    onReleasePort,
}: {
    activeTab: TabKey;
    proxyStatus: { running: boolean; port: number };
    proxyLoading: boolean;
    logs: LogItem[];
    logsPaused: boolean;
    onClearLogs: () => void;
    onToggleLogsPause: () => void;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
    onReleasePort: () => void;
}) {
    if (activeTab === 'routing') {
        return (
            <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
                <StatusBar
                    status={proxyStatus}
                    loading={proxyLoading}
                    onStart={onStart}
                    onStop={onStop}
                    onRestart={onRestart}
                    onReleasePort={onReleasePort}
                />
                <RoutingModeView />
            </div>
        );
    }
    if (activeTab === 'providers') return <div className="animate-in fade-in duration-500 fill-mode-both"><ProviderConfig /></div>;
    if (activeTab === 'tokens') return <div className="animate-in fade-in duration-500 fill-mode-both"><TokenStatsPanel /></div>;
    if (activeTab === 'logs') {
        return (
            <div className="animate-in fade-in duration-500 fill-mode-both">
                <LogViewer logs={logs} paused={logsPaused} onTogglePause={onToggleLogsPause} onClear={onClearLogs} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <EnvConfig />
            <AppSettings />
        </div>
    );
}

export default function DesktopWorkbench({
    isDesktopRuntime,
    proxyStatus,
    proxyLoading,
    logs,
    logsPaused,
    onStart,
    onStop,
    onRestart,
    onReleasePort,
    onClearLogs,
    onToggleLogsPause,
    onCopyProxyUrl,
    onCopyCommand,
    onExport,
    onImport,
}: DesktopWorkbenchProps) {
    const [activeTab, setActiveTab] = useState<TabKey>('routing');
    const activeView = useMemo(
        () => TAB_ITEMS.find((item) => item.key === activeTab) ?? TAB_ITEMS[0],
        [activeTab]
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden text-foreground selection:bg-primary/30">
            <DesktopWorkbenchHeader
                isDesktopRuntime={isDesktopRuntime}
                proxyStatus={proxyStatus}
                onCopyProxyUrl={onCopyProxyUrl}
                onCopyCommand={onCopyCommand}
                onExport={onExport}
                onImport={onImport}
            />

            <div className="flex flex-1 overflow-hidden relative">
                {/* Premium Translucent Sidebar */}
                <aside className="w-64 border-r border-[rgba(226,226,226,0.15)] bg-transparent flex flex-col pt-3 z-10 selection:bg-primary/30">
                    <nav className="flex-1 space-y-1.5 px-3 overflow-y-auto">
                        <div className="px-2 pb-2 pt-2 mb-4">
                            <p className="text-[11px] font-medium uppercase tracking-[2.4px] text-muted-foreground">系统模块</p>
                        </div>
                        {TAB_ITEMS.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setActiveTab(item.key)}
                                className={cn(
                                    'w-full flex items-center gap-3 rounded-[50px] px-4 py-2.5 text-[14px] font-medium transition-all duration-200 outline-none select-none',
                                    activeTab === item.key
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                                )}
                            >
                                <item.icon className={cn("h-4 w-4", activeTab === item.key ? "text-primary-foreground" : "opacity-70")} />
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className="p-4 mt-auto border-t border-white/[0.04]">
                        <div className="flex items-center gap-3 rounded-xl bg-black/20 p-3 shadow-inner ring-1 ring-white/[0.05]">
                            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05] ring-1 ring-white/[0.1] shadow-xl">
                                {proxyStatus.running ? (
                                    <>
                                        <div className="absolute inset-0 rounded-[10px] bg-emerald-500/20 blur-md pointer-events-none" />
                                        <Activity className="h-4 w-4 text-emerald-400 z-10 relative" />
                                    </>
                                ) : (
                                    <Activity className="h-4 w-4 text-white/30" />
                                )}
                            </div>
                            <div className="min-w-0 pr-1">
                                <p className="truncate text-xs font-medium leading-tight tracking-[0px] text-foreground">
                                    {proxyStatus.running ? '系统云端在线' : '网络中断离线'}
                                </p>
                                <p className="truncate text-[10px] leading-tight text-white/40 mt-1">
                                    {proxyStatus.running ? `代理已打通端口 ${proxyStatus.port}` : '等待开启网关'}
                                </p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto relative bg-transparent scroll-smooth">
                    <div className="mx-auto w-full max-w-5xl px-8 py-10">
                        <header className="mb-8">
                            <h1 className="text-4xl font-normal tracking-[-0.72px] text-foreground">{activeView.title}</h1>
                            <p className="mt-2.5 text-[18px] text-muted-foreground font-normal leading-relaxed max-w-2xl">{activeView.description}</p>
                        </header>

                        <div className="min-h-[400px]">
                            <SectionContent
                                activeTab={activeTab}
                                proxyStatus={proxyStatus}
                                proxyLoading={proxyLoading}
                                logs={logs}
                                logsPaused={logsPaused}
                                onClearLogs={onClearLogs}
                                onToggleLogsPause={onToggleLogsPause}
                                onStart={onStart}
                                onStop={onStop}
                                onRestart={onRestart}
                                onReleasePort={onReleasePort}
                            />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

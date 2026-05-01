import { memo, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
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
import { useLogs } from '@/hooks';
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
            <div className="inline-flex rounded-[50px] border border-border/50 bg-muted/30 p-1">
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

interface DesktopWorkbenchProps {
    isDesktopRuntime: boolean;
    proxyStatus: { running: boolean; port: number };
    proxyLoading: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
    onReleasePort: () => void;
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
        icon: 'ph:route-bold',
    },
    {
        key: 'providers',
        label: '服务商列表',
        title: 'API 服务商与凭证池',
        description: '维护所有可用的上游 API 地址与鉴权信息，为路由规则提供共享的流媒体层。',
        icon: 'ph:key-bold',
    },
    {
        key: 'tokens',
        label: 'Token 统计',
        title: 'Token 消耗统计',
        description: '独立查看所有 provider 的 token 消耗，并按 provider 和时间范围筛选。',
        icon: 'ph:chart-bar-bold',
    },
    {
        key: 'logs',
        label: '实时日志',
        title: '交互日志与链路追踪',
        description: '直观跟踪 Rust 进程转发轨迹，定位上游兼容性及网络故障。',
        icon: 'ph:scroll-bold',
    },
    {
        key: 'settings',
        label: '系统偏好',
        title: '系统级配置',
        description: '桌面级启动管理、环境变量映射与其他偏好修改。',
        icon: 'ph:gear-bold',
    },
] as const;

function LogsSection() {
    const { logs, clearLogs, isPaused, togglePause } = useLogs({ maxLogs: 5000, autoScroll: false });

    return (
        <div className="animate-in fade-in duration-500 fill-mode-both">
            <LogViewer logs={logs} paused={isPaused} onTogglePause={togglePause} onClear={clearLogs} />
        </div>
    );
}

const SectionContent = memo(function SectionContent({
    activeTab,
    proxyStatus,
    proxyLoading,
    onStart,
    onStop,
    onRestart,
    onReleasePort,
}: {
    activeTab: TabKey;
    proxyStatus: { running: boolean; port: number };
    proxyLoading: boolean;
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
        return <LogsSection />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <EnvConfig />
            <AppSettings />
        </div>
    );
});

export default function DesktopWorkbench({
    isDesktopRuntime,
    proxyStatus,
    proxyLoading,
    onStart,
    onStop,
    onRestart,
    onReleasePort,
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
                <aside className="w-[280px] bg-background/30 backdrop-blur-3xl border-r border-border/40 flex flex-col z-10 selection:bg-primary/30 relative">
                    <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-50 pointer-events-none" />
                    <nav className="flex-1 space-y-1.5 px-4 pt-6 overflow-y-auto relative z-10">
                        <div className="px-2 pb-2 mb-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[3px] text-muted-foreground/80">核心模块</p>
                        </div>
                        {TAB_ITEMS.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setActiveTab(item.key)}
                                className={cn(
                                    'group w-full flex items-center gap-3.5 rounded-[14px] px-4 py-3.5 text-[14px] font-medium transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none select-none relative overflow-hidden',
                                    activeTab === item.key
                                        ? 'bg-primary/15 text-primary shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-primary/20'
                                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent'
                                )}
                            >
                                {activeTab === item.key && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/5 bg-primary rounded-r-full shadow-[0_0_12px_rgba(6,182,212,0.6)]"></div>
                                )}
                                <Icon icon={item.icon} className={cn("h-[22px] w-[22px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]", activeTab === item.key ? "scale-110 drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]" : "opacity-60 group-hover:scale-110 group-hover:opacity-100")} />
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className="p-4 mt-auto border-t border-border/30">
                        <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 shadow-inner ring-1 ring-border/30">
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/50 ring-1 ring-border/50 shadow-xl overflow-hidden">
                                {proxyStatus.running ? (
                                    <>
                                        <div className="absolute inset-0 bg-emerald-500/20 blur-xl pointer-events-none" />
                                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
                                        <Icon icon="ph:activity-bold" className="h-5 w-5 text-emerald-400 z-10 relative animate-pulse" />
                                    </>
                                ) : (
                                    <Icon icon="ph:activity-bold" className="h-5 w-5 text-muted-foreground/30" />
                                )}
                            </div>
                            <div className="min-w-0 pr-1">
                                <p className="truncate text-xs font-medium leading-tight tracking-[0px] text-foreground">
                                    {proxyStatus.running ? '系统云端在线' : '网络中断离线'}
                                </p>
                                <p className="truncate text-[10px] leading-tight text-muted-foreground mt-1">
                                    {proxyStatus.running ? `代理已打通端口 ${proxyStatus.port}` : '等待开启网关'}
                                </p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto relative bg-transparent scroll-smooth">
                    <div className="mx-auto w-full max-w-[1400px] px-10 py-12">
                        <header className="mb-12 relative">
                            <div className="absolute -left-10 top-0 w-1 h-full bg-primary/20 rounded-r-full" />
                            <h1 className="text-[42px] font-bold tracking-tight text-foreground/90 drop-shadow-sm">{activeView.title}</h1>
                            <p className="mt-3 text-[16px] text-muted-foreground/80 font-medium leading-relaxed max-w-2xl">{activeView.description}</p>
                        </header>

                        <div className="min-h-[400px]">
                            <SectionContent
                                activeTab={activeTab}
                                proxyStatus={proxyStatus}
                                proxyLoading={proxyLoading}
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

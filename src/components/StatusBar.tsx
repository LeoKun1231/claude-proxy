import { Icon } from '@iconify/react';
import { Button } from './ui/button';

interface StatusBarProps {
    status: { running: boolean; port: number };
    loading: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
    onReleasePort: () => void;
}

export default function StatusBar({ status, loading, onStart, onStop, onRestart, onReleasePort }: StatusBarProps) {
    return (
        <div className="flex items-center justify-between rounded-[24px] border border-border/40 bg-gradient-to-r from-card/60 to-transparent p-7 relative overflow-hidden group shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-md transition-all hover:border-primary/20">

            
            <div className="flex items-center gap-5 relative z-10">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-primary/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_20px_rgba(6,182,212,0.1)] border border-primary/20">
                    {status.running ? (
                        <>
                            <div className="absolute inset-0 bg-emerald-500/20 blur-xl pointer-events-none" />
                            <Icon icon="ph:activity-bold" className="h-7 w-7 text-emerald-400 z-10 relative drop-shadow-md animate-pulse" />
                        </>
                    ) : (
                        <Icon icon="ph:activity-bold" className="h-7 w-7 text-muted-foreground/40 z-10 relative" />
                    )}
                </div>
                <div>
                    <h2 className="text-[22px] leading-tight font-medium tracking-tight text-foreground">
                        {status.running ? '引擎正常运转' : '系统当前空闲'}
                    </h2>
                    <p className="text-[13px] uppercase tracking-[2px] text-muted-foreground mt-1.5 font-semibold opacity-80">
                        {status.running ? `代理网关挂载于本地端口 ${status.port}` : '代理服务已停止响应'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-3 relative z-10">
                {status.running ? (
                    <>
                        <Button variant="outline" size="sm" onClick={onRestart} disabled={loading} className="h-11 px-6 rounded-2xl bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary font-medium text-[15px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group/btn">
                            <Icon icon="ph:arrows-clockwise-bold" className={`w-4 h-4 mr-2.5 transition-transform group-hover/btn:rotate-180 ${loading ? 'animate-spin' : ''}`} />
                            重启服务
                        </Button>
                        <Button variant="outline" size="sm" onClick={onStop} disabled={loading} className="h-11 px-6 rounded-2xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 text-destructive font-medium text-[15px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group/btn">
                            <Icon icon="ph:stop-circle-bold" className="w-4 h-4 mr-2.5 transition-transform group-hover/btn:scale-110" />
                            断开服务
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onReleasePort}
                            disabled={loading}
                            className="h-11 px-6 rounded-2xl border-border/60 bg-muted/20 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 text-muted-foreground font-medium text-[15px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group/btn"
                        >
                            <Icon icon="ph:warning-circle-bold" className="w-4 h-4 mr-2.5 transition-transform group-hover/btn:scale-110" />
                            结束端口占用
                        </Button>
                        <Button size="sm" onClick={onStart} disabled={loading} className="h-11 px-8 rounded-2xl bg-primary border-t border-primary-foreground/20 hover:bg-primary/90 text-primary-foreground font-medium text-[15px] shadow-[0_4px_15px_rgba(6,182,212,0.3)] transition-all hover:-translate-y-0.5 group/btn">
                            <Icon icon="ph:play-circle-bold" className="w-5 h-5 mr-2.5 transition-transform group-hover/btn:scale-110" />
                            启动代理
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

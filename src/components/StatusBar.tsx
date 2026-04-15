import { Play, Square, RefreshCcw, Activity } from 'lucide-react';
import { Button } from './ui/button';

interface StatusBarProps {
    status: { running: boolean; port: number };
    loading: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
}

export default function StatusBar({ status, loading, onStart, onStop, onRestart }: StatusBarProps) {
    return (
        <div className="flex items-center justify-between rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-6 relative overflow-hidden group">

            
            <div className="flex items-center gap-4 relative z-10">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#353534]">
                    {status.running ? (
                        <Activity className="h-5 w-5 text-emerald-400 z-10 relative drop-shadow-md" />
                    ) : (
                        <Activity className="h-5 w-5 text-muted-foreground z-10 relative" />
                    )}
                </div>
                <div>
                    <h2 className="text-[20px] leading-tight font-normal tracking-[-0.2px] text-foreground">
                        {status.running ? '引擎正常运转' : '系统当前空闲'}
                    </h2>
                    <p className="text-[14px] uppercase tracking-[1.4px] text-muted-foreground mt-1 font-medium">
                        {status.running ? `代理网关挂载于本地端口 ${status.port}` : '代理服务已停止响应'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-3 relative z-10">
                {status.running ? (
                    <>
                        <Button variant="outline" size="sm" onClick={onRestart} disabled={loading} className="h-10 px-5 rounded-[50px] bg-primary border-none hover:bg-primary/90 text-primary-foreground font-medium text-[16px] shadow-none">
                            <RefreshCcw className={`w-4 h-4 mr-2.5 ${loading ? 'animate-spin' : ''}`} />
                            重启服务
                        </Button>
                        <Button variant="outline" size="sm" onClick={onStop} disabled={loading} className="h-10 px-5 rounded-[50px] bg-primary border-none hover:bg-primary/90 text-primary-foreground font-medium text-[16px] shadow-none">
                            <Square className="w-4 h-4 mr-2.5" />
                            断开服务
                        </Button>
                    </>
                ) : (
                    <Button size="sm" onClick={onStart} disabled={loading} className="h-10 px-6 rounded-[50px] bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-[16px] shadow-none">
                        <Play className="w-4 h-4 mr-2.5 fill-current" />
                        启动代理
                    </Button>
                )}
            </div>
        </div>
    );
}

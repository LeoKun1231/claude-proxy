import { Play, Square, RefreshCcw } from 'lucide-react';
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
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${status.running ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                <div>
                    <p className="text-sm font-medium">{status.running ? '运行中' : '已停止'}</p>
                    {status.running && (
                        <p className="text-xs text-muted-foreground">端口 {status.port}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {status.running ? (
                    <>
                        <Button variant="outline" size="sm" onClick={onRestart} disabled={loading}>
                            <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                            重启
                        </Button>
                        <Button variant="outline" size="sm" onClick={onStop} disabled={loading} className="text-destructive hover:text-destructive">
                            <Square className="w-3.5 h-3.5 mr-1.5" />
                            停止
                        </Button>
                    </>
                ) : (
                    <Button size="sm" onClick={onStart} disabled={loading}>
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        启动
                    </Button>
                )}
            </div>
        </div>
    );
}

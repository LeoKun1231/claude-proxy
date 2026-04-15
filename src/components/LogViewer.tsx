import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react';
import { Pause, Play, Trash2, ArrowDown } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface LogItem {
    id?: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    repeatCount?: number;
}

interface LogViewerProps {
    logs: LogItem[];
    onClear: () => void;
}

const LogEntry = memo(({ log }: { log: LogItem }) => (
    <div className="flex items-start gap-3 py-1 px-3 hover:bg-muted/30 text-xs font-mono leading-relaxed">
        <span className="text-muted-foreground/60 shrink-0 w-[72px] tabular-nums">
            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
        </span>
        <span className={`shrink-0 w-10 uppercase font-semibold text-[10px] tracking-wider ${
            log.type === 'error' ? 'text-red-400' :
            log.type === 'warn' ? 'text-yellow-400' :
            'text-muted-foreground'
        }`}>
            {log.type}
        </span>
        <span className={`break-all flex-1 ${log.type === 'error' ? 'text-red-300' : 'text-foreground/80'}`}>
            {log.message}
        </span>
        {log.repeatCount && log.repeatCount > 1 && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px] h-4 shrink-0">×{log.repeatCount}</Badge>
        )}
    </div>
));
LogEntry.displayName = 'LogEntry';

export default function LogViewer({ logs, onClear }: LogViewerProps) {
    const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
    const [paused, setPaused] = useState(false);
    const [showScroll, setShowScroll] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const autoScroll = useRef(true);

    const filtered = useMemo(() => filter === 'all' ? logs : logs.filter(l => l.type === filter), [filter, logs]);

    const counts = useMemo(() => logs.reduce((a, l) => {
        const c = l.repeatCount || 1;
        a.total += c; a[l.type] += c;
        return a;
    }, { total: 0, info: 0, warn: 0, error: 0 }), [logs]);

    useEffect(() => {
        if (!paused && autoScroll.current && ref.current) {
            ref.current.scrollTop = ref.current.scrollHeight;
        }
    }, [filtered.length, paused]);

    const onScroll = useCallback(() => {
        if (!ref.current) return;
        const { scrollTop, scrollHeight, clientHeight } = ref.current;
        const atBottom = scrollHeight - scrollTop - clientHeight < 40;
        autoScroll.current = atBottom;
        setShowScroll(!atBottom && filtered.length > 5);
    }, [filtered.length]);

    const scrollToEnd = useCallback(() => {
        if (ref.current) { ref.current.scrollTop = ref.current.scrollHeight; autoScroll.current = true; setShowScroll(false); }
    }, []);

    return (
        <div className="flex min-h-[calc(100dvh-14rem)] min-w-0 flex-col overflow-hidden rounded-[12px] border border-[rgba(226,226,226,0.35)]">
            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-[rgba(226,226,226,0.15)] bg-black/10 px-4 py-3">
                <div className="flex gap-2">
                    {(['all', 'info', 'warn', 'error'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-1.5 rounded-[50px] text-[12px] font-medium uppercase tracking-[1.4px] cursor-pointer transition-colors ${
                                filter === f ? 'bg-[#353534] text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                            }`}
                        >
                            {f}{' '}{f === 'all' ? counts.total : counts[f]}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full transition-colors hover:bg-[#353534]" onClick={() => setPaused(!paused)}>
                        {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full transition-colors hover:text-destructive hover:bg-destructive/10" onClick={onClear}>
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Log body */}
            <div ref={ref} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto bg-background">
                {filtered.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground uppercase tracking-widest">
                        暂无日志
                    </div>
                ) : (
                    <div className="py-1">
                        {filtered.map((log, i) => <LogEntry key={log.id || `${log.timestamp}_${i}`} log={log} />)}
                    </div>
                )}

                {showScroll && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                        <Button size="sm" variant="secondary" onClick={scrollToEnd} className="rounded-full shadow-lg cursor-pointer">
                            <ArrowDown className="w-3.5 h-3.5 mr-1" /> 最新
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

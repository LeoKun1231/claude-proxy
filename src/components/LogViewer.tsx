import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react';
import { Pause, Play, Trash2, ArrowDown } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface LogItem {
    id?: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    requestId?: string;
    providerLabel?: string;
    model?: string;
    routeKind?: string;
    repeatCount?: number;
}

interface LogViewerProps {
    logs: LogItem[];
    paused: boolean;
    onTogglePause: () => void;
    onClear: () => void;
}

function formatRouteKind(routeKind?: string) {
    switch (routeKind) {
        case 'modelRoute':
            return '精确模型路由';
        case 'image':
            return '图像';
        case 'webSearch':
            return 'Web 搜索';
        case 'think':
            return '思考';
        case 'longContext':
            return '长上下文';
        case 'background':
            return '后台';
        case 'default':
            return '默认';
        case 'providerInference':
            return '模型推断';
        case 'legacyMapping':
            return '旧映射';
        default:
            return routeKind || '';
    }
}

const LogEntry = memo(({ log }: { log: LogItem }) => (
    <div className="flex items-start gap-4 px-4 py-2 hover:bg-muted/25 text-[13px] font-mono leading-6">
        <span className="text-muted-foreground/70 shrink-0 w-[84px] tabular-nums">
            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span className={`shrink-0 w-12 uppercase font-semibold text-[11px] tracking-[0.16em] ${
            log.type === 'error' ? 'text-red-400' :
            log.type === 'warn' ? 'text-yellow-400' :
            'text-muted-foreground'
        }`}>
            {log.type}
        </span>
        <div className="min-w-0 flex-1">
            {(log.providerLabel || log.model || log.routeKind || log.requestId) && (
                <div className="mb-1 flex flex-wrap gap-1.5">
                    {log.providerLabel && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-[rgba(226,226,226,0.14)] bg-white/[0.03] px-2 text-[11px] font-medium text-foreground/85">
                            服务: {log.providerLabel}
                        </Badge>
                    )}
                    {log.model && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-sky-500/20 bg-sky-500/8 px-2 text-[11px] font-medium text-sky-200">
                            模型: {log.model}
                        </Badge>
                    )}
                    {log.routeKind && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-violet-500/20 bg-violet-500/8 px-2 text-[11px] font-medium text-violet-200">
                            类型: {formatRouteKind(log.routeKind)}
                        </Badge>
                    )}
                    {log.requestId && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-[rgba(226,226,226,0.14)] bg-white/[0.03] px-2 text-[11px] font-medium text-muted-foreground">
                            请求: {log.requestId.slice(-8)}
                        </Badge>
                    )}
                </div>
            )}
            <span className={`min-w-0 whitespace-pre-wrap break-words ${log.type === 'error' ? 'text-red-300' : 'text-foreground/85'}`}>
                {log.message}
            </span>
        </div>
        {log.repeatCount && log.repeatCount > 1 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] h-5 shrink-0">×{log.repeatCount}</Badge>
        )}
    </div>
));
LogEntry.displayName = 'LogEntry';

export default function LogViewer({ logs, paused, onTogglePause, onClear }: LogViewerProps) {
    const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
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
        <div className="flex h-[min(72vh,760px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-[rgba(226,226,226,0.35)]">
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full transition-colors hover:bg-[#353534]" onClick={onTogglePause}>
                        {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full transition-colors hover:text-destructive hover:bg-destructive/10" onClick={onClear}>
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Log body */}
            <div ref={ref} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
                {filtered.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-[14px] text-muted-foreground tracking-[0.12em]">
                        暂无日志
                    </div>
                ) : (
                    <div className="py-2">
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

import { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface LogItem {
    id?: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    requestId?: string;
    providerId?: string;
    providerLabel?: string;
    model?: string;
    routeKind?: string;
    statusCode?: number;
    upstreamUrl?: string;
    upstreamBodyPreview?: string;
    errorStage?: string;
    durationMs?: number;
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

function formatErrorStage(errorStage?: string) {
    switch (errorStage) {
        case 'routeResolution':
            return '路由解析';
        case 'upstreamConnect':
            return '上游连接';
        case 'upstreamStatus':
            return '上游响应';
        case 'upstreamStream':
            return '流式中断';
        case 'openaiCompat':
            return 'OpenAI 兼容';
        default:
            return errorStage || '';
    }
}

function buildOptions(logs: LogItem[], getValue: (log: LogItem) => string | undefined) {
    return Array.from(new Set(logs.map(getValue).filter((value): value is string => Boolean(value))))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'));
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
            {(log.providerLabel || log.model || log.routeKind || log.requestId || log.statusCode || log.errorStage || log.durationMs) && (
                <div className="mb-1 flex flex-wrap gap-1.5">
                    {log.providerLabel && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-border/40 bg-muted/40 px-2 text-[11px] font-medium text-foreground/85">
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
                    {log.errorStage && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-amber-500/20 bg-amber-500/8 px-2 text-[11px] font-medium text-amber-200">
                            阶段: {formatErrorStage(log.errorStage)}
                        </Badge>
                    )}
                    {log.statusCode && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-red-500/20 bg-red-500/8 px-2 text-[11px] font-medium text-red-200">
                            HTTP {log.statusCode}
                        </Badge>
                    )}
                    {typeof log.durationMs === 'number' && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-border/40 bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
                            {log.durationMs}ms
                        </Badge>
                    )}
                    {log.requestId && (
                        <Badge variant="outline" className="h-5 rounded-[6px] border-border/40 bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
                            请求: {log.requestId.slice(-8)}
                        </Badge>
                    )}
                </div>
            )}
            <span className={`min-w-0 whitespace-pre-wrap break-words ${log.type === 'error' ? 'text-red-300' : 'text-foreground/85'}`}>
                {log.message}
            </span>
            {(log.upstreamUrl || log.upstreamBodyPreview) && (
                <details className="mt-2 rounded-[8px] border border-border/40 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
                    <summary className="cursor-pointer select-none text-foreground/75">诊断详情</summary>
                    {log.upstreamUrl && <div className="mt-2 break-all font-mono">URL: {log.upstreamUrl}</div>}
                    {log.upstreamBodyPreview && <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-red-200/90">{log.upstreamBodyPreview}</pre>}
                </details>
            )}
        </div>
        {log.repeatCount && log.repeatCount > 1 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] h-5 shrink-0">×{log.repeatCount}</Badge>
        )}
    </div>
));
LogEntry.displayName = 'LogEntry';

export default function LogViewer({ logs, paused, onTogglePause, onClear }: LogViewerProps) {
    const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
    const [providerFilter, setProviderFilter] = useState('all');
    const [modelFilter, setModelFilter] = useState('all');
    const [stageFilter, setStageFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [showScroll, setShowScroll] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const autoScroll = useRef(true);

    const providerOptions = useMemo(() => buildOptions(logs, log => log.providerLabel || log.providerId), [logs]);
    const modelOptions = useMemo(() => buildOptions(logs, log => log.model), [logs]);
    const stageOptions = useMemo(() => buildOptions(logs, log => log.errorStage), [logs]);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return logs
            .filter(log => filter === 'all' || log.type === filter)
            .filter(log => providerFilter === 'all' || (log.providerLabel || log.providerId) === providerFilter)
            .filter(log => modelFilter === 'all' || log.model === modelFilter)
            .filter(log => stageFilter === 'all' || log.errorStage === stageFilter)
            .filter((log) => {
                if (!keyword) return true;
                return [log.message, log.requestId, log.upstreamUrl, log.upstreamBodyPreview]
                    .some(value => String(value || '').toLowerCase().includes(keyword));
            });
    }, [filter, logs, modelFilter, providerFilter, query, stageFilter]);

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
        <div className="flex h-[min(72vh,760px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-border/40 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-md bg-card/40 animate-in fade-in duration-500">
            <div className="flex shrink-0 flex-col gap-4 border-b border-border/30 bg-gradient-to-br from-muted/30 to-transparent p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                        {(['all', 'info', 'warn', 'error'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-4 py-1.5 rounded-[50px] text-[12px] font-medium uppercase tracking-[1.4px] cursor-pointer transition-colors ${
                                    filter === f ? 'bg-primary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                }`}
                            >
                                {f}{' '}{f === 'all' ? counts.total : counts[f]}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer rounded-[12px] transition-all hover:bg-primary/10 hover:text-primary hover:scale-105 active:scale-95" onClick={onTogglePause}>
                            {paused ? <Icon icon="ph:play-bold" className="w-4.5 h-4.5" /> : <Icon icon="ph:pause-bold" className="w-4.5 h-4.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer rounded-[12px] transition-all hover:bg-destructive/10 hover:text-destructive hover:scale-105 active:scale-95" onClick={onClear}>
                            <Icon icon="ph:trash-bold" className="w-4.5 h-4.5" />
                        </Button>
                    </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                    <Select items={[{ value: 'all', label: '全部服务' }, ...providerOptions.map(value => ({ value, label: value }))]} value={providerFilter} onValueChange={(value) => setProviderFilter(value || 'all')}>
                        <SelectTrigger className="h-10 w-full rounded-xl border-border/40 bg-background/40 backdrop-blur-sm text-[13px] hover:border-border/80 transition-colors"><SelectValue /></SelectTrigger>
                        <SelectContent className="backdrop-blur-md bg-background/80 border-border/40">
                            <SelectItem value="all">全部服务</SelectItem>
                            {providerOptions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select items={[{ value: 'all', label: '全部模型' }, ...modelOptions.map(value => ({ value, label: value }))]} value={modelFilter} onValueChange={(value) => setModelFilter(value || 'all')}>
                        <SelectTrigger className="h-10 w-full rounded-xl border-border/40 bg-background/40 backdrop-blur-sm text-[13px] hover:border-border/80 transition-colors"><SelectValue /></SelectTrigger>
                        <SelectContent className="backdrop-blur-md bg-background/80 border-border/40">
                            <SelectItem value="all">全部模型</SelectItem>
                            {modelOptions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select items={[{ value: 'all', label: '全部阶段' }, ...stageOptions.map(value => ({ value, label: formatErrorStage(value) }))]} value={stageFilter} onValueChange={(value) => setStageFilter(value || 'all')}>
                        <SelectTrigger className="h-10 w-full rounded-xl border-border/40 bg-background/40 backdrop-blur-sm text-[13px] hover:border-border/80 transition-colors"><SelectValue /></SelectTrigger>
                        <SelectContent className="backdrop-blur-md bg-background/80 border-border/40">
                            <SelectItem value="all">全部阶段</SelectItem>
                            {stageOptions.map(value => <SelectItem key={value} value={value}>{formatErrorStage(value)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索消息 / 请求 / URL" className="h-10 rounded-xl border-border/40 bg-background/40 backdrop-blur-sm text-[13px] hover:border-border/80 transition-colors focus-visible:ring-primary/30" />
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
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                        <Button size="sm" variant="secondary" onClick={scrollToEnd} className="rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.2)] border border-border/50 backdrop-blur-md bg-secondary/90 hover:bg-secondary transition-all hover:scale-105 active:scale-95 cursor-pointer">
                            <Icon icon="ph:arrow-down-bold" className="w-4 h-4 mr-1.5" /> 最新
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

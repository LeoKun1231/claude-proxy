import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { toast } from 'sonner';
import type { AppConfig } from '../types/config';
import type { TokenUsagePayload, TokenUsageRecord } from '../types/token-usage';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';
type UsageSummary = {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

const TIME_RANGE_ITEMS: Array<{ value: TimeRange; label: string }> = [
    { value: '1h', label: '最近 1 小时' },
    { value: '24h', label: '最近 24 小时' },
    { value: '7d', label: '最近 7 天' },
    { value: '30d', label: '最近 30 天' },
    { value: 'all', label: '全部时间' },
];

function formatNumber(value: number) {
    return new Intl.NumberFormat('zh-CN').format(value);
}

function formatTokenCount(value: number) {
    const absValue = Math.abs(value);
    if (absValue >= 100_000_000) {
        return `${formatCompactValue(value / 100_000_000)}亿`;
    }
    if (absValue >= 1_000_000) {
        return `${formatCompactValue(value / 1_000_000)}M`;
    }
    return formatNumber(value);
}

function formatCompactValue(value: number) {
    return new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: value >= 10 ? 0 : 1,
    }).format(value);
}

function formatTime(value: string) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) {
        return value;
    }
    return time.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function getRangeStart(range: TimeRange) {
    if (range === 'all') return null;
    const now = Date.now();
    if (range === '1h') return now - 60 * 60 * 1000;
    if (range === '24h') return now - 24 * 60 * 60 * 1000;
    if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000;
    return now - 30 * 24 * 60 * 60 * 1000;
}

function buildProviderOptions(config: AppConfig | null, records: TokenUsageRecord[]) {
    const seen = new Map<string, string>();
    const push = (id: string, label: string) => {
        const normalizedId = String(id || '').trim();
        if (!normalizedId || seen.has(normalizedId)) return;
        seen.set(normalizedId, String(label || id || '').trim() || normalizedId);
    };

    const providers = config?.providers;
    if (providers) {
        const builtinProviderIds = ['anthropic', 'glm', 'kimi', 'minimax', 'deepseek', 'litellm', 'cliproxyapi'];
        builtinProviderIds.forEach((providerId) => {
            const provider = providers[providerId];
            if (provider?.enabled) {
                push(providerId, providerId);
            }
        });
        if (Array.isArray(providers.customProviders)) {
            providers.customProviders.forEach((provider) => {
                if (provider?.enabled) {
                    push(provider.id, provider.name);
                }
            });
        }
    }

    records.forEach((record) => {
        push(record.providerId, record.providerLabel);
    });

    return Array.from(seen.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

function buildModelOptions(records: TokenUsageRecord[]) {
    return Array.from(new Set(records.map(record => record.model || 'unknown')))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .map(value => ({ value, label: value }));
}

function createEmptySummary(): UsageSummary {
    return {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
}

function addRecordToSummary(summary: UsageSummary, record: TokenUsageRecord) {
    summary.requests += 1;
    summary.inputTokens += record.inputTokens;
    summary.outputTokens += record.outputTokens;
    summary.totalTokens += record.totalTokens;
}

function bucketLabel(timestampMs: number, range: TimeRange) {
    const date = new Date(timestampMs);
    if (Number.isNaN(date.getTime())) return '未知时间';
    if (range === '1h' || range === '24h') {
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false,
        });
    }
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

function csvCell(value: string | number) {
    const text = String(value ?? '');
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildTokenUsageCsv(records: TokenUsageRecord[]) {
    const header = ['timestamp', 'requestId', 'providerId', 'providerLabel', 'model', 'inputTokens', 'outputTokens', 'totalTokens'];
    const rows = records.map(record => [
        record.timestamp,
        record.requestId,
        record.providerId,
        record.providerLabel,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
    ]);
    const csv = [header, ...rows]
        .map(row => row.map(csvCell).join(','))
        .join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return {
        csv: `\uFEFF${csv}`,
        fileName: `claude-proxy-token-usage-${stamp}.csv`,
    };
}

function downloadCsvInBrowser(csv: string, fileName: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function toTokenUsageRecord(
    payload: {
        requestId?: string;
        providerId?: string;
        providerLabel?: string;
        model?: string;
        timestamp: string;
        tokenUsage?: TokenUsagePayload;
    },
    fallbackId: string,
) {
    if (!payload.tokenUsage) {
        return null;
    }

    return {
        requestId: payload.requestId || fallbackId,
        providerId: payload.providerId || 'unknown',
        providerLabel: payload.providerLabel || payload.providerId || 'unknown',
        model: payload.model || 'unknown',
        inputTokens: Number(payload.tokenUsage.inputTokens || 0),
        outputTokens: Number(payload.tokenUsage.outputTokens || 0),
        totalTokens: Number(payload.tokenUsage.totalTokens || 0),
        timestamp: payload.timestamp,
        timestampMs: Date.parse(payload.timestamp) || Date.now(),
    } satisfies TokenUsageRecord;
}

export default function TokenStatsPanel() {
    const [records, setRecords] = useState<TokenUsageRecord[]>([]);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [providerFilter, setProviderFilter] = useState('all');
    const [modelFilter, setModelFilter] = useState('all');
    const [timeRange, setTimeRange] = useState<TimeRange>('24h');
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        if (!window.electronAPI) return;
        setLoading(true);
        try {
            const [nextRecords, nextConfig] = await Promise.all([
                window.electronAPI.getTokenUsageRecords?.() ?? Promise.resolve([]),
                window.electronAPI.getAllConfig(),
            ]);
            setRecords(Array.isArray(nextRecords) ? nextRecords : []);
            setConfig(nextConfig);
        } catch (error: any) {
            toast.error(error?.message || '加载 token 统计失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        const handleLog = (payload: {
            requestId?: string;
            providerId?: string;
            providerLabel?: string;
            model?: string;
            timestamp: string;
            tokenUsage?: TokenUsagePayload;
        }) => {
            const nextRecord = toTokenUsageRecord(payload, `token_${Date.now()}`);
            if (!nextRecord) return;
            setRecords((current) => {
                const exists = current.some((item) =>
                    item.requestId === nextRecord.requestId
                    && item.providerId === nextRecord.providerId
                    && item.totalTokens === nextRecord.totalTokens
                    && item.timestamp === nextRecord.timestamp
                );
                if (exists) return current;
                return [nextRecord, ...current];
            });
        };

        window.electronAPI.onProxyLog(handleLog);
        return () => window.electronAPI.removeProxyLogListener(handleLog);
    }, []);

    useEffect(() => {
        const handleConfigUpdated = ({ key }: { key: string }) => {
            if (key === 'all' || key === 'providers.customProviders') {
                void loadData();
            }
        };

        window.electronAPI.onConfigUpdated(handleConfigUpdated);
        return () => window.electronAPI.removeConfigUpdatedListener(handleConfigUpdated);
    }, [loadData]);

    const providerItems = useMemo(() => buildProviderOptions(config, records), [config, records]);
    const modelItems = useMemo(() => buildModelOptions(records), [records]);

    useEffect(() => {
        if (providerFilter !== 'all' && !providerItems.some((item) => item.value === providerFilter)) {
            setProviderFilter('all');
        }
    }, [providerFilter, providerItems]);

    useEffect(() => {
        if (modelFilter !== 'all' && !modelItems.some((item) => item.value === modelFilter)) {
            setModelFilter('all');
        }
    }, [modelFilter, modelItems]);

    const filteredRecords = useMemo(() => {
        const rangeStart = getRangeStart(timeRange);
        return records
            .filter((record) => providerFilter === 'all' || record.providerId === providerFilter)
            .filter((record) => modelFilter === 'all' || record.model === modelFilter)
            .filter((record) => rangeStart === null || record.timestampMs >= rangeStart)
            .sort((left, right) => right.timestampMs - left.timestampMs);
    }, [modelFilter, providerFilter, records, timeRange]);

    const summary = useMemo(() => {
        return filteredRecords.reduce((acc, record) => {
            addRecordToSummary(acc, record);
            return acc;
        }, createEmptySummary());
    }, [filteredRecords]);

    const providerSummary = useMemo(() => {
        const grouped = new Map<string, UsageSummary & {
            providerId: string;
            providerLabel: string;
        }>();

        filteredRecords.forEach((record) => {
            const current = grouped.get(record.providerId) || {
                providerId: record.providerId,
                providerLabel: record.providerLabel,
                ...createEmptySummary(),
            };
            addRecordToSummary(current, record);
            grouped.set(record.providerId, current);
        });

        return Array.from(grouped.values()).sort((left, right) => right.totalTokens - left.totalTokens);
    }, [filteredRecords]);

    const modelSummary = useMemo(() => {
        const grouped = new Map<string, UsageSummary & { model: string }>();
        filteredRecords.forEach((record) => {
            const model = record.model || 'unknown';
            const current = grouped.get(model) || {
                model,
                ...createEmptySummary(),
            };
            addRecordToSummary(current, record);
            grouped.set(model, current);
        });
        return Array.from(grouped.values()).sort((left, right) => right.totalTokens - left.totalTokens);
    }, [filteredRecords]);

    const dateBuckets = useMemo(() => {
        const grouped = new Map<string, UsageSummary & { label: string }>();
        filteredRecords.forEach((record) => {
            const label = bucketLabel(record.timestampMs, timeRange);
            const current = grouped.get(label) || {
                label,
                ...createEmptySummary(),
            };
            addRecordToSummary(current, record);
            grouped.set(label, current);
        });
        return Array.from(grouped.values())
            .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
            .slice(-30);
    }, [filteredRecords, timeRange]);

    const maxBucketTokens = Math.max(1, ...dateBuckets.map(bucket => bucket.totalTokens));

    const recentRecords = filteredRecords.slice(0, 30);

    const handleClear = useCallback(async () => {
        if (!window.confirm('确定清空所有 token 统计吗？此操作不可恢复。')) {
            return;
        }
        try {
            await window.electronAPI.clearTokenUsageRecords?.();
            setRecords([]);
            toast.success('token 统计已清空');
        } catch (error: any) {
            toast.error(error?.message || '清空 token 统计失败');
        }
    }, []);

    const handleExportCsv = useCallback(async () => {
        if (filteredRecords.length === 0) {
            toast.info('当前筛选条件下没有可导出的 token 记录');
            return;
        }

        const { csv, fileName } = buildTokenUsageCsv(filteredRecords);
        try {
            if (window.electronAPI.exportTokenUsageCsv) {
                const result = await window.electronAPI.exportTokenUsageCsv(csv, fileName);
                if (!result.success) {
                    throw new Error(result.error || 'CSV 导出失败');
                }
                toast.success(result.path ? `CSV 已导出：${result.path}` : 'CSV 已导出');
                return;
            }

            downloadCsvInBrowser(csv, fileName);
            toast.success('CSV 已导出');
        } catch (error: any) {
            toast.error(error?.message || 'CSV 导出失败');
        }
    }, [filteredRecords]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <div className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/60 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-md">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-1.5">
                        <h3 className="text-[24px] font-medium tracking-tight text-foreground flex items-center gap-2">
                            <Icon icon="ph:chart-bar-bold" className="text-primary/80" /> Token 统计
                        </h3>
                        <p className="text-[15px] text-muted-foreground/80 leading-relaxed max-w-xl">
                            独立统计所有 provider 的 token 消耗，支持按 provider 和时间范围筛选。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void loadData()}
                            disabled={loading}
                            className="h-10 px-5 rounded-2xl border-border/60 bg-muted/20 hover:bg-primary/10 hover:text-primary hover:border-primary/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group/btn"
                        >
                            <Icon icon="ph:arrows-clockwise-bold" className={`mr-2 h-4 w-4 transition-transform group-hover/btn:rotate-180 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleExportCsv}
                            className="h-10 px-5 rounded-2xl border-border/60 bg-muted/20 hover:bg-primary/10 hover:text-primary hover:border-primary/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group/btn"
                        >
                            <Icon icon="ph:download-simple-bold" className="mr-2 h-4 w-4 transition-transform group-hover/btn:-translate-y-0.5" />
                            导出 CSV
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleClear()}
                            className="h-10 px-5 rounded-2xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all group/btn"
                        >
                            <Icon icon="ph:trash-bold" className="mr-2 h-4 w-4 transition-transform group-hover/btn:scale-110" />
                            清空统计
                        </Button>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/80 ml-1">Provider</label>
                        <Select
                            items={[{ value: 'all', label: '全部 provider' }, ...providerItems]}
                            value={providerFilter}
                            onValueChange={(value) => setProviderFilter(value || 'all')}
                        >
                            <SelectTrigger className="h-11 w-full rounded-2xl border-border/40 bg-background/50 backdrop-blur-sm text-[14px] shadow-sm hover:border-border/80 transition-colors">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部 provider</SelectItem>
                                {providerItems.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/80 ml-1">模型</label>
                        <Select
                            items={[{ value: 'all', label: '全部模型' }, ...modelItems]}
                            value={modelFilter}
                            onValueChange={(value) => setModelFilter(value || 'all')}
                        >
                            <SelectTrigger className="h-11 w-full rounded-2xl border-border/40 bg-background/50 backdrop-blur-sm text-[14px] shadow-sm hover:border-border/80 transition-colors">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部模型</SelectItem>
                                {modelItems.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/80 ml-1">时间范围</label>
                        <Select
                            items={TIME_RANGE_ITEMS}
                            value={timeRange}
                            onValueChange={(value) => setTimeRange((value as TimeRange) || '24h')}
                        >
                            <SelectTrigger className="h-11 w-full rounded-2xl border-border/40 bg-background/50 backdrop-blur-sm text-[14px] shadow-sm hover:border-border/80 transition-colors">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TIME_RANGE_ITEMS.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                    { label: '请求数', value: summary.requests, icon: 'ph:chart-bar-bold', formatter: formatNumber },
                    { label: '输入 Token', value: summary.inputTokens, icon: 'ph:hard-drives-bold', formatter: formatTokenCount },
                    { label: '输出 Token', value: summary.outputTokens, icon: 'ph:timer-bold', formatter: formatTokenCount },
                    { label: '总 Token', value: summary.totalTokens, icon: 'ph:circles-four-bold', formatter: formatTokenCount },
                ].map((item) => (
                    <div key={item.label} className="group rounded-[24px] border border-border/40 bg-gradient-to-b from-card/60 to-transparent p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm transition-all duration-300 hover:border-primary/20 hover:shadow-[0_8px_30px_rgba(6,182,212,0.1)] hover:-translate-y-1">
                        <div className="flex items-center justify-between">
                            <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/80">{item.label}</p>
                            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-primary/10 text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                <Icon icon={item.icon} className="h-5 w-5" />
                            </div>
                        </div>
                        <p className="mt-5 text-[32px] font-medium tracking-tight text-foreground leading-none">{item.formatter(item.value)}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
                <section className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/40 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <div className="flex items-center justify-between border-b border-border/30 pb-5">
                        <div>
                            <h3 className="text-[20px] font-medium tracking-tight text-foreground">Provider 汇总</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground/80">按当前筛选条件统计 token 消耗。</p>
                        </div>
                        <Badge variant="outline" className="font-mono rounded-full px-3 py-1 bg-background/50">{providerSummary.length} 个 provider</Badge>
                    </div>

                    <div className="mt-5 space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {providerSummary.length === 0 ? (
                            <div className="rounded-[16px] border border-border/30 bg-muted/20 px-4 py-12 flex flex-col items-center justify-center text-center">
                                <Icon icon="ph:hard-drives-bold" className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                <span className="text-[14px] text-muted-foreground">当前筛选条件下暂无 token 统计。</span>
                            </div>
                        ) : providerSummary.map((item) => (
                            <div key={item.providerId} className="group rounded-[16px] border border-border/40 bg-muted/20 px-5 py-4 transition-all duration-300 hover:bg-muted/40 hover:border-border/80">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-background border border-border/50 text-muted-foreground shadow-sm group-hover:text-primary transition-colors">
                                            <Icon icon="ph:hard-drives-bold" className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="truncate text-[16px] font-medium text-foreground">{item.providerLabel || item.providerId}</p>
                                            <p className="font-mono text-[12px] text-muted-foreground/70">{item.providerId}</p>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="font-mono rounded-full bg-background/50" title={`${formatNumber(item.totalTokens)} tokens`}>{formatTokenCount(item.totalTokens)} tokens</Badge>
                                </div>
                                <div className="mt-4 grid grid-cols-3 gap-3 text-[13px] text-muted-foreground/90">
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">请求</span> {formatNumber(item.requests)}</div>
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">输入</span> {formatTokenCount(item.inputTokens)}</div>
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">输出</span> {formatTokenCount(item.outputTokens)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/40 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <div className="flex items-center justify-between border-b border-border/30 pb-5">
                        <div>
                            <h3 className="text-[20px] font-medium tracking-tight text-foreground">模型汇总</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground/80">按模型统计当前筛选后的 token 消耗。</p>
                        </div>
                        <Badge variant="outline" className="font-mono rounded-full px-3 py-1 bg-background/50">{modelSummary.length} 个模型</Badge>
                    </div>

                    <div className="mt-5 space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {modelSummary.length === 0 ? (
                            <div className="rounded-[16px] border border-border/30 bg-muted/20 px-4 py-12 flex flex-col items-center justify-center text-center">
                                <Icon icon="ph:cpu-bold" className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                <span className="text-[14px] text-muted-foreground">当前筛选条件下暂无模型统计。</span>
                            </div>
                        ) : modelSummary.slice(0, 10).map((item) => (
                            <div key={item.model} className="group rounded-[16px] border border-border/40 bg-muted/20 px-5 py-4 transition-all duration-300 hover:bg-muted/40 hover:border-border/80">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-background border border-border/50 text-muted-foreground shadow-sm group-hover:text-primary transition-colors">
                                            <Icon icon="ph:cpu-bold" className="h-5 w-5" />
                                        </div>
                                        <p className="min-w-0 truncate font-mono text-[15px] font-medium text-foreground">{item.model}</p>
                                    </div>
                                    <Badge variant="outline" className="font-mono rounded-full bg-background/50" title={`${formatNumber(item.totalTokens)} tokens`}>{formatTokenCount(item.totalTokens)} tokens</Badge>
                                </div>
                                <div className="mt-4 grid grid-cols-3 gap-3 text-[13px] text-muted-foreground/90">
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">请求</span> {formatNumber(item.requests)}</div>
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">输入</span> {formatTokenCount(item.inputTokens)}</div>
                                    <div className="bg-background/40 rounded-[10px] py-2 px-3 text-center border border-border/30"><span className="text-muted-foreground/60 text-[11px] uppercase tracking-wider block mb-0.5">输出</span> {formatTokenCount(item.outputTokens)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
                <section className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/40 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <div className="flex items-center justify-between border-b border-border/30 pb-5">
                        <div>
                            <h3 className="text-[20px] font-medium tracking-tight text-foreground">时间趋势</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground/80">按当前时间范围聚合最近 30 个时间桶。</p>
                        </div>
                        <Badge variant="outline" className="font-mono rounded-full px-3 py-1 bg-background/50">{dateBuckets.length} 桶</Badge>
                    </div>

                    <div className="mt-5 space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {dateBuckets.length === 0 ? (
                            <div className="rounded-[16px] border border-border/30 bg-muted/20 px-4 py-12 flex flex-col items-center justify-center text-center">
                                <Icon icon="ph:trend-up-bold" className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                <span className="text-[14px] text-muted-foreground">暂无趋势数据。</span>
                            </div>
                        ) : dateBuckets.map((bucket) => (
                            <div key={bucket.label} className="space-y-3 rounded-[16px] border border-border/40 bg-muted/20 px-5 py-4 hover:bg-muted/30 transition-colors">
                                <div className="flex items-center justify-between gap-3 text-[13px]">
                                    <span className="font-mono text-muted-foreground font-medium">{bucket.label}</span>
                                    <span className="text-foreground font-medium bg-background/50 px-2 py-0.5 rounded-[6px] border border-border/50">{formatTokenCount(bucket.totalTokens)} tokens</span>
                                </div>
                                <div className="h-2.5 overflow-hidden rounded-full bg-background border border-border/30">
                                    <div className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-1000 ease-out" style={{ width: `${Math.max(4, (bucket.totalTokens / maxBucketTokens) * 100)}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/40 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <div className="flex items-center justify-between border-b border-border/30 pb-5">
                        <div>
                            <h3 className="text-[20px] font-medium tracking-tight text-foreground">最近请求</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground/80">展示最近 30 条 token 记录。</p>
                        </div>
                        <Badge variant="outline" className="font-mono rounded-full px-3 py-1 bg-background/50">{recentRecords.length} 条</Badge>
                    </div>

                    <div className="mt-5 space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {recentRecords.length === 0 ? (
                            <div className="rounded-[16px] border border-border/30 bg-muted/20 px-4 py-12 flex flex-col items-center justify-center text-center">
                                <Icon icon="ph:list-dashes-bold" className="w-10 h-10 text-muted-foreground/30 mb-3" />
                                <span className="text-[14px] text-muted-foreground">暂无 token 请求记录。</span>
                            </div>
                        ) : recentRecords.map((record) => (
                            <div key={`${record.requestId}_${record.timestampMs}`} className="group rounded-[16px] border border-border/40 bg-muted/20 px-5 py-4 transition-all duration-300 hover:bg-muted/40 hover:border-border/80">
                                <div className="flex items-start justify-between gap-3 border-b border-border/30 pb-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-[15px] font-medium text-foreground">{record.providerLabel || record.providerId}</p>
                                        <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground/80 flex items-center gap-1.5">
                                            <Icon icon="ph:cpu-bold" /> {record.model || 'unknown'}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-[11px] font-mono text-muted-foreground/70 bg-background/50 px-2 py-1 rounded-[6px] border border-border/40">{formatTime(record.timestamp)}</span>
                                </div>
                                <div className="mt-3 flex items-center justify-between text-[12px]">
                                    <div className="flex gap-4">
                                        <span className="text-muted-foreground/80"><span className="text-muted-foreground/50 mr-1 text-[10px] uppercase">输入</span> {formatTokenCount(record.inputTokens)}</span>
                                        <span className="text-muted-foreground/80"><span className="text-muted-foreground/50 mr-1 text-[10px] uppercase">输出</span> {formatTokenCount(record.outputTokens)}</span>
                                    </div>
                                    <div className="font-mono text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-[4px] border border-primary/20">
                                        {formatTokenCount(record.totalTokens)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

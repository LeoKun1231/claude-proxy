import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCcw, Server, TimerReset, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '../types/config';
import type { TokenUsagePayload, TokenUsageRecord } from '../types/token-usage';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

type ProviderOption = {
    value: string;
    label: string;
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
                return [nextRecord, ...current].slice(0, 10000);
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

    useEffect(() => {
        if (providerFilter !== 'all' && !providerItems.some((item) => item.value === providerFilter)) {
            setProviderFilter('all');
        }
    }, [providerFilter, providerItems]);

    const filteredRecords = useMemo(() => {
        const rangeStart = getRangeStart(timeRange);
        return records
            .filter((record) => providerFilter === 'all' || record.providerId === providerFilter)
            .filter((record) => rangeStart === null || record.timestampMs >= rangeStart)
            .sort((left, right) => right.timestampMs - left.timestampMs);
    }, [providerFilter, records, timeRange]);

    const summary = useMemo(() => {
        return filteredRecords.reduce((acc, record) => {
            acc.requests += 1;
            acc.inputTokens += record.inputTokens;
            acc.outputTokens += record.outputTokens;
            acc.totalTokens += record.totalTokens;
            return acc;
        }, {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        });
    }, [filteredRecords]);

    const providerSummary = useMemo(() => {
        const grouped = new Map<string, {
            providerId: string;
            providerLabel: string;
            requests: number;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
        }>();

        filteredRecords.forEach((record) => {
            const current = grouped.get(record.providerId) || {
                providerId: record.providerId,
                providerLabel: record.providerLabel,
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
            };
            current.requests += 1;
            current.inputTokens += record.inputTokens;
            current.outputTokens += record.outputTokens;
            current.totalTokens += record.totalTokens;
            grouped.set(record.providerId, current);
        });

        return Array.from(grouped.values()).sort((left, right) => right.totalTokens - left.totalTokens);
    }, [filteredRecords]);

    const recentRecords = filteredRecords.slice(0, 30);

    const handleClear = useCallback(async () => {
        try {
            await window.electronAPI.clearTokenUsageRecords?.();
            setRecords([]);
            toast.success('token 统计已清空');
        } catch (error: any) {
            toast.error(error?.message || '清空 token 统计失败');
        }
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <div className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-1">
                        <h3 className="text-[24px] font-normal tracking-[0px] text-foreground">Token 统计</h3>
                        <p className="text-[18px] text-muted-foreground leading-relaxed">
                            独立统计所有 provider 的 token 消耗，支持按 provider 和时间范围筛选。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void loadData()}
                            disabled={loading}
                            className="h-10 rounded-[50px] border-[rgba(226,226,226,0.35)]"
                        >
                            <RefreshCcw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleClear()}
                            className="h-10 rounded-[50px] text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            清空统计
                        </Button>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className="text-[11px] font-medium uppercase tracking-[1.4px] text-muted-foreground">Provider</label>
                        <Select
                            items={[{ value: 'all', label: '全部 provider' }, ...providerItems]}
                            value={providerFilter}
                            onValueChange={(value) => setProviderFilter(value || 'all')}
                        >
                            <SelectTrigger className="h-10 w-full rounded-[8px] border-[rgba(226,226,226,0.15)] bg-black/20 text-[14px]">
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
                        <label className="text-[11px] font-medium uppercase tracking-[1.4px] text-muted-foreground">时间范围</label>
                        <Select
                            items={TIME_RANGE_ITEMS}
                            value={timeRange}
                            onValueChange={(value) => setTimeRange((value as TimeRange) || '24h')}
                        >
                            <SelectTrigger className="h-10 w-full rounded-[8px] border-[rgba(226,226,226,0.15)] bg-black/20 text-[14px]">
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
                    { label: '请求数', value: summary.requests, icon: BarChart3 },
                    { label: '输入 Token', value: summary.inputTokens, icon: Server },
                    { label: '输出 Token', value: summary.outputTokens, icon: TimerReset },
                    { label: '总 Token', value: summary.totalTokens, icon: BarChart3 },
                ].map((item) => (
                    <div key={item.label} className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-5">
                        <div className="flex items-center justify-between">
                            <p className="text-[13px] uppercase tracking-[1.4px] text-muted-foreground">{item.label}</p>
                            <item.icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="mt-4 text-3xl font-normal tracking-[-0.6px] text-foreground">{formatNumber(item.value)}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
                <section className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-[20px] font-normal text-foreground">Provider 汇总</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground">按当前筛选条件统计 token 消耗。</p>
                        </div>
                        <Badge variant="outline" className="font-mono">{providerSummary.length} 个 provider</Badge>
                    </div>

                    <div className="mt-5 space-y-3">
                        {providerSummary.length === 0 ? (
                            <div className="rounded-[8px] border border-[rgba(226,226,226,0.15)] bg-white/[0.015] px-4 py-8 text-center text-[14px] text-muted-foreground">
                                当前筛选条件下暂无 token 统计。
                            </div>
                        ) : providerSummary.map((item) => (
                            <div key={item.providerId} className="rounded-[10px] border border-[rgba(226,226,226,0.15)] bg-black/10 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-[16px] text-foreground">{item.providerLabel || item.providerId}</p>
                                        <p className="mt-1 font-mono text-[12px] text-muted-foreground">{item.providerId}</p>
                                    </div>
                                    <Badge variant="outline" className="font-mono">{formatNumber(item.totalTokens)} tokens</Badge>
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-3 text-[13px] text-muted-foreground">
                                    <div>请求 {formatNumber(item.requests)}</div>
                                    <div>输入 {formatNumber(item.inputTokens)}</div>
                                    <div>输出 {formatNumber(item.outputTokens)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-[20px] font-normal text-foreground">最近请求</h3>
                            <p className="mt-1 text-[14px] text-muted-foreground">展示最近 30 条 token 记录。</p>
                        </div>
                        <Badge variant="outline" className="font-mono">{recentRecords.length} 条</Badge>
                    </div>

                    <div className="mt-5 space-y-3">
                        {recentRecords.length === 0 ? (
                            <div className="rounded-[8px] border border-[rgba(226,226,226,0.15)] bg-white/[0.015] px-4 py-8 text-center text-[14px] text-muted-foreground">
                                暂无 token 请求记录。
                            </div>
                        ) : recentRecords.map((record) => (
                            <div key={`${record.requestId}_${record.timestampMs}`} className="rounded-[10px] border border-[rgba(226,226,226,0.15)] bg-black/10 px-4 py-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-[15px] text-foreground">{record.providerLabel || record.providerId}</p>
                                        <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">{record.model || 'unknown'}</p>
                                    </div>
                                    <span className="shrink-0 text-[12px] text-muted-foreground">{formatTime(record.timestamp)}</span>
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-3 text-[13px] text-muted-foreground">
                                    <div>输入 {formatNumber(record.inputTokens)}</div>
                                    <div>输出 {formatNumber(record.outputTokens)}</div>
                                    <div>总计 {formatNumber(record.totalTokens)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

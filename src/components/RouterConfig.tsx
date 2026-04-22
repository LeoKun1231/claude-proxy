import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Boxes,
    Brain,
    FileText,
    Globe,
    Image as ImageIcon,
    LayoutDashboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
    createDefaultRouterConfig,
    DEFAULT_LONG_CONTEXT_THRESHOLD,
    type AppConfig,
    type RouterCategoryKey,
    type RouterConfig,
    type RouterTarget,
} from '@/types/config';
import { buildProviderOptions, type ProviderOption } from '@/lib/provider-options';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';

const EMPTY_OPTION = '__empty_selection__';
const COMBO_SEPARATOR = '|||';

interface CategoryMeta {
    key: RouterCategoryKey;
    label: string;
    description: string;
    icon: LucideIcon;
}

const CATEGORY_META: CategoryMeta[] = [
    {
        key: 'default',
        label: '默认',
        description: '未命中其他分类时使用的默认 Provider / 模型。',
        icon: LayoutDashboard,
    },
    {
        key: 'background',
        label: '后台',
        description: '后台 / 轻量任务（如 haiku 类小模型请求），适合成本更低的模型。',
        icon: Boxes,
    },
    {
        key: 'think',
        label: '思考',
        description: '请求包含 thinking / Plan Mode 时使用的推理能力更强的模型。',
        icon: Brain,
    },
    {
        key: 'longContext',
        label: '长上下文',
        description: '估算输入 token 超过阈值时使用的长上下文模型。',
        icon: FileText,
    },
    {
        key: 'webSearch',
        label: 'Web 搜索',
        description: '请求 tools 中包含 web_search 时使用的模型，模型本身需支持联网。',
        icon: Globe,
    },
    {
        key: 'image',
        label: '图像',
        description: '请求消息中包含图片内容块时使用的视觉模型。',
        icon: ImageIcon,
    },
];

function encodeOption(providerId: string, model: string) {
    if (!providerId) return '';
    return `${providerId}${COMBO_SEPARATOR}${model}`;
}

function decodeOption(value: string): { providerId: string; model: string } {
    if (!value || value === EMPTY_OPTION) {
        return { providerId: '', model: '' };
    }
    const [providerId = '', model = ''] = value.split(COMBO_SEPARATOR);
    return { providerId, model };
}

function buildComboItems(options: ProviderOption[]) {
    const items: { value: string; label: string; providerId: string; model: string }[] = [];
    for (const option of options) {
        if (!option.models || option.models.length === 0) continue;
        for (const model of option.models) {
            items.push({
                value: encodeOption(option.id, model),
                label: `${option.label} / ${model}`,
                providerId: option.id,
                model,
            });
        }
    }
    return items;
}

export default function RouterConfigPanel() {
    const [config, setConfig] = useState<AppConfig | null>(null);

    const loadConfig = useCallback(async () => {
        if (!window.electronAPI?.getAllConfig) return;
        const next = await window.electronAPI.getAllConfig();
        setConfig(next);
    }, []);

    useEffect(() => {
        void loadConfig();
    }, [loadConfig]);

    useEffect(() => {
        if (!window.electronAPI?.onConfigUpdated) return undefined;
        const handler = ({ key }: { key: string }) => {
            if (
                key === 'all'
                || key === 'router'
                || key.startsWith('router.')
                || key === 'providers'
                || key.startsWith('providers.')
            ) {
                void loadConfig();
            }
        };
        window.electronAPI.onConfigUpdated(handler);
        return () => window.electronAPI.removeConfigUpdatedListener?.(handler);
    }, [loadConfig]);

    const providerOptions = useMemo(() => {
        if (!config) return [] as ProviderOption[];
        return buildProviderOptions(config);
    }, [config]);

    const comboItems = useMemo(() => buildComboItems(providerOptions), [providerOptions]);
    const comboLabelMap = useMemo(
        () => new Map(comboItems.map((item) => [item.value, item.label])),
        [comboItems],
    );

    const router: RouterConfig = useMemo(
        () => config?.router || createDefaultRouterConfig(),
        [config],
    );

    const saveRouter = useCallback(async (next: RouterConfig) => {
        if (!window.electronAPI?.setConfig) return;
        try {
            await window.electronAPI.setConfig('router', next);
        } catch (error: any) {
            toast.error(error?.message || '保存路由配置失败');
            void loadConfig();
        }
    }, [loadConfig]);

    const updateCategory = useCallback(async (
        key: RouterCategoryKey,
        patch: Partial<RouterTarget>,
    ) => {
        if (!config) return;
        const current = router[key];
        const nextTarget: RouterTarget = {
            ...current,
            ...patch,
        };
        const nextRouter: RouterConfig = {
            ...router,
            [key]: nextTarget,
        };
        setConfig({ ...config, router: nextRouter });
        await saveRouter(nextRouter);
    }, [config, router, saveRouter]);

    const updateThreshold = useCallback(async (raw: string) => {
        if (!config) return;
        const parsed = Number.parseInt(raw, 10);
        const threshold = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LONG_CONTEXT_THRESHOLD;
        const nextRouter: RouterConfig = {
            ...router,
            longContextThreshold: threshold,
        };
        setConfig({ ...config, router: nextRouter });
        await saveRouter(nextRouter);
    }, [config, router, saveRouter]);

    const handleSelectCombo = useCallback(async (
        key: RouterCategoryKey,
        value: string | null,
    ) => {
        const { providerId, model } = decodeOption(value ?? '');
        const providerLabel = providerOptions.find((item) => item.id === providerId)?.label || '';
        await updateCategory(key, {
            providerId,
            providerLabel,
            targetModel: model,
            enabled: providerId ? true : router[key].enabled,
        });
    }, [providerOptions, router, updateCategory]);

    if (!config) return null;

    return (
        <div className="rounded-[12px] border border-[rgba(226,226,226,0.35)] p-6 bg-transparent space-y-5">
            <div className="space-y-1.5">
                <h3 className="text-[20px] font-normal tracking-tight text-foreground">路由</h3>
                <p className="text-[14px] text-muted-foreground leading-relaxed">
                    按请求特征自动分派到不同 Provider / 模型。优先级：精确模型路由 &gt; 图像 &gt; Web 搜索 &gt; 思考 &gt; 长上下文 &gt; 后台 &gt; 默认。
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {CATEGORY_META.map((meta) => {
                    const target = router[meta.key];
                    const currentValue = target.providerId
                        ? encodeOption(target.providerId, target.targetModel)
                        : EMPTY_OPTION;
                    const hasCurrentInList = comboItems.some((item) => item.value === currentValue);
                    const currentDisplayLabel = hasCurrentInList
                        ? comboLabelMap.get(currentValue)
                        : target.providerId
                            ? `${target.providerLabel || target.providerId} / ${target.targetModel || '(未填模型)'}`
                            : '没有选择';
                    const Icon = meta.icon;

                    return (
                        <div
                            key={meta.key}
                            className="space-y-3 rounded-[10px] border border-[rgba(226,226,226,0.12)] bg-white/[0.015] p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.04] text-muted-foreground">
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                        <p className="text-[15px] font-medium text-foreground leading-tight">{meta.label}</p>
                                        <p className="text-[12px] text-muted-foreground leading-relaxed">{meta.description}</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={target.enabled}
                                    onCheckedChange={(checked) => void updateCategory(meta.key, { enabled: checked })}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">
                                    Provider, 模型
                                </label>
                                <Select
                                    value={hasCurrentInList ? currentValue : EMPTY_OPTION}
                                    onValueChange={(value) => void handleSelectCombo(meta.key, value)}
                                >
                                    <SelectTrigger className="h-10 w-full rounded-[8px] border-[rgba(226,226,226,0.15)] bg-black/20 text-[14px]">
                                        <SelectValue placeholder="没有选择">
                                            {currentDisplayLabel}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={EMPTY_OPTION}>没有选择</SelectItem>
                                        {comboItems.map((item) => (
                                            <SelectItem key={item.value} value={item.value}>
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {target.providerId && !hasCurrentInList ? (
                                    <p className="text-[11px] text-yellow-500/80 leading-relaxed">
                                        当前选择 {target.providerLabel || target.providerId} / {target.targetModel || '(未填模型)'} 不在已登记模型列表中。
                                    </p>
                                ) : null}
                            </div>

                            {meta.key === 'longContext' ? (
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">
                                        上下文阈值 (tokens)
                                    </label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={router.longContextThreshold}
                                        onChange={(event) => void updateThreshold(event.target.value)}
                                        className="h-10 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                    />
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        估算 input 超过该值时命中长上下文分类。默认 60000。
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

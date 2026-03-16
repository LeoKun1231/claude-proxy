import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import type { AppConfig, ModelRoute } from '../types/config';

interface ProviderOption {
    value: string;
    label: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
}

function uniqueModels(...groups: Array<Array<string> | undefined>) {
    const seen = new Set<string>();
    const result: string[] = [];

    groups.forEach((group) => {
        group?.forEach((value) => {
            const normalized = String(value || '').trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            result.push(normalized);
        });
    });

    return result;
}

function buildProviderOptions(config: AppConfig): ProviderOption[] {
    const providers = config.providers || {} as AppConfig['providers'];
    return Array.isArray(providers.customProviders)
        ? providers.customProviders.map(p => ({
            value: p.id,
            label: p.name,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey || '',
            models: Array.isArray(p.models) ? p.models : [],
        }))
        : [];
}

function emptyRoute(opts: ProviderOption[]): ModelRoute {
    const d = opts[0];
    return {
        id: `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        enabled: true, sourceModel: '', targetModel: '',
        providerId: d?.value || '', providerLabel: d?.label || '',
        baseUrl: d?.baseUrl || '', apiKey: d?.apiKey || '',
    };
}

function normalizeRoute(route: ModelRoute): ModelRoute {
    return {
        ...route,
        sourceModel: String(route.sourceModel || '').trim(),
        targetModel: String(route.targetModel || '').trim(),
        providerId: String(route.providerId || '').trim(),
        providerLabel: String(route.providerLabel || '').trim(),
        baseUrl: String(route.baseUrl || '').trim(),
        apiKey: String(route.apiKey || ''),
    };
}

export default function ModelRoutes() {
    const [routes, setRoutes] = useState<ModelRoute[]>([]);
    const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
    const [globalModels, setGlobalModels] = useState<string[]>([]);
    const saveRef = useRef<number | null>(null);
    const sourceModelListId = useRef(`route-source-models-${Math.random().toString(36).slice(2, 8)}`);

    const loadData = useCallback(async () => {
        if (!window.electronAPI) return;
        const cfg = await window.electronAPI.getAllConfig();
        setRoutes(Array.isArray(cfg.modelRoutes) ? cfg.modelRoutes.map(normalizeRoute) : []);
        setProviderOptions(buildProviderOptions(cfg));
        setGlobalModels(Array.isArray(cfg.globalModels) ? cfg.globalModels : []);
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    useEffect(() => {
        if (!window.electronAPI?.onConfigUpdated || !window.electronAPI?.onConfigImported) return;

        const handleConfigUpdated = ({ key }: { key: string }) => {
            if (
                key === 'all' ||
                key === 'globalModels' ||
                key === 'modelRoutes' ||
                key === 'providers.customProviders'
            ) {
                void loadData();
            }
        };

        const handleConfigImported = () => {
            void loadData();
        };

        window.electronAPI.onConfigUpdated(handleConfigUpdated);
        window.electronAPI.onConfigImported(handleConfigImported);

        return () => {
            window.electronAPI.removeConfigUpdatedListener?.(handleConfigUpdated);
            window.electronAPI.removeConfigImportedListener?.(handleConfigImported);
        };
    }, [loadData]);

    const save = useCallback((next: ModelRoute[]) => {
        if (saveRef.current) clearTimeout(saveRef.current);
        saveRef.current = window.setTimeout(async () => {
            try { await window.electronAPI.setConfig('modelRoutes', next.map(normalizeRoute)); }
            catch (e: any) { toast.error(e?.message || '保存失败'); }
        }, 400);
    }, []);

    const providerMap = useMemo(() =>
        Object.fromEntries(providerOptions.map(p => [p.value, p])), [providerOptions]);

    const update = useCallback((fn: (c: ModelRoute[]) => ModelRoute[]) => {
        setRoutes(c => {
            const next = fn(c).map(normalizeRoute);
            save(next);
            return next;
        });
    }, [save]);

    const setField = useCallback((id: string, field: keyof ModelRoute, val: string | boolean) => {
        update(c => c.map(r => {
            if (r.id !== id) return r;
            if (field === 'providerId') {
                const p = providerMap[String(val)];
                return { ...r, providerId: String(val), providerLabel: p?.label || '', baseUrl: p?.baseUrl || '', apiKey: p?.apiKey || '' };
            }
            return { ...r, [field]: val };
        }));
    }, [update, providerMap]);

    const add = useCallback(() => {
        if (!providerOptions.length) return toast.warning('请先添加一个服务商');
        update(c => [...c, emptyRoute(providerOptions)]);
    }, [update, providerOptions]);

    const remove = useCallback((id: string) => {
        update(c => c.filter(r => r.id !== id));
        toast.success('路由已移除');
    }, [update]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">模型路由</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">优先按源模型命中路由；仅在未命中时才回退到下方默认策略</p>
                </div>
                <Button size="sm" variant="outline" onClick={add}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> 添加路由
                </Button>
            </div>

            {routes.length === 0 ? (
                <div className="border border-dashed rounded-lg py-10 flex flex-col items-center text-muted-foreground text-sm">
                    <p>尚未配置路由</p>
                    <Button size="sm" variant="link" onClick={add} className="mt-1 cursor-pointer">创建第一条路由</Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {routes.map(route => {
                        const activeProvider = route.providerId ? providerMap[route.providerId] : undefined;
                        const targetModelSuggestions = uniqueModels(
                            activeProvider?.models,
                            globalModels,
                            route.targetModel ? [route.targetModel] : undefined
                        );
                        const providerItems = [
                            { value: 'none', label: '—' },
                            ...providerOptions.map((provider) => ({ value: provider.value, label: provider.label }))
                        ];
                        return (
                            <div key={route.id} className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <Switch checked={route.enabled} onCheckedChange={c => setField(route.id, 'enabled', c)} />
                                        <span className="text-xs font-medium text-muted-foreground">{route.enabled ? '已启用' : '已禁用'}</span>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => remove(route.id)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">源模型</label>
                                        <Input
                                            value={route.sourceModel}
                                            onChange={e => setField(route.id, 'sourceModel', e.target.value)}
                                            placeholder="claude-sonnet-4-*"
                                            list={globalModels.length ? sourceModelListId.current : undefined}
                                            autoComplete="off"
                                            className="h-8 text-sm font-mono"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            {globalModels.length > 0
                                                ? '可直接输入自定义模型，也可从全局模型池快速选择；Claude 4.x 的 .6 / -6 写法会自动兼容'
                                                : '支持自定义输入；添加全局模型后会在这里显示候选；Claude 4.x 的 .6 / -6 写法会自动兼容'}
                                        </p>
                                        {globalModels.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 pt-1">
                                                {globalModels.map((model) => (
                                                    <button
                                                        key={model}
                                                        type="button"
                                                        onClick={() => setField(route.id, 'sourceModel', model)}
                                                        className={cn(
                                                            'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-mono transition-colors cursor-pointer',
                                                            route.sourceModel === model
                                                                ? 'border-primary bg-primary/12 text-foreground'
                                                                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                                                        )}
                                                    >
                                                        {model}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">目标服务商</label>
                                        <Select
                                            items={providerItems}
                                            value={route.providerId || 'none'}
                                            onValueChange={v => setField(route.id, 'providerId', v === 'none' ? '' : v)}
                                        >
                                            <SelectTrigger className="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">—</SelectItem>
                                                {providerOptions.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">目标模型</label>
                                        <Input
                                            value={route.targetModel}
                                            onChange={e => setField(route.id, 'targetModel', e.target.value)}
                                            placeholder="留空则沿用源模型"
                                            list={targetModelSuggestions.length ? `${route.id}-target-models` : undefined}
                                            autoComplete="off"
                                            className="h-8 text-sm font-mono"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            命中此路由后优先改写为该模型；留空则保持原请求模型。
                                        </p>
                                        {targetModelSuggestions.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 pt-1">
                                                {targetModelSuggestions.map((model) => (
                                                    <button
                                                        key={model}
                                                        type="button"
                                                        onClick={() => setField(route.id, 'targetModel', model)}
                                                        className={cn(
                                                            'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-mono transition-colors cursor-pointer',
                                                            route.targetModel === model
                                                                ? 'border-primary bg-primary/12 text-foreground'
                                                                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                                                        )}
                                                    >
                                                        {model}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {targetModelSuggestions.length > 0 && (
                                            <datalist id={`${route.id}-target-models`}>
                                                {targetModelSuggestions.map((model) => <option key={model} value={model} />)}
                                            </datalist>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {globalModels.length > 0 && (
                <datalist id={sourceModelListId.current}>
                    {globalModels.map((model) => <option key={model} value={model} />)}
                </datalist>
            )}
        </div>
    );
}

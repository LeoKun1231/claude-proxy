import { DragEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { toast } from 'sonner';
import { parseModelsInput, mergeModels, removeProviderModel } from '@/lib/provider-options';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';

interface CustomHeader {
    name: string;
    value: string;
}

interface CustomProvider {
    id: string;
    name: string;
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl: string;
    customHeaders: CustomHeader[];
    stripFields?: string[];
}

function normalizeProvider(provider: CustomProvider): CustomProvider {
    return {
        ...provider,
        customHeaders: provider.customHeaders || [],
        stripFields: [],
    };
}

const SORT_LABELS: Record<string, string> = {
    custom: '默认排序',
    name: '按名称',
    enabled: '按状态',
    models: '按模型数量',
};

export default function ProviderConfig() {
    const [providers, setProviders] = useState<CustomProvider[]>([]);
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
    const [draggingProviderId, setDraggingProviderId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<string>('custom');
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        (async () => {
            if (!window.electronAPI) return;
            const cfg = await window.electronAPI.getAllConfig();
            const raw = (cfg.providers?.customProviders || []) as CustomProvider[];
            const normalized = raw.map(normalizeProvider);
            setProviders(normalized);
            if (raw.some((provider) => (provider.stripFields || []).length > 0)) {
                queueSave(normalized);
            }
        })();
    }, []);

    const queueSave = (next: CustomProvider[]) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(async () => {
            try {
                await window.electronAPI?.setConfig('providers.customProviders', next);
            } catch (e: any) {
                toast.error(e?.message || '保存失败');
            }
        }, 400);
    };

    const addProvider = () => {
        const provider: CustomProvider = {
            id: `custom_${Date.now()}`,
            name: '',
            enabled: true,
            apiKey: '',
            models: [],
            baseUrl: '',
            customHeaders: [],
            stripFields: [],
        };
        const next = [...providers, provider];
        setProviders(next);
        queueSave(next);
    };

    const updateProvider = (id: string, field: keyof CustomProvider, value: any) => {
        setProviders(prev => {
            const next = prev.map(provider => (
                provider.id === id ? { ...provider, [field]: value } : provider
            ));
            queueSave(next);
            return next;
        });
    };

    const setModelDraft = (id: string, value: string) => {
        setModelDrafts(prev => ({ ...prev, [id]: value }));
    };

    const addModels = (id: string) => {
        const parsed = parseModelsInput(modelDrafts[id] || '');
        if (parsed.length === 0) return;

        setProviders(prev => {
            const next = prev.map(provider => {
                if (provider.id !== id) return provider;
                return { ...provider, models: mergeModels(provider.models, parsed) };
            });
            queueSave(next);
            return next;
        });

        setModelDrafts(prev => ({ ...prev, [id]: '' }));
    };

    const removeModel = (id: string, model: string) => {
        setProviders(prev => {
            const next = prev.map(provider => (
                provider.id === id
                    ? { ...provider, models: removeProviderModel(provider.models, model) }
                    : provider
            ));
            queueSave(next);
            return next;
        });
    };

    const onModelKeyDown = (event: KeyboardEvent<HTMLInputElement>, id: string) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addModels(id);
    };

    const addCustomHeader = (id: string) => {
        setProviders(prev => {
            const next = prev.map(provider => (
                provider.id === id
                    ? { ...provider, customHeaders: [...provider.customHeaders, { name: '', value: '' }] }
                    : provider
            ));
            queueSave(next);
            return next;
        });
    };

    const updateCustomHeader = (id: string, index: number, field: keyof CustomHeader, value: string) => {
        setProviders(prev => {
            const next = prev.map(provider => {
                if (provider.id !== id) return provider;
                const headers = provider.customHeaders.map((header, i) => (
                    i === index ? { ...header, [field]: value } : header
                ));
                return { ...provider, customHeaders: headers };
            });
            queueSave(next);
            return next;
        });
    };

    const removeCustomHeader = (id: string, index: number) => {
        setProviders(prev => {
            const next = prev.map(provider => (
                provider.id === id
                    ? { ...provider, customHeaders: provider.customHeaders.filter((_, i) => i !== index) }
                    : provider
            ));
            queueSave(next);
            return next;
        });
    };

    const deleteProvider = (id: string) => {
        const next = providers.filter(provider => provider.id !== id);
        setProviders(next);
        queueSave(next);
        setModelDrafts(prev => {
            const drafts = { ...prev };
            delete drafts[id];
            return drafts;
        });
        toast.success('服务商已移除');
    };

    const moveProvider = (fromId: string, toId: string) => {
        if (fromId === toId) return;
        setProviders(prev => {
            const fromIndex = prev.findIndex(provider => provider.id === fromId);
            const toIndex = prev.findIndex(provider => provider.id === toId);
            if (fromIndex < 0 || toIndex < 0) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            queueSave(next);
            return next;
        });
    };

    const onProviderDragStart = (event: DragEvent<HTMLElement>, id: string) => {
        setDraggingProviderId(id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
    };

    const onProviderDragOver = (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };

    const onProviderDrop = (event: DragEvent<HTMLElement>, id: string) => {
        event.preventDefault();
        const fromId = draggingProviderId || event.dataTransfer.getData('text/plain');
        if (fromId) moveProvider(fromId, id);
        setDraggingProviderId(null);
    };

    const onProviderDragEnd = () => {
        setDraggingProviderId(null);
    };

    const sortedProviders = useMemo(() => {
        const list = [...providers];
        switch (sortBy) {
            case 'name':
                list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
                break;
            case 'enabled':
                list.sort((a, b) => Number(b.enabled) - Number(a.enabled));
                break;
            case 'models':
                list.sort((a, b) => b.models.length - a.models.length);
                break;
        }
        return list;
    }, [providers, sortBy]);

    return (
        <div className="space-y-4 animate-in fade-in duration-500 fill-mode-both">
            <div className="flex items-center justify-between rounded-[20px] border border-border/40 bg-gradient-to-br from-card/60 to-transparent p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-md mb-4">
                <div className="space-y-1">
                    <h3 className="text-[20px] font-medium tracking-tight text-foreground flex items-center gap-2">
                        <Icon icon="ph:plugs-connected-bold" className="text-primary/80" /> 自定义服务商
                    </h3>
                    <p className="text-[13px] text-muted-foreground/80 leading-relaxed max-w-xl">
                        用于模型路由的后端 API 服务连接配置
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v || 'custom')}>
                        <SelectTrigger size="sm" className="h-9 rounded-xl border-border/40 bg-background/50 backdrop-blur-sm text-[13px] text-muted-foreground shadow-sm hover:border-border/80 transition-colors w-[120px] focus-visible:ring-primary/30">
                            <SelectValue render={(v: any) => <span className="font-medium">{SORT_LABELS[v] || '默认排序'}</span>} />
                        </SelectTrigger>
                        <SelectContent side="bottom" align="end" className="rounded-xl border-border/40 bg-background/80 backdrop-blur-md min-w-[120px]">
                            <SelectItem value="custom" className="text-[13px] cursor-pointer rounded-lg font-medium">默认排序</SelectItem>
                            <SelectItem value="name" className="text-[13px] cursor-pointer rounded-lg font-medium">按名称</SelectItem>
                            <SelectItem value="enabled" className="text-[13px] cursor-pointer rounded-lg font-medium">按状态</SelectItem>
                            <SelectItem value="models" className="text-[13px] cursor-pointer rounded-lg font-medium">按模型数量</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-9 border-border/60 rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-medium" onClick={addProvider}>
                        <Icon icon="ph:plus-bold" className="w-4 h-4 mr-1.5" /> 添加
                    </Button>
                </div>
            </div>

            {providers.length === 0 ? (
                <div className="border border-border/40 rounded-[20px] py-16 flex flex-col items-center justify-center text-center bg-gradient-to-b from-muted/20 to-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-muted/40 text-muted-foreground/50 mb-4 border border-border/30 shadow-sm">
                        <Icon icon="ph:ghost-bold" className="h-8 w-8" />
                    </div>
                    <p className="text-[18px] font-medium text-foreground tracking-tight mb-2">尚未配置服务商</p>
                    <p className="text-[14px] text-muted-foreground/80 mb-5 max-w-md">添加自定义服务商后，您可以在这里配置上游模型接口及路由策略。</p>
                    <Button size="sm" variant="outline" onClick={addProvider} className="h-10 px-6 rounded-xl border-primary/20 bg-primary/5 text-primary hover:bg-primary/15 transition-colors font-medium">
                        <Icon icon="ph:plus-bold" className="w-4 h-4 mr-1.5" /> 添加第一个服务商
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {sortedProviders.map(provider => (
                        <div
                            key={provider.id}
                            onDragOver={onProviderDragOver}
                            onDrop={(event) => onProviderDrop(event, provider.id)}
                            onDragEnd={onProviderDragEnd}
                            className={cn(
                                'border border-border/40 rounded-[16px] p-5 space-y-4 bg-gradient-to-r from-muted/20 to-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all duration-300 hover:border-border/80 group/provider',
                                draggingProviderId === provider.id && 'opacity-55 scale-[0.99] bg-muted/40',
                                !provider.enabled && 'opacity-70 grayscale-[0.3]'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    draggable
                                    onDragStart={(event) => onProviderDragStart(event, provider.id)}
                                    className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 hover:text-foreground transition-colors active:cursor-grabbing rounded-md hover:bg-muted/50"
                                    aria-label="拖拽排序"
                                >
                                    <Icon icon="ph:dots-six-vertical-bold" className="h-4 w-4" />
                                </button>
                                <Switch checked={provider.enabled} onCheckedChange={checked => updateProvider(provider.id, 'enabled', checked)} className="data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_15px_rgba(6,182,212,0.5)] scale-90" />
                                <Input
                                    value={provider.name}
                                    onChange={e => updateProvider(provider.id, 'name', e.target.value)}
                                    placeholder="服务商名称"
                                    className="h-9 flex-1 border-border/50 bg-background/50 backdrop-blur-sm px-3 text-[14px] font-medium rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                />
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded-lg transition-colors" onClick={() => deleteProvider(provider.id)}>
                                    <Icon icon="ph:trash-bold" className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 gap-3 pt-1">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[1px] ml-1">基础 API 地址</label>
                                    <Input
                                        value={provider.baseUrl}
                                        onChange={e => updateProvider(provider.id, 'baseUrl', e.target.value)}
                                        placeholder="https://api.example.com"
                                        className="h-9 text-[13px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[1px] ml-1">API 密钥</label>
                                    <Input
                                        type="password"
                                        value={provider.apiKey}
                                        onChange={e => updateProvider(provider.id, 'apiKey', e.target.value)}
                                        placeholder="sk-..."
                                        className="h-9 text-[13px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-border/20">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-0.5">
                                        <label className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[1px] ml-1 flex items-center gap-1.5">
                                            支持的模型
                                        </label>
                                        <p className="text-[12px] text-muted-foreground/70 leading-relaxed max-w-2xl ml-1">
                                            添加后会写入当前服务商的 `models`，并自动进入路由页的目标模型候选。
                                        </p>
                                    </div>
                                    <Badge variant="outline" className="h-5 px-2 rounded-full font-mono text-[10px] bg-muted/20 border-border/50">
                                        {provider.models.length} 项
                                    </Badge>
                                </div>

                                <div className="flex flex-col gap-2 md:flex-row pt-1">
                                    <Input
                                        value={modelDrafts[provider.id] || ''}
                                        onChange={e => setModelDraft(provider.id, e.target.value)}
                                        onKeyDown={e => onModelKeyDown(e, provider.id)}
                                        placeholder="例如: claude-sonnet-4-20250514，可用逗号一次添加多个"
                                        className="h-9 flex-1 text-[13px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                    />
                                    <Button type="button" size="sm" variant="outline" className="shrink-0 h-9 px-4 border-border/60 rounded-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-medium text-[12px]" onClick={() => addModels(provider.id)}>
                                        <Icon icon="ph:plus-bold" className="w-3.5 h-3.5 mr-1" /> 添加模型
                                    </Button>
                                </div>

                                {provider.models.length > 0 ? (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        {provider.models.map(model => (
                                            <Badge key={model} variant="outline" className="h-7 gap-1.5 rounded-[8px] px-3 font-mono text-[13px] border-border/40 bg-background/60 backdrop-blur-sm shadow-sm transition-colors hover:border-border/80 group/model">
                                                <span>{model}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeModel(provider.id, model)}
                                                    className="rounded-full p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive hover:bg-destructive/10 cursor-pointer -mr-1"
                                                    aria-label={`移除模型 ${model}`}
                                                >
                                                    <Icon icon="ph:x-bold" className="w-3.5 h-3.5" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-4 text-center text-[12px] font-medium text-muted-foreground/60">
                                        暂无模型。添加后，路由页会直接复用这些模型作为目标候选。
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3 pt-4 border-t border-border/20">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-0.5">
                                        <label className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-[1px] ml-1">自定义请求头</label>
                                        <p className="text-[12px] text-muted-foreground/70 leading-relaxed max-w-2xl ml-1">
                                            转发到上游时附加的请求头。同名客户端请求头会被覆盖；不允许设置 Authorization 等保留头。
                                        </p>
                                    </div>
                                    <Badge variant="outline" className="h-5 px-2 rounded-full font-mono text-[10px] bg-muted/20 border-border/50">
                                        {provider.customHeaders.length} 条
                                    </Badge>
                                </div>

                                {provider.customHeaders.length > 0 && (
                                    <div className="space-y-2 pt-1">
                                        {provider.customHeaders.map((header, index) => (
                                            <div key={index} className="flex items-center gap-2 group/header">
                                                <Input
                                                    value={header.name}
                                                    onChange={e => updateCustomHeader(provider.id, index, 'name', e.target.value)}
                                                    placeholder="Key"
                                                    className="h-9 flex-1 text-[13px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                                />
                                                <span className="text-muted-foreground/40 font-mono">:</span>
                                                <Input
                                                    value={header.value}
                                                    onChange={e => updateCustomHeader(provider.id, index, 'value', e.target.value)}
                                                    placeholder="Value"
                                                    className="h-9 flex-1 text-[13px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-lg focus-visible:ring-primary/30 transition-colors hover:border-border/80"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground/50 opacity-0 group-hover/header:opacity-100 hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded-lg transition-all"
                                                    onClick={() => removeCustomHeader(provider.id, index)}
                                                    aria-label="移除请求头"
                                                >
                                                    <Icon icon="ph:trash-bold" className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-4 border-border/60 rounded-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-secondary/20 hover:border-secondary/30 transition-all font-medium mt-1 text-[12px]"
                                    onClick={() => addCustomHeader(provider.id)}
                                >
                                    <Icon icon="ph:plus-bold" className="w-3.5 h-3.5 mr-1" /> 添加请求头
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
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

function parseModels(value: string) {
    const unique = new Set<string>();
    return value
        .split(/[,\n]/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter((item) => {
            if (unique.has(item)) return false;
            unique.add(item);
            return true;
        });
}

export default function ProviderConfig() {
    const [providers, setProviders] = useState<CustomProvider[]>([]);
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
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
        const parsed = parseModels(modelDrafts[id] || '');
        if (parsed.length === 0) return;

        setProviders(prev => {
            const next = prev.map(provider => {
                if (provider.id !== id) return provider;
                const merged = Array.from(new Set([...provider.models, ...parsed]));
                return { ...provider, models: merged };
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
                    ? { ...provider, models: provider.models.filter(item => item !== model) }
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

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-[24px] font-normal tracking-[0px] text-foreground">自定义服务商</h3>
                    <p className="text-[18px] text-muted-foreground mt-1 leading-relaxed">用于模型路由的后端 API 服务连接</p>
                </div>
                <Button size="sm" variant="outline" className="border-[rgba(226,226,226,0.35)] rounded-[50px] shadow-none hover:bg-[rgba(255,255,255,0.04)]" onClick={addProvider}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> 添加
                </Button>
            </div>

            {providers.length === 0 ? (
                <div className="border border-[rgba(226,226,226,0.35)] rounded-[12px] py-10 flex flex-col items-center justify-center text-center">
                    <p className="text-[20px] font-normal text-foreground mb-2">尚未配置服务商</p>
                    <Button size="sm" variant="link" onClick={addProvider} className="mt-1 cursor-pointer text-muted-foreground">添加第一个服务商</Button>
                </div>
            ) : (
                <div className="space-y-4">
                    {providers.map(provider => (
                        <div key={provider.id} className="border border-[rgba(226,226,226,0.35)] rounded-[12px] p-6 space-y-5 bg-transparent">
                            <div className="flex items-center gap-3">
                                <Switch checked={provider.enabled} onCheckedChange={checked => updateProvider(provider.id, 'enabled', checked)} />
                                <Input
                                    value={provider.name}
                                    onChange={e => updateProvider(provider.id, 'name', e.target.value)}
                                    placeholder="服务商名称"
                                    className="h-10 flex-1 border-[rgba(226,226,226,0.15)] bg-black/20 px-3 text-[16px] font-medium rounded-[8px] focus-visible:ring-1 focus-visible:ring-[rgba(226,226,226,0.35)]"
                                />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => deleteProvider(provider.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">基础 API 地址</label>
                                    <Input
                                        value={provider.baseUrl}
                                        onChange={e => updateProvider(provider.id, 'baseUrl', e.target.value)}
                                        placeholder="https://api.example.com"
                                        className="h-10 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">API 密钥</label>
                                    <Input
                                        type="password"
                                        value={provider.apiKey}
                                        onChange={e => updateProvider(provider.id, 'apiKey', e.target.value)}
                                        placeholder="sk-..."
                                        className="h-10 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">支持的模型</label>
                                        <p className="mt-1 flex-[11px] text-muted-foreground text-[14px] leading-relaxed">
                                            添加后会写入当前服务商的 `models`，并自动进入路由页的目标模型候选。
                                        </p>
                                    </div>
                                    <span className="text-[12px] text-muted-foreground uppercase tracking-[1.4px] font-medium">{provider.models.length} 个模型</span>
                                </div>

                                <div className="flex flex-col gap-3 md:flex-row">
                                    <Input
                                        value={modelDrafts[provider.id] || ''}
                                        onChange={e => setModelDraft(provider.id, e.target.value)}
                                        onKeyDown={e => onModelKeyDown(e, provider.id)}
                                        placeholder="例如: claude-sonnet-4-20250514，可用逗号一次添加多个"
                                        className="h-10 flex-1 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                    />
                                    <Button type="button" size="sm" variant="outline" className="shrink-0 h-10 px-4 border-[rgba(226,226,226,0.35)] rounded-[50px] shadow-none hover:bg-[rgba(255,255,255,0.04)]" onClick={() => addModels(provider.id)}>
                                        <Plus className="w-3.5 h-3.5 mr-1" /> 添加模型
                                    </Button>
                                </div>

                                {provider.models.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {provider.models.map(model => (
                                            <Badge key={model} variant="outline" className="h-auto gap-1 rounded-[6px] px-2.5 py-1.5 font-mono text-[13px] border-[rgba(226,226,226,0.15)] bg-white/[0.02]">
                                                <span>{model}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeModel(provider.id, model)}
                                                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                                                    aria-label={`移除模型 ${model}`}
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-[8px] border border-[rgba(226,226,226,0.15)] bg-white/[0.015] px-4 py-5 text-[14px] text-muted-foreground">
                                        暂无模型。添加后，路由页会直接复用这些模型作为目标候选。
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">自定义请求头</label>
                                        <p className="mt-1 flex-[11px] text-muted-foreground text-[14px] leading-relaxed">
                                            转发到上游时附加的请求头。同名客户端请求头会被覆盖；不允许设置 Authorization / x-api-key 等鉴权相关的保留头。
                                        </p>
                                    </div>
                                    <span className="text-[12px] text-muted-foreground uppercase tracking-[1.4px] font-medium">{provider.customHeaders.length} 条</span>
                                </div>

                                {provider.customHeaders.length > 0 && (
                                    <div className="space-y-2">
                                        {provider.customHeaders.map((header, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <Input
                                                    value={header.name}
                                                    onChange={e => updateCustomHeader(provider.id, index, 'name', e.target.value)}
                                                    placeholder="Header 名称，例如 X-Custom-Header"
                                                    className="h-10 flex-1 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                                />
                                                <span className="text-muted-foreground text-[14px]">:</span>
                                                <Input
                                                    value={header.value}
                                                    onChange={e => updateCustomHeader(provider.id, index, 'value', e.target.value)}
                                                    placeholder="Header 值"
                                                    className="h-10 flex-1 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive cursor-pointer"
                                                    onClick={() => removeCustomHeader(provider.id, index)}
                                                    aria-label="移除请求头"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-10 px-4 border-[rgba(226,226,226,0.35)] rounded-[50px] shadow-none hover:bg-[rgba(255,255,255,0.04)]"
                                    onClick={() => addCustomHeader(provider.id)}
                                >
                                    <Plus className="w-3.5 h-3.5 mr-1" /> 添加请求头
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

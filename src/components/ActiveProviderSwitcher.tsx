import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Pencil, Plus, Server, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    hasModel,
    mergeModels,
    normalizeModels,
    parseModelsInput,
    removeProviderModel,
    replaceModel,
} from '@/lib/provider-options';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { CustomProviderData, ModelRoute } from '../types/config';

interface EditingModelState {
    providerId: string;
    original: string;
    value: string;
}

interface ProviderModelUpdate {
    updatedProvider: CustomProviderData;
    nextProviders: CustomProviderData[];
}

function normalizeCustomProviders(providers: CustomProviderData[]): CustomProviderData[] {
    return providers.map((provider): CustomProviderData => ({
        ...provider,
        models: normalizeModels(provider.models),
        customHeaders: provider.customHeaders || [],
    }));
}

function createCatchAllRoute(provider: CustomProviderData, modelName?: string): ModelRoute {
    return {
        id: `route_catchall_${Date.now()}`,
        enabled: true,
        sourceModel: '*',
        targetModel: modelName || '',
        providerId: provider.id,
        providerLabel: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey || '',
    };
}

export default function ActiveProviderSwitcher() {
    const [providers, setProviders] = useState<CustomProviderData[]>([]);
    const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
    const [activeModelName, setActiveModelName] = useState<string | null>(null);
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
    const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
    const timerRef = useRef<number | null>(null);
    const editingCommitRef = useRef(false);

    const queueSaveProviders = useCallback((next: CustomProviderData[]) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(async () => {
            try {
                await window.electronAPI?.setConfig('providers.customProviders', next);
            } catch (e: any) {
                toast.error(e?.message || '保存模型失败');
            } finally {
                timerRef.current = null;
            }
        }, 300);
    }, []);

    const saveProvidersImmediately = useCallback(async (next: CustomProviderData[]) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        await window.electronAPI?.setConfig('providers.customProviders', next);
    }, []);

    const setActiveRoute = useCallback(async (provider: CustomProviderData, modelName?: string) => {
        await window.electronAPI.setConfig('modelRoutes', [createCatchAllRoute(provider, modelName)]);
        setActiveProviderId(provider.id);
        setActiveModelName(modelName || null);
    }, []);

    const handleSelectProvider = useCallback(async (provider: CustomProviderData, modelName?: string) => {
        try {
            await setActiveRoute(provider, modelName);
            toast.success(`已切换至: ${provider.name}${modelName ? ` (${modelName})` : ''}`);
        } catch (e: any) {
            toast.error(e?.message || '切换失败');
        }
    }, [setActiveRoute]);

    const loadData = useCallback(async () => {
        if (!window.electronAPI) return;
        const cfg = await window.electronAPI.getAllConfig();
        const customProviders = normalizeCustomProviders(
            Array.isArray(cfg.providers?.customProviders) ? cfg.providers.customProviders : []
        );
        const enabledProviders = customProviders.filter(provider => provider.enabled);
        setProviders(customProviders);

        const routes = Array.isArray(cfg.modelRoutes) ? cfg.modelRoutes : [];
        if (routes.length === 1 && routes[0].sourceModel === '*') {
            const activeProvider = enabledProviders.find(provider => provider.id === routes[0].providerId);
            setActiveProviderId(activeProvider ? routes[0].providerId : null);
            setActiveModelName(activeProvider ? routes[0].targetModel || null : null);
        } else if (enabledProviders.length === 1 && routes.length === 0) {
            void handleSelectProvider(enabledProviders[0]);
        } else if (routes.length === 0) {
            setActiveProviderId(null);
            setActiveModelName(null);
        } else {
            const route = routes.find(r => r.enabled);
            const activeProvider = enabledProviders.find(provider => provider.id === route?.providerId);
            setActiveProviderId(activeProvider ? route?.providerId || null : null);
            setActiveModelName(activeProvider ? route?.targetModel || null : null);
        }
    }, [handleSelectProvider]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onConfigUpdated) return;

        const handleConfigUpdated = ({ key }: { key: string }) => {
            if (key === 'all' || key === 'modelRoutes' || key === 'providers.customProviders') {
                void loadData();
            }
        };

        window.electronAPI.onConfigUpdated(handleConfigUpdated);
        return () => window.electronAPI.removeConfigUpdatedListener?.(handleConfigUpdated);
    }, [loadData]);

    const setModelDraft = useCallback((providerId: string, value: string) => {
        setModelDrafts((prev: Record<string, string>) => ({ ...prev, [providerId]: value }));
    }, []);

    const buildProviderModelUpdate = useCallback((providerId: string, nextModels: string[]): ProviderModelUpdate | null => {
        let updatedProvider: CustomProviderData | null = null;
        const nextProviders = providers.map((provider): CustomProviderData => {
            if (provider.id !== providerId) return provider;
            const updated = { ...provider, models: normalizeModels(nextModels) };
            updatedProvider = updated;
            return updated;
        });
        if (!updatedProvider) return null;
        return { updatedProvider, nextProviders };
    }, [providers]);

    const updateProviderModels = useCallback((providerId: string, nextModels: string[]) => {
        const update = buildProviderModelUpdate(providerId, nextModels);
        if (!update) return null;
        setProviders(update.nextProviders);
        queueSaveProviders(update.nextProviders);
        return update.updatedProvider;
    }, [buildProviderModelUpdate, queueSaveProviders]);

    const addModels = useCallback((providerId: string) => {
        const parsed = parseModelsInput(modelDrafts[providerId] || '');
        if (parsed.length === 0) return;
        const provider = providers.find((item: CustomProviderData) => item.id === providerId);
        if (!provider) return;
        const currentModels = normalizeModels(provider.models);
        const nextModels = mergeModels(currentModels, parsed);
        if (nextModels.length === currentModels.length) {
            toast.info('模型已存在');
            return;
        }
        updateProviderModels(providerId, nextModels);
        setModelDrafts((prev: Record<string, string>) => ({ ...prev, [providerId]: '' }));
        toast.success(nextModels.length - currentModels.length > 1 ? `已添加 ${nextModels.length - currentModels.length} 个模型` : '模型已添加');
    }, [modelDrafts, providers, updateProviderModels]);

    const onModelDraftKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>, providerId: string) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addModels(providerId);
    }, [addModels]);

    const startEditModel = useCallback((event: MouseEvent<HTMLElement>, providerId: string, model: string) => {
        event.stopPropagation();
        editingCommitRef.current = false;
        setEditingModel({ providerId, original: model, value: model });
    }, []);

    const cancelEditModel = useCallback((event?: MouseEvent<HTMLElement>) => {
        event?.stopPropagation();
        editingCommitRef.current = true;
        setEditingModel(null);
    }, []);

    const commitEditModel = useCallback(async (providerId: string, original: string, rawValue: string) => {
        if (editingCommitRef.current) return;
        editingCommitRef.current = true;
        const nextValue = rawValue.trim();
        if (!nextValue) {
            editingCommitRef.current = false;
            toast.error('模型名不能为空');
            return;
        }
        if (nextValue === original) {
            editingCommitRef.current = false;
            setEditingModel(null);
            return;
        }
        const provider = providers.find((item: CustomProviderData) => item.id === providerId);
        if (!provider) {
            editingCommitRef.current = false;
            return;
        }
        if (hasModel(provider.models, nextValue, original)) {
            editingCommitRef.current = false;
            toast.error('模型已存在');
            return;
        }

        const update = buildProviderModelUpdate(providerId, replaceModel(provider.models, original, nextValue));
        if (!update) {
            editingCommitRef.current = false;
            return;
        }
        setProviders(update.nextProviders);
        try {
            await saveProvidersImmediately(update.nextProviders);
            if (activeProviderId === providerId && activeModelName === original) {
                await setActiveRoute(update.updatedProvider, nextValue);
            }
            setEditingModel(null);
            toast.success('模型已更新');
        } catch (e: any) {
            toast.error(e?.message || '保存模型失败');
        } finally {
            editingCommitRef.current = false;
        }
    }, [activeModelName, activeProviderId, buildProviderModelUpdate, providers, saveProvidersImmediately, setActiveRoute]);

    const onEditingModelKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (!editingModel) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            editingCommitRef.current = true;
            setEditingModel(null);
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void commitEditModel(editingModel.providerId, editingModel.original, editingModel.value);
    }, [commitEditModel, editingModel]);

    const removeModel = useCallback(async (event: MouseEvent<HTMLElement>, provider: CustomProviderData, model: string) => {
        event.stopPropagation();
        const update = buildProviderModelUpdate(provider.id, removeProviderModel(provider.models, model));
        if (!update) return;
        setProviders(update.nextProviders);
        try {
            await saveProvidersImmediately(update.nextProviders);
            if (activeProviderId === provider.id && activeModelName === model) {
                await setActiveRoute(update.updatedProvider);
            }
            if (editingModel?.providerId === provider.id && editingModel.original === model) {
                setEditingModel(null);
            }
            toast.success('模型已删除');
        } catch (e: any) {
            toast.error(e?.message || '删除模型失败');
        }
    }, [activeModelName, activeProviderId, buildProviderModelUpdate, editingModel, saveProvidersImmediately, setActiveRoute]);

    const visibleProviders = useMemo(
        () => providers.filter((provider: CustomProviderData) => provider.enabled),
        [providers]
    );

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[24px] font-normal tracking-[-0px] text-foreground">活跃网关</h2>
                <p className="text-[18px] text-muted-foreground mt-1 leading-relaxed">
                    点击下方卡片即可将所有请求路由到指定服务商，抛弃繁杂的细粒度路由规则。
                </p>
            </div>

            {visibleProviders.length === 0 ? (
                <div className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-10 flex flex-col items-center justify-center text-center">
                    <Server className="w-8 h-8 text-muted-foreground/50 mb-4" />
                    <p className="text-[20px] font-normal text-foreground mb-2">暂无已启用服务商</p>
                    <p className="text-[14px] text-muted-foreground">请在左侧“服务商列表”中启用至少一个服务商</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visibleProviders.map((provider: CustomProviderData) => {
                        const isActive = activeProviderId === provider.id;
                        const models = normalizeModels(provider.models);

                        return (
                            <div
                                key={provider.id}
                                onClick={() => handleSelectProvider(provider)}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                    'relative flex flex-col text-left p-6 rounded-[12px] border transition-all duration-300 outline-none overflow-hidden group h-full cursor-pointer',
                                    isActive
                                        ? 'border-[rgba(226,226,226,0.6)] bg-[rgba(255,255,255,0.04)]'
                                        : 'border-[rgba(226,226,226,0.35)] bg-transparent hover:bg-[rgba(255,255,255,0.02)]'
                                )}
                            >
                                <div className="flex items-start justify-between w-full mb-5 relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            'flex items-center justify-center w-12 h-12 rounded-[8px] transition-colors',
                                            isActive ? 'bg-primary text-primary-foreground' : 'bg-[#353534] text-muted-foreground'
                                        )}>
                                            <Server className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className={cn(
                                                'font-normal text-[22px] tracking-tight transition-colors leading-none',
                                                isActive ? 'text-foreground' : 'text-muted-foreground'
                                            )}>
                                                {provider.name}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={cn(
                                                    'w-2 h-2 rounded-full',
                                                    provider.enabled ? 'bg-emerald-500' : 'bg-muted-foreground'
                                                )} />
                                                <span className="text-[12px] uppercase tracking-[2.4px] text-muted-foreground font-medium">
                                                    {provider.enabled ? '已启用' : '已禁用'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    {isActive && !activeModelName && (
                                        <div className="text-primary-foreground">
                                            <CheckCircle2 className="w-6 h-6" />
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4 mt-auto relative z-10 w-full">
                                    <div className="flex items-center gap-3 text-[14px]">
                                        <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-[1.4px] text-[11px]">代理地址</span>
                                        <span className="text-foreground font-mono truncate bg-[#353534]/50 px-2.5 py-1 rounded-[6px] flex-1">
                                            {provider.baseUrl || '未配置'}
                                        </span>
                                    </div>

                                    <div
                                        className="pt-4 border-t border-[rgba(226,226,226,0.15)] space-y-3"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-muted-foreground text-[11px] uppercase tracking-[1.4px] block">强制路由至模型 (点击选择)</span>
                                            <span className="text-[11px] text-muted-foreground font-mono">{models.length} 个</span>
                                        </div>

                                        <div className="flex flex-col gap-2 md:flex-row">
                                            <Input
                                                value={modelDrafts[provider.id] || ''}
                                                onChange={event => setModelDraft(provider.id, event.target.value)}
                                                onKeyDown={event => onModelDraftKeyDown(event, provider.id)}
                                                placeholder="添加模型，可用逗号或换行一次添加多个"
                                                className="h-9 flex-1 text-[13px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-9 shrink-0 px-3 border-[rgba(226,226,226,0.35)] rounded-[50px] shadow-none hover:bg-[rgba(255,255,255,0.04)]"
                                                onClick={() => addModels(provider.id)}
                                            >
                                                <Plus className="w-3.5 h-3.5 mr-1" /> 添加
                                            </Button>
                                        </div>

                                        {models.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {models.map((model: string) => {
                                                    const isModelActive = isActive && activeModelName === model;
                                                    const isEditing = editingModel?.providerId === provider.id && editingModel.original === model;

                                                    if (isEditing) {
                                                        return (
                                                            <div key={model} className="flex items-center gap-1 rounded-[6px] border border-[rgba(226,226,226,0.25)] bg-black/30 px-1.5 py-1">
                                                                <Input
                                                                    autoFocus
                                                                    value={editingModel.value}
                                                                    onChange={event => setEditingModel({ ...editingModel, value: event.target.value })}
                                                                    onKeyDown={onEditingModelKeyDown}
                                                                    onBlur={() => void commitEditModel(provider.id, model, editingModel.value)}
                                                                    className="h-7 w-48 border-transparent bg-transparent px-1 text-[13px] font-mono focus-visible:ring-0"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onMouseDown={event => event.preventDefault()}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        void commitEditModel(provider.id, model, editingModel.value);
                                                                    }}
                                                                    className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                                                                    aria-label={`保存模型 ${model}`}
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onMouseDown={event => event.preventDefault()}
                                                                    onClick={cancelEditModel}
                                                                    className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                                                                    aria-label={`取消编辑模型 ${model}`}
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div
                                                            key={model}
                                                            className={cn(
                                                                'inline-flex items-center overflow-hidden rounded-[6px] border transition-all',
                                                                isModelActive
                                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                                    : 'border-[rgba(226,226,226,0.15)] bg-[#353534]/30 text-muted-foreground hover:bg-[#353534]'
                                                            )}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSelectProvider(provider, model)}
                                                                className="px-3 py-1.5 text-[14px] font-mono font-medium"
                                                            >
                                                                {model}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(event) => startEditModel(event, provider.id, model)}
                                                                className={cn(
                                                                    'border-l px-1.5 py-1.5 transition-colors',
                                                                    isModelActive
                                                                        ? 'border-primary-foreground/20 text-primary-foreground/80 hover:text-primary-foreground'
                                                                        : 'border-[rgba(226,226,226,0.12)] text-muted-foreground hover:text-foreground'
                                                                )}
                                                                aria-label={`编辑模型 ${model}`}
                                                            >
                                                                <Pencil className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(event) => void removeModel(event, provider, model)}
                                                                className={cn(
                                                                    'border-l px-1.5 py-1.5 transition-colors',
                                                                    isModelActive
                                                                        ? 'border-primary-foreground/20 text-primary-foreground/80 hover:text-primary-foreground'
                                                                        : 'border-[rgba(226,226,226,0.12)] text-muted-foreground hover:text-destructive'
                                                                )}
                                                                aria-label={`删除模型 ${model}`}
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-[8px] border border-[rgba(226,226,226,0.15)] bg-white/[0.015] px-3 py-3 text-[13px] text-muted-foreground">
                                                暂无模型。未选择具体模型时，将按通配路由转发到当前服务商。
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

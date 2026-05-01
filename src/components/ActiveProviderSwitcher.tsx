import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { Dialog } from '@base-ui/react/dialog';
import { Collapsible } from '@base-ui/react/collapsible';
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
import type { CustomProviderData, ModelRoute, TestProviderModelResponse } from '../types/config';
import { DEFAULT_TEST_PROMPT } from '../types/config';

interface EditingModelState {
    providerId: string;
    original: string;
    value: string;
}

interface ProviderModelUpdate {
    updatedProvider: CustomProviderData;
    nextProviders: CustomProviderData[];
}

interface ModelGroup {
    model: string;
    providers: CustomProviderData[];
}

interface TestState {
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
    latencyMs?: number;
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

function createTestKey(providerId: string, model: string) {
    return `${providerId}::${model}`;
}

type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'glm' | 'kimi' | 'deepseek' | 'qwen' | 'other';

const FAMILY_ORDER: ModelFamily[] = ['claude', 'gpt', 'gemini', 'glm', 'kimi', 'deepseek', 'qwen', 'other'];

const FAMILY_LABELS: Record<ModelFamily, string> = {
    claude: 'Claude',
    gpt: 'GPT',
    gemini: 'Gemini',
    glm: 'GLM',
    kimi: 'Kimi',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    other: '其他',
};

function detectFamily(model: string): ModelFamily {
    const m = model.toLowerCase();
    if (m.startsWith('claude')) return 'claude';
    if (m.startsWith('gpt') || /^o[134]/.test(m) || m.startsWith('chatgpt')) return 'gpt';
    if (m.startsWith('gemini')) return 'gemini';
    if (m.startsWith('glm')) return 'glm';
    if (m.startsWith('kimi') || m.startsWith('moonshot')) return 'kimi';
    if (m.startsWith('deepseek')) return 'deepseek';
    if (m.startsWith('qwen') || m.startsWith('qwq')) return 'qwen';
    return 'other';
}

function groupProvidersByModel(providers: CustomProviderData[]): ModelGroup[] {
    const groups = new Map<string, CustomProviderData[]>();
    for (const provider of providers) {
        for (const model of normalizeModels(provider.models)) {
            const items = groups.get(model) || [];
            items.push(provider);
            groups.set(model, items);
        }
    }

    return Array.from(groups.entries())
        .map(([model, modelProviders]) => ({
            model,
            providers: [...modelProviders].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.model.localeCompare(b.model));
}

function sortModelGroupsByOrder(groups: ModelGroup[], modelOrder: string[]): ModelGroup[] {
    const orderIndex = new Map(modelOrder.map((model, index) => [model, index]));
    return [...groups].sort((a, b) => {
        const aIndex = orderIndex.get(a.model) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = orderIndex.get(b.model) ?? Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex || a.model.localeCompare(b.model);
    });
}

function moveModelInOrder(
    orderedModels: string[],
    visibleModels: string[],
    model: string,
    direction: 'top' | 'up' | 'down'
): string[] {
    const currentVisibleIndex = visibleModels.indexOf(model);
    if (currentVisibleIndex < 0) return orderedModels;

    const targetVisibleIndex = direction === 'top' ? 0 : direction === 'up' ? currentVisibleIndex - 1 : currentVisibleIndex + 1;
    const targetModel = visibleModels[targetVisibleIndex];
    if (!targetModel || targetModel === model) return orderedModels;

    const withoutModel = orderedModels.filter(item => item !== model);
    const targetOrderIndex = withoutModel.indexOf(targetModel);
    if (targetOrderIndex < 0) return orderedModels;

    const insertIndex = direction === 'down' ? targetOrderIndex + 1 : targetOrderIndex;
    return [
        ...withoutModel.slice(0, insertIndex),
        model,
        ...withoutModel.slice(insertIndex),
    ];
}

function summarizeTestResult(result: TestProviderModelResponse) {
    if (result.ok) {
        return result.output?.trim() || '测试成功';
    }
    return result.error?.trim() || '测试失败';
}

export default function ActiveProviderSwitcher() {
    const [providers, setProviders] = useState<CustomProviderData[]>([]);
    const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
    const [activeModelName, setActiveModelName] = useState<string | null>(null);
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
    const [editingModel, setEditingModel] = useState<EditingModelState | null>(null);
    const [defaultPromptDraft, setDefaultPromptDraft] = useState(DEFAULT_TEST_PROMPT);
    const [savedDefaultPrompt, setSavedDefaultPrompt] = useState(DEFAULT_TEST_PROMPT);
    const [savingDefaultPrompt, setSavingDefaultPrompt] = useState(false);
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const [activeFamily, setActiveFamily] = useState<ModelFamily | 'all'>('all');
    const [gatewayModelOrder, setGatewayModelOrder] = useState<string[]>([]);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [addProviderModal, setAddProviderModal] = useState<{ open: boolean; targetModel: string | null }>({ open: false, targetModel: null });
    const [testPromptDrafts, setTestPromptDrafts] = useState<Record<string, string>>({});
    const [testStates, setTestStates] = useState<Record<string, TestState>>({});
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
        const defaultPrompt = cfg.settings?.defaultTestPrompt?.trim() || DEFAULT_TEST_PROMPT;
        const modelOrder = Array.isArray(cfg.settings?.gatewayModelOrder) ? cfg.settings.gatewayModelOrder : [];
        setProviders(customProviders);
        setGatewayModelOrder(modelOrder);
        setSavedDefaultPrompt(defaultPrompt);
        setDefaultPromptDraft(defaultPrompt);

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
            if (
                key === 'all'
                || key === 'modelRoutes'
                || key === 'providers.customProviders'
                || key === 'settings'
                || key === 'settings.defaultTestPrompt'
                || key === 'settings.gatewayModelOrder'
            ) {
                void loadData();
            }
        };

        window.electronAPI.onConfigUpdated(handleConfigUpdated);
        return () => window.electronAPI.removeConfigUpdatedListener?.(handleConfigUpdated);
    }, [loadData]);

    const setModelDraft = useCallback((providerId: string, value: string) => {
        setModelDrafts((prev: Record<string, string>) => ({ ...prev, [providerId]: value }));
    }, []);

    const setTestPromptDraft = useCallback((key: string, value: string) => {
        setTestPromptDrafts((prev: Record<string, string>) => ({ ...prev, [key]: value }));
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

    const toggleExpanded = useCallback((key: string, open: boolean) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (open) next.add(key);
            else next.delete(key);
            return next;
        });
    }, []);

    const addProviderToModel = useCallback(async (provider: CustomProviderData, model: string) => {
        const update = buildProviderModelUpdate(provider.id, mergeModels(provider.models, [model]));
        if (!update) return;
        setProviders(update.nextProviders);
        try {
            await saveProvidersImmediately(update.nextProviders);
            setAddProviderModal({ open: false, targetModel: null });
            toast.success(`已将 ${model} 添加到 ${provider.name}`);
        } catch (e: any) {
            toast.error(e?.message || '添加失败');
        }
    }, [buildProviderModelUpdate, saveProvidersImmediately]);

    const saveDefaultPrompt = useCallback(async () => {
        const nextPrompt = defaultPromptDraft.trim() || DEFAULT_TEST_PROMPT;
        setSavingDefaultPrompt(true);
        try {
            await window.electronAPI.setConfig('settings.defaultTestPrompt', nextPrompt);
            setSavedDefaultPrompt(nextPrompt);
            setDefaultPromptDraft(nextPrompt);
            toast.success('默认测试语句已保存');
            setPromptModalOpen(false);
        } catch (e: any) {
            toast.error(e?.message || '保存默认测试语句失败');
        } finally {
            setSavingDefaultPrompt(false);
        }
    }, [defaultPromptDraft]);

    const sendTestRequest = useCallback(async (provider: CustomProviderData, model: string) => {
        const key = createTestKey(provider.id, model);
        const prompt = (testPromptDrafts[key] || '').trim() || savedDefaultPrompt.trim() || DEFAULT_TEST_PROMPT;
        setTestStates(prev => ({ ...prev, [key]: { status: 'loading' } }));
        try {
            const result = await window.electronAPI.testProviderModel({
                providerId: provider.id,
                model,
                prompt,
            });
            setTestStates(prev => ({
                ...prev,
                [key]: {
                    status: result.ok ? 'success' : 'error',
                    message: summarizeTestResult(result),
                    latencyMs: result.latencyMs,
                },
            }));
        } catch (e: any) {
            setTestStates(prev => ({
                ...prev,
                [key]: {
                    status: 'error',
                    message: e?.message || '测试请求失败',
                },
            }));
        }
    }, [savedDefaultPrompt, testPromptDrafts]);

    const visibleProviders = useMemo(
        () => providers.filter((provider: CustomProviderData) => provider.enabled),
        [providers]
    );

    const modelGroups = useMemo(
        () => groupProvidersByModel(visibleProviders),
        [visibleProviders]
    );

    const visibleModelGroups = useMemo(
        () => {
            const orderedGroups = sortModelGroupsByOrder(modelGroups, gatewayModelOrder);
            return activeFamily === 'all' ? orderedGroups : orderedGroups.filter(g => detectFamily(g.model) === activeFamily);
        },
        [modelGroups, gatewayModelOrder, activeFamily]
    );

    const moveModelGroup = useCallback(async (model: string, direction: 'top' | 'up' | 'down') => {
        const orderedModels = sortModelGroupsByOrder(modelGroups, gatewayModelOrder).map(group => group.model);
        const visibleModels = visibleModelGroups.map(group => group.model);
        const nextOrder = moveModelInOrder(orderedModels, visibleModels, model, direction);
        if (nextOrder === orderedModels) return;
        setGatewayModelOrder(nextOrder);
        try {
            await window.electronAPI.setConfig('settings.gatewayModelOrder', nextOrder);
        } catch (e: any) {
            setGatewayModelOrder(gatewayModelOrder);
            toast.error(e?.message || '保存排序失败');
        }
    }, [gatewayModelOrder, modelGroups, visibleModelGroups]);

    const familyCounts = useMemo(() => {
        const counts: Partial<Record<ModelFamily, number>> & { all: number } = { all: modelGroups.length };
        for (const g of modelGroups) {
            const f = detectFamily(g.model);
            counts[f] = (counts[f] || 0) + 1;
        }
        return counts;
    }, [modelGroups]);

    const visibleFamilies = useMemo(
        () => FAMILY_ORDER.filter(f => (familyCounts[f] || 0) > 0),
        [familyCounts]
    );

    const candidatesForAddModal = useMemo(() => {
        const target = addProviderModal.targetModel;
        if (!target) return [];
        return visibleProviders.filter(p => !hasModel(p.models, target));
    }, [visibleProviders, addProviderModal.targetModel]);

    useEffect(() => {
        if (activeFamily !== 'all' && !visibleFamilies.includes(activeFamily as ModelFamily)) {
            setActiveFamily('all');
        }
    }, [activeFamily, visibleFamilies]);

    const providersWithoutModels = useMemo(
        () => visibleProviders.filter(provider => normalizeModels(provider.models).length === 0),
        [visibleProviders]
    );

    return (
        <div className="space-y-3">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-[18px] font-normal tracking-[-0px] text-foreground">活跃网关</h2>
                    <p className="text-[13px] text-muted-foreground">
                        按模型分组选择全局代理节点，并对指定服务商与模型发送一次测试请求。
                    </p>
                </div>
                <Dialog.Root
                    open={promptModalOpen}
                    onOpenChange={open => {
                        setPromptModalOpen(open);
                        if (open) {
                            setDefaultPromptDraft(savedDefaultPrompt);
                        }
                    }}
                >
                    <Dialog.Trigger
                        render={
                            <button
                                type="button"
                                className="inline-flex h-9 items-center justify-center rounded-2xl border border-border/40 bg-muted/20 px-4 text-[13px] font-medium text-foreground shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all hover:bg-primary/10 hover:text-primary hover:border-primary/20 disabled:pointer-events-none disabled:opacity-50"
                            >
                                <Icon icon="ph:faders-bold" className="mr-2 h-4 w-4" />
                                默认测试语句
                            </button>
                        }
                    />
                    <Dialog.Portal>
                        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
                        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-border bg-background p-6 shadow-xl outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-all duration-200">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
                                    <Icon icon="ph:faders-bold" className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <Dialog.Title className="text-[18px] font-normal text-foreground">全局默认测试语句</Dialog.Title>
                                    <Dialog.Description className="mt-1 text-[13px] text-muted-foreground">
                                        行内测试语句为空时使用，可随时覆盖。
                                    </Dialog.Description>
                                </div>
                                <Dialog.Close
                                    render={
                                        <button
                                            type="button"
                                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                            aria-label="关闭"
                                        >
                                            <Icon icon="ph:x-bold" className="h-4 w-4" />
                                        </button>
                                    }
                                />
                            </div>
                            <label className="mt-5 block text-[11px] uppercase tracking-[1.4px] text-muted-foreground" htmlFor="default-test-prompt">
                                默认 Prompt
                            </label>
                            <textarea
                                id="default-test-prompt"
                                value={defaultPromptDraft}
                                onChange={event => setDefaultPromptDraft(event.target.value)}
                                className="mt-2 min-h-[120px] w-full resize-y rounded-[8px] border border-border/50 bg-muted/60 px-3 py-2 text-[14px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                                placeholder={DEFAULT_TEST_PROMPT}
                            />
                            <div className="mt-5 flex items-center justify-end gap-2">
                                <Dialog.Close
                                    render={
                                        <button
                                            type="button"
                                            className="inline-flex h-10 items-center justify-center rounded-[50px] border border-border bg-background px-4 text-[14px] font-medium text-foreground shadow-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                                        >
                                            取消
                                        </button>
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-10 rounded-[50px] border-border px-4 shadow-none hover:bg-accent"
                                    disabled={savingDefaultPrompt}
                                    onClick={saveDefaultPrompt}
                                >
                                    {savingDefaultPrompt ? <Icon icon="ph:spinner-gap-bold" className="mr-2 h-4 w-4 animate-spin" /> : <Icon icon="ph:check-bold" className="mr-2 h-4 w-4" />}
                                    保存默认语句
                                </Button>
                            </div>
                        </Dialog.Popup>
                    </Dialog.Portal>
                </Dialog.Root>
            </div>

            <Dialog.Root
                open={addProviderModal.open}
                onOpenChange={open => setAddProviderModal(prev => ({ open, targetModel: open ? prev.targetModel : null }))}
            >
                <Dialog.Portal>
                    <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
                    <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-border bg-background p-6 shadow-xl outline-none data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-all duration-200">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
                                <Icon icon="ph:plus-bold" className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <Dialog.Title className="text-[18px] font-normal text-foreground">
                                    添加服务商到 {addProviderModal.targetModel}
                                </Dialog.Title>
                                <Dialog.Description className="mt-1 text-[13px] text-muted-foreground">
                                    选择一个已启用服务商，并把当前模型加入它的模型列表。
                                </Dialog.Description>
                            </div>
                            <Dialog.Close
                                render={
                                    <button
                                        type="button"
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                        aria-label="关闭"
                                    >
                                        <Icon icon="ph:x-bold" className="h-4 w-4" />
                                    </button>
                                }
                            />
                        </div>
                        <div className="mt-5 space-y-2">
                            {candidatesForAddModal.length === 0 ? (
                                <div className="rounded-[10px] border border-border bg-muted/20 p-4 text-[13px] text-muted-foreground">
                                    所有启用的服务商已包含此模型。
                                </div>
                            ) : candidatesForAddModal.map(provider => (
                                <div key={provider.id} className="flex items-center gap-3 rounded-[10px] border border-border/50 bg-muted/10 p-3">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground shadow-inner ring-1 ring-border/50">
                                        <Icon icon="ph:hard-drives-bold" className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[14px] text-foreground">{provider.name}</div>
                                        <div className="truncate font-mono text-[11px] text-muted-foreground">{provider.baseUrl || '未配置代理地址'}</div>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-[50px] border-border px-3 text-[12px] shadow-none hover:bg-accent"
                                        disabled={!addProviderModal.targetModel}
                                        onClick={() => addProviderModal.targetModel && void addProviderToModel(provider, addProviderModal.targetModel)}
                                    >
                                        <Icon icon="ph:plus-bold" className="mr-1 h-3.5 w-3.5" /> 添加
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>

            {visibleProviders.length === 0 ? (
                <div className="rounded-[24px] border border-border/50 bg-gradient-to-b from-muted/20 to-transparent p-12 flex flex-col items-center justify-center text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <Icon icon="ph:hard-drives-bold" className="w-12 h-12 text-muted-foreground/30 mb-6 drop-shadow-md" />
                    <p className="text-[22px] font-medium text-foreground mb-3">暂无已启用服务商</p>
                    <p className="text-[15px] text-muted-foreground max-w-sm">请在左侧“服务商列表”中启用至少一个服务商，以便构建可用路由</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {modelGroups.length === 0 ? (
                        <div className="rounded-[12px] border border-border bg-transparent p-4 text-[13px] text-muted-foreground">
                            已启用服务商还没有模型分组。先在下方未分组服务商中添加模型。
                        </div>
                    ) : null}
                    {visibleFamilies.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setActiveFamily('all')}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-[50px] px-3 py-1 text-[12px] font-medium transition-all outline-none',
                                        activeFamily === 'all'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'border border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                                    )}
                                >
                                    全部
                                    <span className={cn(
                                        'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px]',
                                        activeFamily === 'all'
                                            ? 'bg-primary-foreground/20 text-primary-foreground'
                                            : 'bg-muted text-muted-foreground'
                                    )}>{familyCounts.all}</span>
                                </button>
                                {visibleFamilies.map((f) => {
                                    const isActive = activeFamily === f;
                                    return (
                                        <button
                                            key={f}
                                            type="button"
                                            onClick={() => setActiveFamily(f)}
                                            className={cn(
                                                'inline-flex items-center gap-1.5 rounded-[50px] px-3 py-1 text-[12px] font-medium transition-all outline-none',
                                                isActive
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'border border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                                            )}
                                        >
                                            {FAMILY_LABELS[f]}
                                            <span className={cn(
                                                'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold shadow-inner',
                                                isActive
                                                    ? 'bg-primary-foreground text-primary'
                                                    : 'bg-background/80 text-muted-foreground shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'
                                            )}>{familyCounts[f] || 0}</span>
                                        </button>
                                    );
                                })}
                        </div>
                    ) : null}
                    {visibleModelGroups.length === 0 && modelGroups.length > 0 ? (
                        <div className="rounded-[12px] border border-border bg-transparent p-4 text-[13px] text-muted-foreground">
                            当前分类下没有模型分组。
                        </div>
                    ) : null}
                    {visibleModelGroups.map((group, groupIndex) => {
                        const candidatesForGroup = visibleProviders.filter(provider => !hasModel(provider.models, group.model));
                        const isFirstGroup = groupIndex === 0;
                        const isLastGroup = groupIndex === visibleModelGroups.length - 1;

                        return (
                            <section key={group.model} className="group/group overflow-hidden rounded-[20px] border border-border/40 bg-gradient-to-br from-card/40 to-transparent p-1 transition-all duration-300 hover:border-primary/20 hover:shadow-[0_4px_30px_rgba(0,0,0,0.1)] backdrop-blur-md">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-4 pb-3 pt-3">
                                    <div className="flex min-w-0 flex-col items-start gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase tracking-[2px] text-muted-foreground/80 font-bold">Model Group</span>
                                            <span className="rounded-full border border-border/50 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground font-medium shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                                                {group.providers.length} 个服务商
                                            </span>
                                        </div>
                                        <h3 className="min-w-0 truncate font-mono text-[18px] font-medium text-foreground tracking-tight">{group.model}</h3>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-xl border-border/60 px-3 text-[12px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all opacity-0 group-hover/group:opacity-100"
                                            disabled={isFirstGroup}
                                            onClick={() => void moveModelGroup(group.model, 'top')}
                                        >
                                            <Icon icon="ph:caret-double-up-bold" className="mr-1.5 h-3.5 w-3.5" /> 置顶
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-xl border-border/60 px-3 text-[12px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all opacity-0 group-hover/group:opacity-100"
                                            disabled={isFirstGroup}
                                            onClick={() => void moveModelGroup(group.model, 'up')}
                                        >
                                            <Icon icon="ph:caret-up-bold" className="mr-1.5 h-3.5 w-3.5" /> 上移
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-xl border-border/60 px-3 text-[12px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all opacity-0 group-hover/group:opacity-100"
                                            disabled={isLastGroup}
                                            onClick={() => void moveModelGroup(group.model, 'down')}
                                        >
                                            <Icon icon="ph:caret-down-bold" className="mr-1.5 h-3.5 w-3.5" /> 下移
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-xl border-border/60 px-3.5 text-[12px] font-medium shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all"
                                            disabled={candidatesForGroup.length === 0}
                                            title={candidatesForGroup.length === 0 ? '所有启用的服务商已包含此模型' : undefined}
                                            onClick={() => setAddProviderModal({ open: true, targetModel: group.model })}
                                        >
                                            <Icon icon="ph:plus-bold" className="mr-1.5 h-3.5 w-3.5" /> 添加服务商
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-2 space-y-1">
                                    {group.providers.map((provider) => {
                                        const isActive = activeProviderId === provider.id && activeModelName === group.model;
                                        const isEditing = editingModel?.providerId === provider.id && editingModel.original === group.model;
                                        const testKey = createTestKey(provider.id, group.model);
                                        const expanded = expandedRows.has(testKey);
                                        const testState = testStates[testKey] || { status: 'idle' as const };
                                        const testPrompt = testPromptDrafts[testKey] || '';
                                        const testDisabledReason = !provider.baseUrl
                                            ? '未配置代理地址，无法发送测试。'
                                            : !group.model
                                                ? '模型名为空，无法发送测试。'
                                                : '';
                                        const disableTest = testState.status === 'loading' || Boolean(testDisabledReason);

                                        return (
                                            <Collapsible.Root
                                                key={provider.id}
                                                open={expanded}
                                                onOpenChange={open => toggleExpanded(testKey, open)}
                                            >
                                                <div className={cn(
                                                    'transition-all duration-300 rounded-[14px] overflow-hidden border',
                                                    isActive 
                                                        ? 'border-primary/30 bg-primary/5 shadow-[0_0_15px_rgba(var(--primary),0.05)]' 
                                                        : expanded
                                                            ? 'border-border/50 bg-muted/10'
                                                            : 'border-transparent hover:bg-muted/30 hover:border-border/30'
                                                )}>
                                                    <div className="flex items-center gap-3 px-3 py-3 relative">
                                                        {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]"></div>}
                                                        <Collapsible.Trigger
                                                            render={
                                                                <button
                                                                    type="button"
                                                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                                                    aria-label={expanded ? '收起详情' : '展开详情'}
                                                                >
                                                                    <Icon icon="ph:caret-down-bold" className={cn('h-4 w-4 transition-transform duration-300', expanded && 'rotate-180')} />
                                                                </button>
                                                            }
                                                        />
                                                        <div className={cn(
                                                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-inner ring-1 ring-border/30',
                                                                isActive ? 'bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.3)] ring-primary/50' : 'bg-muted text-muted-foreground'
                                                            )}>
                                                                <Icon icon="ph:hard-drives-bold" className="h-5 w-5" />
                                                            </div>
                                                        <div
                                                            className="min-w-0 flex-1 cursor-pointer"
                                                            onClick={() => toggleExpanded(testKey, !expanded)}
                                                        >
                                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                <h4 className="truncate text-[14px] font-normal text-foreground">{provider.name}</h4>
                                                                {isActive ? (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.3)]">
                                                                        <Icon icon="ph:check-circle-bold" className="h-3 w-3" /> 当前活动
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> 已启用
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                                                {provider.baseUrl || '未配置代理地址'}
                                                            </p>
                                                        </div>
                                                        {testState.status !== 'idle' ? (
                                                            <span className={cn(
                                                                'hidden shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] lg:inline-flex',
                                                                testState.status === 'success'
                                                                    ? 'bg-emerald-500/10 text-emerald-400'
                                                                    : testState.status === 'error'
                                                                        ? 'bg-destructive/10 text-destructive'
                                                                        : 'bg-muted text-muted-foreground'
                                                            )}>
                                                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                                                {testState.status === 'loading'
                                                                    ? '测试中'
                                                                    : testState.latencyMs !== undefined
                                                                        ? `${testState.latencyMs}ms`
                                                                        : testState.status === 'success'
                                                                            ? '成功'
                                                                            : '失败'}
                                                            </span>
                                                        ) : null}
                                                        <Button
                                                            type="button"
                                                            variant={isActive ? 'default' : 'outline'}
                                                            className={cn("h-9 shrink-0 rounded-xl px-4 text-[12px] font-medium transition-all", isActive ? "shadow-[0_0_15px_rgba(var(--primary),0.2)] bg-primary text-primary-foreground hover:bg-primary" : "shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border-border/60 hover:bg-primary/10 hover:text-primary hover:border-primary/20")}
                                                            onClick={() => handleSelectProvider(provider, group.model)}
                                                        >
                                                            {isActive ? <Icon icon="ph:check-circle-bold" className="mr-1.5 h-4 w-4" /> : <Icon icon="ph:check-bold" className="mr-1.5 h-4 w-4" />}
                                                            {isActive ? '当前使用' : '设为活动'}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="h-9 shrink-0 rounded-xl border-border/60 px-4 text-[12px] font-medium shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-accent/80 transition-all"
                                                            disabled={disableTest}
                                                            onClick={() => void sendTestRequest(provider, group.model)}
                                                        >
                                                            {testState.status === 'loading' ? <Icon icon="ph:spinner-gap-bold" className="mr-1.5 h-4 w-4 animate-spin" /> : <Icon icon="ph:paper-plane-right-bold" className="mr-1.5 h-4 w-4" />}
                                                            测试
                                                        </Button>
                                                    </div>
                                                    <Collapsible.Panel>
                                                        <div className="space-y-3 border-t border-border/30 px-3 pb-3 pt-3">
                                                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
                                                                <div>
                                                                    <label className="block text-[11px] uppercase tracking-[1.4px] text-muted-foreground" htmlFor={`test-prompt-${testKey}`}>
                                                                        本次测试语句
                                                                    </label>
                                                                    <Input
                                                                        id={`test-prompt-${testKey}`}
                                                                        value={testPrompt}
                                                                        onChange={event => setTestPromptDraft(testKey, event.target.value)}
                                                                        placeholder={savedDefaultPrompt || DEFAULT_TEST_PROMPT}
                                                                        className="mt-2 h-10 text-[13px] bg-muted/60 border-border/50 rounded-[8px]"
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <div className="mb-2 text-[11px] uppercase tracking-[1.4px] text-muted-foreground">模型维护</div>
                                                                    {isEditing ? (
                                                                        <div className="flex min-h-10 items-center gap-1 rounded-[8px] border border-border/70 bg-muted/80 px-1.5 py-1">
                                                                            <Input
                                                                                autoFocus
                                                                                value={editingModel.value}
                                                                                onChange={event => setEditingModel({ ...editingModel, value: event.target.value })}
                                                                                onKeyDown={onEditingModelKeyDown}
                                                                                onBlur={() => void commitEditModel(provider.id, group.model, editingModel.value)}
                                                                                className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 text-[13px] font-mono focus-visible:ring-0"
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onMouseDown={event => event.preventDefault()}
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    void commitEditModel(provider.id, group.model, editingModel.value);
                                                                                }}
                                                                                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                                                                                aria-label={`保存模型 ${group.model}`}
                                                                            >
                                                                                <Icon icon="ph:check-bold" className="w-4 h-4" />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onMouseDown={event => event.preventDefault()}
                                                                                onClick={cancelEditModel}
                                                                                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-destructive transition-colors"
                                                                                aria-label={`取消编辑模型 ${group.model}`}
                                                                            >
                                                                                <Icon icon="ph:x-bold" className="w-4 h-4" />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex min-h-10 items-center overflow-hidden rounded-[8px] border border-border/50 bg-muted/50 text-muted-foreground">
                                                                            <span className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-[13px]">{group.model}</span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(event) => startEditModel(event, provider.id, group.model)}
                                                                                className="flex h-10 w-10 items-center justify-center border-l border-border/40 transition-colors hover:text-foreground"
                                                                                aria-label={`编辑模型 ${group.model}`}
                                                                            >
                                                                                <Icon icon="ph:pencil-simple-bold" className="w-4 h-4" />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(event) => void removeModel(event, provider, group.model)}
                                                                                className="flex h-10 w-10 items-center justify-center border-l border-border/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                                                aria-label={`删除模型 ${group.model}`}
                                                                            >
                                                                                <Icon icon="ph:x-bold" className="w-4 h-4" />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            <div className="flex flex-col gap-2 md:flex-row">
                                                                <Input
                                                                    value={modelDrafts[provider.id] || ''}
                                                                    onChange={event => setModelDraft(provider.id, event.target.value)}
                                                                    onKeyDown={event => onModelDraftKeyDown(event, provider.id)}
                                                                    placeholder="为该服务商添加更多模型，可用逗号或换行一次添加多个"
                                                                    className="h-10 flex-1 text-[13px] font-mono bg-muted/60 border-border/50 rounded-[8px]"
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    className="h-10 shrink-0 px-5 border-border/60 rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-medium"
                                                                    onClick={() => addModels(provider.id)}
                                                                >
                                                                    <Icon icon="ph:plus-bold" className="w-3.5 h-3.5 mr-1" /> 添加模型
                                                                </Button>
                                                            </div>

                                                            {testState.status !== 'idle' ? (
                                                                <div
                                                                    className={cn(
                                                                        'rounded-[8px] border px-3 py-2 text-[13px] leading-relaxed',
                                                                        testState.status === 'success'
                                                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                                                            : testState.status === 'error'
                                                                                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                                                                : 'border-border/50 bg-muted/30 text-muted-foreground'
                                                                    )}
                                                                >
                                                                    {testState.status === 'loading' ? '正在发送测试请求…' : testState.message}
                                                                    {testState.latencyMs !== undefined ? (
                                                                        <span className="ml-2 font-mono text-[12px] opacity-75">{testState.latencyMs}ms</span>
                                                                    ) : null}
                                                                </div>
                                                            ) : testDisabledReason ? (
                                                                <div className="rounded-[8px] border border-border/50 bg-muted/20 px-3 py-2 text-[13px] text-muted-foreground">
                                                                    {testDisabledReason}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        </div>
                                                    </Collapsible.Panel>
                                                </div>
                                            </Collapsible.Root>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}

                    {providersWithoutModels.length > 0 ? (
                        <section className="rounded-[12px] border border-border bg-transparent p-5">
                            <div className="mb-4">
                                <span className="text-[11px] uppercase tracking-[1.4px] text-muted-foreground">未分组服务商</span>
                                <h3 className="mt-1 text-[18px] font-normal text-foreground">缺少模型配置</h3>
                            </div>
                            <div className="space-y-3">
                                {providersWithoutModels.map(provider => (
                                    <div key={provider.id} className="rounded-[10px] border border-border/50 bg-muted/10 p-4">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[16px] text-foreground">{provider.name}</p>
                                                <p className="mt-1 font-mono text-[12px] text-muted-foreground">{provider.baseUrl || '未配置代理地址'}</p>
                                            </div>
                                            <span className="rounded-[50px] bg-muted/60 px-3 py-1 text-[12px] text-muted-foreground">暂无模型</span>
                                        </div>
                                        <div className="flex flex-col gap-2 md:flex-row">
                                            <Input
                                                value={modelDrafts[provider.id] || ''}
                                                onChange={event => setModelDraft(provider.id, event.target.value)}
                                                onKeyDown={event => onModelDraftKeyDown(event, provider.id)}
                                                placeholder="添加模型，可用逗号或换行一次添加多个"
                                                className="h-10 flex-1 text-[13px] font-mono bg-muted/60 border-border/50 rounded-[8px]"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-10 shrink-0 px-4 border-border rounded-[50px] shadow-none hover:bg-accent"
                                                onClick={() => addModels(provider.id)}
                                            >
                                                <Icon icon="ph:plus-bold" className="w-3.5 h-3.5 mr-1" /> 添加模型
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            )}
        </div>
    );
}

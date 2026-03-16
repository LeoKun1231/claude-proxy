import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Plus, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import type { CustomProviderData, ModelRoute } from '../types/config';

type SelectOption = { value: string; label: string };

function parseFallbackTarget(target: string) {
    if (!target || target === 'pass') return { providerId: '', targetModel: '' };
    const idx = target.indexOf(':');
    if (idx === -1) return { providerId: '', targetModel: '' };
    return { providerId: target.slice(0, idx), targetModel: target.slice(idx + 1) };
}

function formatFallbackTarget(pid: string, model: string) {
    if (!pid || !model) return 'pass';
    return `${pid}:${model}`;
}

export default function ModelMapping({ onMappingChange }: { onMappingChange?: () => void }) {
    const [fallbackTarget, setFallbackTarget] = useState('pass');
    const [routes, setRoutes] = useState<ModelRoute[]>([]);
    const [customProviders, setCustomProviders] = useState<CustomProviderData[]>([]);
    const [globalModels, setGlobalModels] = useState<string[]>([]);
    const [globalModelInput, setGlobalModelInput] = useState('');
    const [fbProvider, setFbProvider] = useState('none');
    const [fbModel, setFbModel] = useState('none');
    const [loading, setLoading] = useState(false);

    const fallbackProviderItems = useMemo<SelectOption[]>(
        () => [
            { value: 'none', label: '透传 (不拦截)' },
            ...customProviders.map((provider) => ({ value: provider.id, label: provider.name }))
        ],
        [customProviders]
    );

    const fallbackModelItems = useMemo<SelectOption[]>(
        () => [
            { value: 'none', label: '—' },
            ...globalModels.map((model) => ({ value: model, label: model }))
        ],
        [globalModels]
    );

    const loadData = useCallback(async () => {
        try {
            if (!window.electronAPI) return;
            const [main, allConfig] = await Promise.all([
                window.electronAPI.getMapping('main'),
                window.electronAPI.getAllConfig()
            ]);
            const parsed = parseFallbackTarget(main);
            setFallbackTarget(main);
            setFbProvider(parsed.providerId || 'none');
            setFbModel(parsed.targetModel || 'none');
            setRoutes(Array.isArray(allConfig.modelRoutes) ? allConfig.modelRoutes : []);
            setCustomProviders(Array.isArray(allConfig.providers?.customProviders) ? allConfig.providers.customProviders : []);
            setGlobalModels(Array.isArray(allConfig.globalModels) ? allConfig.globalModels : []);
        } catch { toast.error('加载失败'); }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const saveFallback = async () => {
        const target = formatFallbackTarget(fbProvider === 'none' ? '' : fbProvider, fbModel === 'none' ? '' : fbModel);
        setLoading(true);
        try {
            await window.electronAPI.setMapping('main', target);
            await window.electronAPI.setMapping('haiku', target);
            setFallbackTarget(target);
            toast.success(target === 'pass' ? '回退策略已清除' : '回退策略已保存');
            onMappingChange?.();
        } catch (e: any) { toast.error(e?.message || '发生错误'); }
        finally { setLoading(false); }
    };

    const saveGlobalModels = async (next: string[], msg: string) => {
        try {
            await window.electronAPI.setConfig('globalModels', next);
            setGlobalModels(next);
            toast.success(msg);
        } catch (e: any) { toast.error(e?.message || '发生错误'); }
    };

    const addModel = async () => {
        const v = globalModelInput.trim();
        if (!v) return;
        if (globalModels.includes(v)) return toast.info('已存在该模型');
        setGlobalModelInput('');
        await saveGlobalModels([...globalModels, v], '模型已添加');
    };

    return (
        <div className="space-y-8">
            {/* Global Models */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold">全局模型池</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">定义可在路由规则中使用的目标模型标识符</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={loadData}>
                        <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                </div>

                {globalModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {globalModels.map(m => (
                            <Badge key={m} variant="secondary" className="gap-1 pr-1 font-mono text-xs">
                                {m}
                                <button onClick={() => saveGlobalModels(globalModels.filter(x => x !== m), '已移除')} className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 cursor-pointer">
                                    <X className="w-3 h-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}

                <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <Input
                        value={globalModelInput}
                        onChange={e => setGlobalModelInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addModel()}
                        placeholder="例如: claude-3-5-sonnet-20241022"
                        className="h-8 flex-1 text-sm font-mono"
                    />
                    <Button size="sm" variant="outline" onClick={addModel} className="h-8 shrink-0">
                        <Plus className="w-3.5 h-3.5 mr-1" /> 添加
                    </Button>
                </div>
            </section>

            <Separator />

            {/* Default Fallback */}
            <section className="space-y-4">
                <div>
                    <h3 className="text-sm font-semibold">默认回退策略</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">当没有任何路由规则匹配时应用的策略</p>
                </div>

                {fallbackTarget !== 'pass' && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">当前策略:</span>
                        <Badge variant="outline" className="font-mono">{fallbackTarget}</Badge>
                    </div>
                )}

                <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">服务商</label>
                        <Select
                            items={fallbackProviderItems}
                            value={fbProvider}
                            onValueChange={v => setFbProvider(v || 'none')}
                        >
                            <SelectTrigger className="h-8 w-full text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">透传 (不拦截)</SelectItem>
                                {customProviders.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">模型</label>
                        <Select
                            items={fallbackModelItems}
                            value={fbModel}
                            onValueChange={v => setFbModel(v || 'none')}
                        >
                            <SelectTrigger className="h-8 w-full text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">—</SelectItem>
                                {globalModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button size="sm" onClick={saveFallback} disabled={loading}>
                        保存回退策略
                    </Button>
                    {fallbackTarget !== 'pass' && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                            setFbProvider('none');
                            setFbModel('none');
                            await window.electronAPI.setMapping('main', 'pass');
                            await window.electronAPI.setMapping('haiku', 'pass');
                            setFallbackTarget('pass');
                            toast.success('回退策略已清除');
                        }}>
                            清除
                        </Button>
                    )}
                </div>
            </section>
        </div>
    );
}

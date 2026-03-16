import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

interface CustomProvider {
    id: string;
    name: string;
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl: string;
}

export default function ProviderConfig() {
    const [providers, setProviders] = useState<CustomProvider[]>([]);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        (async () => {
            if (!window.electronAPI) return;
            const cfg = await window.electronAPI.getAllConfig();
            setProviders(cfg.providers?.customProviders || []);
        })();
    }, []);

    const queueSave = (next: CustomProvider[]) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(async () => {
            try { await window.electronAPI?.setConfig('providers.customProviders', next); }
            catch (e: any) { toast.error(e?.message || '保存失败'); }
        }, 400);
    };

    const add = () => {
        const p: CustomProvider = {
            id: `custom_${Date.now()}`, name: '', enabled: true,
            apiKey: '', models: [], baseUrl: ''
        };
        const next = [...providers, p];
        setProviders(next);
        queueSave(next);
    };

    const set = (id: string, field: keyof CustomProvider, val: any) => {
        setProviders(prev => {
            const next = prev.map(p => p.id === id ? { ...p, [field]: val } : p);
            queueSave(next);
            return next;
        });
    };

    const del = (id: string) => {
        const next = providers.filter(p => p.id !== id);
        setProviders(next);
        queueSave(next);
        toast.success('服务商已移除');
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">自定义服务商</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">用于模型路由的后端 API 服务连接</p>
                </div>
                <Button size="sm" variant="outline" onClick={add}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> 添加
                </Button>
            </div>

            {providers.length === 0 ? (
                <div className="border border-dashed rounded-lg py-10 flex flex-col items-center text-muted-foreground text-sm">
                    <p>尚未配置服务商</p>
                    <Button size="sm" variant="link" onClick={add} className="mt-1 cursor-pointer">添加第一个服务商</Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {providers.map(p => (
                        <div key={p.id} className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <Switch checked={p.enabled} onCheckedChange={c => set(p.id, 'enabled', c)} />
                                <Input
                                    value={p.name}
                                    onChange={e => set(p.id, 'name', e.target.value)}
                                    placeholder="服务商名称"
                                    className="h-8 text-sm font-semibold flex-1 border-transparent bg-transparent px-1 focus-visible:bg-muted focus-visible:border-border"
                                />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => del(p.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">基础 API 地址</label>
                                    <Input value={p.baseUrl} onChange={e => set(p.id, 'baseUrl', e.target.value)} placeholder="https://api.example.com" className="h-8 text-sm font-mono" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">API 密钥</label>
                                    <Input type="password" value={p.apiKey} onChange={e => set(p.id, 'apiKey', e.target.value)} placeholder="sk-..." className="h-8 text-sm font-mono" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

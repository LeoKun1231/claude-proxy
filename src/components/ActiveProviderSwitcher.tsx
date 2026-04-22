import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Server, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { AppConfig, CustomProviderData, ModelRoute } from '../types/config';

export default function ActiveProviderSwitcher() {
    const [providers, setProviders] = useState<CustomProviderData[]>([]);
    const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
    const [activeModelName, setActiveModelName] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        if (!window.electronAPI) return;
        const cfg = await window.electronAPI.getAllConfig();
        
        const customProviders = Array.isArray(cfg.providers?.customProviders) 
            ? cfg.providers.customProviders 
            : [];
        setProviders(customProviders);

        // Determine active provider and model from modelRoutes
        const routes = Array.isArray(cfg.modelRoutes) ? cfg.modelRoutes : [];
        if (routes.length === 1 && routes[0].sourceModel === '*') {
            setActiveProviderId(routes[0].providerId);
            setActiveModelName(routes[0].targetModel || null);
        } else if (customProviders.length === 1 && routes.length === 0) {
            handleSelectProvider(customProviders[0]);
        } else if (routes.length === 0) {
            setActiveProviderId(null);
            setActiveModelName(null);
        } else {
            const p = routes.find(r => r.enabled)?.providerId;
            if (p) {
                setActiveProviderId(p);
                setActiveModelName(routes.find(r => r.enabled)?.targetModel || null);
            }
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

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

    const handleSelectProvider = async (provider: CustomProviderData, modelName?: string) => {
        try {
            // Replace all complex routing with a single catch-all route to the selected provider
            const catchAllRoute: ModelRoute = {
                id: `route_catchall_${Date.now()}`,
                enabled: true,
                sourceModel: '*',
                targetModel: modelName || '', // specific model or passthrough
                providerId: provider.id,
                providerLabel: provider.name,
                baseUrl: provider.baseUrl,
                apiKey: provider.apiKey || '',
            };

            await window.electronAPI.setConfig('modelRoutes', [catchAllRoute]);
            setActiveProviderId(provider.id);
            setActiveModelName(modelName || null);
            toast.success(`已切换至: ${provider.name}${modelName ? ` (${modelName})` : ''}`);
        } catch (e: any) {
            toast.error(e?.message || '切换失败');
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[24px] font-normal tracking-[-0px] text-foreground">活跃网关</h2>
                <p className="text-[18px] text-muted-foreground mt-1 leading-relaxed">
                    点击下方卡片即可将所有请求路由到指定服务商，抛弃繁杂的细粒度路由规则。
                </p>
            </div>

            {providers.length === 0 ? (
                <div className="rounded-[12px] border border-[rgba(226,226,226,0.35)] bg-transparent p-10 flex flex-col items-center justify-center text-center">
                    <Server className="w-8 h-8 text-muted-foreground/50 mb-4" />
                    <p className="text-[20px] font-normal text-foreground mb-2">尚未配置任何服务商</p>
                    <p className="text-[14px] text-muted-foreground">请在左侧"服务商列表"中录入 API 地址及鉴权信息</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {providers.map(provider => {
                        const isActive = activeProviderId === provider.id;
                        
                        return (
                            <div
                                key={provider.id}
                                onClick={() => handleSelectProvider(provider)}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                    "relative flex flex-col text-left p-6 rounded-[12px] border transition-all duration-300 outline-none overflow-hidden group h-full cursor-pointer",
                                    isActive
                                        ? "border-[rgba(226,226,226,0.6)] bg-[rgba(255,255,255,0.04)]"
                                        : "border-[rgba(226,226,226,0.35)] bg-transparent hover:bg-[rgba(255,255,255,0.02)]"
                                )}
                            >
                                <div className="flex items-start justify-between w-full mb-5 relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "flex items-center justify-center w-12 h-12 rounded-[8px] transition-colors",
                                            isActive ? "bg-primary text-primary-foreground" : "bg-[#353534] text-muted-foreground"
                                        )}>
                                            <Server className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className={cn(
                                                "font-normal text-[22px] tracking-tight transition-colors leading-none",
                                                isActive ? "text-foreground" : "text-muted-foreground"
                                            )}>
                                                {provider.name}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={cn(
                                                    "w-2 h-2 rounded-full",
                                                    provider.enabled ? "bg-emerald-500" : "bg-muted-foreground"
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

                                    {provider.models?.length > 0 ? (
                                        <div 
                                            className="pt-4 border-t border-[rgba(226,226,226,0.15)]"
                                            onClick={(e) => e.stopPropagation()} 
                                        >
                                            <span className="text-muted-foreground text-[11px] uppercase tracking-[1.4px] block mb-3">强制路由至模型 (点击选择):</span>
                                            <div className="flex flex-wrap gap-2">
                                                {provider.models.map(model => {
                                                    const isModelActive = isActive && activeModelName === model;
                                                    return (
                                                        <button
                                                            key={model}
                                                            onClick={() => handleSelectProvider(provider, model)}
                                                            className={cn(
                                                                "text-[14px] font-mono px-3 py-1.5 rounded-[6px] border transition-all relative font-medium",
                                                                isModelActive 
                                                                 ? "bg-primary border-primary text-primary-foreground" 
                                                                 : "bg-[#353534]/30 border-[rgba(226,226,226,0.15)] text-muted-foreground hover:bg-[#353534]"
                                                            )}
                                                        >
                                                            {model}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3 text-[14px] pt-4 border-t border-[rgba(226,226,226,0.15)]">
                                            <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-[1.4px] text-[11px]">支持模型</span>
                                            <span className="text-muted-foreground font-mono truncate flex-1">
                                                全局匹配通配符 (未定义具体模型)
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

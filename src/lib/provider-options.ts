import type { AppConfig, ProviderConfigData } from '@/types/config';

export type ProviderOption = {
    id: string;
    label: string;
    models: string[];
    enabled: boolean;
};

const BUILTIN_PROVIDER_META = [
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'glm', label: 'GLM' },
    { id: 'kimi', label: 'Kimi' },
    { id: 'minimax', label: 'MiniMax' },
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'litellm', label: 'LiteLLM' },
    { id: 'cliproxyapi', label: 'CLI Proxy API' },
] as const;

export function normalizeModels(models: string[] | undefined) {
    const unique = new Set<string>();
    return (models || [])
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
            if (unique.has(item)) return false;
            unique.add(item);
            return true;
        });
}

export function buildProviderOptions(config: AppConfig): ProviderOption[] {
    const builtinOptions = BUILTIN_PROVIDER_META.map(({ id, label }) => {
        const provider = (config.providers as Record<string, ProviderConfigData | undefined>)[id];
        return {
            id,
            label,
            models: normalizeModels(provider?.models),
            enabled: Boolean(provider?.enabled),
        };
    }).filter((item) => item.enabled || item.models.length > 0);

    const customOptions = (config.providers.customProviders || []).map((provider) => ({
        id: provider.id,
        label: provider.name || provider.id,
        models: normalizeModels(provider.models),
        enabled: provider.enabled,
    }));

    return [...builtinOptions, ...customOptions];
}

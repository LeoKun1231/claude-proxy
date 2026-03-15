export type LegacyMappingType = 'main' | 'haiku';

export interface ProviderConfigData {
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl?: string;
    binPath?: string;
    port?: number;
    configPath?: string;
}

export interface CustomProviderData extends ProviderConfigData {
    id: string;
    name: string;
    baseUrl: string;
}

export interface ModelRoute {
    id: string;
    enabled: boolean;
    sourceModel: string;
    targetModel: string;
    providerId: string;
    providerLabel: string;
    baseUrl: string;
    apiKey: string;
}

export interface AppConfig {
    configVersion: number;
    mapping: Record<LegacyMappingType, string>;
    globalModels: string[];
    modelRoutes: ModelRoute[];
    providers: Record<string, ProviderConfigData> & {
        customProviders: CustomProviderData[];
    };
    settings: {
        autoLaunch: boolean;
    };
}

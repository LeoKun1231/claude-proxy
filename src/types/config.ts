export type LegacyMappingType = 'main' | 'haiku';
export const DEFAULT_PROXY_PORT = 5055;

export type RouterCategoryKey =
    | 'default'
    | 'background'
    | 'think'
    | 'longContext'
    | 'webSearch'
    | 'image';

export interface ProviderConfigData {
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl?: string;
    binPath?: string;
    port?: number;
    configPath?: string;
    stripFields?: string[];
}

export interface CustomHeader {
    name: string;
    value: string;
}

export interface CustomProviderData extends ProviderConfigData {
    id: string;
    name: string;
    baseUrl: string;
    customHeaders?: CustomHeader[];
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

export interface RouterTarget {
    enabled: boolean;
    providerId: string;
    providerLabel: string;
    targetModel: string;
}

export interface RouterConfig {
    default: RouterTarget;
    background: RouterTarget;
    think: RouterTarget;
    longContext: RouterTarget;
    longContextThreshold: number;
    webSearch: RouterTarget;
    image: RouterTarget;
}

export const DEFAULT_LONG_CONTEXT_THRESHOLD = 60_000;

export function createEmptyRouterTarget(): RouterTarget {
    return {
        enabled: false,
        providerId: '',
        providerLabel: '',
        targetModel: '',
    };
}

export function createDefaultRouterConfig(): RouterConfig {
    return {
        default: createEmptyRouterTarget(),
        background: createEmptyRouterTarget(),
        think: createEmptyRouterTarget(),
        longContext: createEmptyRouterTarget(),
        longContextThreshold: DEFAULT_LONG_CONTEXT_THRESHOLD,
        webSearch: createEmptyRouterTarget(),
        image: createEmptyRouterTarget(),
    };
}

export type RoutingMode = 'gateway' | 'routes';

export interface AppConfig {
    configVersion: number;
    mapping: Record<LegacyMappingType, string>;
    router: RouterConfig;
    routingMode: RoutingMode;
    globalModels: string[];
    modelRoutes: ModelRoute[];
    providers: Record<string, ProviderConfigData> & {
        customProviders: CustomProviderData[];
    };
    settings: {
        autoLaunch: boolean;
        proxyPort: number;
    };
}

export type LegacyMappingType = 'main' | 'haiku';
export const DEFAULT_PROXY_PORT = 5055;
export const LEGACY_DEFAULT_TEST_PROMPT = '请用一句话回复“测试成功”。';
export const DEFAULT_TEST_PROMPT = '今天星期几？';

export function normalizeDefaultTestPrompt(value: unknown) {
    const prompt = typeof value === 'string' ? value.trim() : '';
    if (!prompt || prompt === LEGACY_DEFAULT_TEST_PROMPT) return DEFAULT_TEST_PROMPT;
    return prompt;
}

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

export interface TestProviderModelRequest {
    providerId: string;
    model: string;
    prompt: string;
}

export interface TestProviderModelResponse {
    ok: boolean;
    providerId: string;
    providerLabel: string;
    model: string;
    latencyMs: number;
    output?: string;
    error?: string;
    statusCode?: number;
}

export interface FetchProviderModelsRequest {
    providerId: string;
}

export interface FetchProviderModelsResponse {
    ok: boolean;
    providerId: string;
    providerLabel: string;
    models: string[];
    latencyMs: number;
    error?: string;
    statusCode?: number;
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
        theme: 'light' | 'dark';
        defaultTestPrompt: string;
        gatewayModelOrder: string[];
    };
}

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(DATA_DIR, 'config.json');
const CURRENT_CONFIG_VERSION = 3;
const BUILTIN_PROVIDER_KEYS = ['anthropic', 'glm', 'kimi', 'minimax', 'deepseek', 'litellm', 'cliproxyapi'];

const DEFAULT_CONFIG = {
    configVersion: CURRENT_CONFIG_VERSION,
    mapping: {
        main: 'pass',
        haiku: 'pass',
    },
    globalModels: [],
    modelRoutes: [],
    providers: {
        anthropic: { enabled: false, apiKey: '', models: [] },
        glm: { enabled: false, apiKey: '', models: [] },
        kimi: { enabled: false, apiKey: '', models: [] },
        minimax: { enabled: false, apiKey: '', models: [] },
        deepseek: { enabled: false, apiKey: '', models: [] },
        litellm: { enabled: false, apiKey: '', models: [] },
        cliproxyapi: { enabled: false, apiKey: '', models: [] },
        customProviders: [],
    },
    settings: {
        autoLaunch: true,
    },
};

function ensureConfigFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    }
}

function deepClone(data) {
    return JSON.parse(JSON.stringify(data));
}

function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') {
        return base;
    }

    for (const key of Object.keys(extra)) {
        const extraValue = extra[key];
        const baseValue = base[key];

        if (Array.isArray(extraValue)) {
            base[key] = extraValue;
            continue;
        }

        if (extraValue && typeof extraValue === 'object') {
            const nextBase = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
                ? baseValue
                : {};
            base[key] = deepMerge(nextBase, extraValue);
            continue;
        }

        base[key] = extraValue;
    }

    return base;
}

function normalizeString(value, fallback = '') {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (value == null) {
        return fallback;
    }

    return String(value).trim();
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))];
}

function normalizeProviderConfig(value) {
    const provider = value && typeof value === 'object' ? value : {};
    const normalized = {
        enabled: Boolean(provider.enabled),
        apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
        models: normalizeStringArray(provider.models),
    };

    if (provider.baseUrl != null) {
        normalized.baseUrl = normalizeString(provider.baseUrl);
    }

    if (provider.binPath != null) {
        normalized.binPath = normalizeString(provider.binPath);
    }

    if (provider.configPath != null) {
        normalized.configPath = normalizeString(provider.configPath);
    }

    if (provider.port != null && provider.port !== '') {
        const parsedPort = Number(provider.port);
        if (Number.isFinite(parsedPort) && parsedPort > 0) {
            normalized.port = Math.floor(parsedPort);
        }
    }

    return normalized;
}

function normalizeCustomProvider(value, index) {
    const provider = normalizeProviderConfig(value);
    return {
        id: normalizeString(value?.id, `custom_${index + 1}`),
        name: normalizeString(value?.name, `自定义 ${index + 1}`),
        ...provider,
        baseUrl: normalizeString(value?.baseUrl),
    };
}

function normalizeModelRoute(value, index) {
    const route = value && typeof value === 'object' ? value : {};
    return {
        id: normalizeString(route.id, `route_${index + 1}`),
        enabled: route.enabled !== false,
        sourceModel: normalizeString(route.sourceModel),
        targetModel: normalizeString(route.targetModel),
        providerId: normalizeString(route.providerId),
        providerLabel: normalizeString(route.providerLabel),
        baseUrl: normalizeString(route.baseUrl),
        apiKey: typeof route.apiKey === 'string' ? route.apiKey : '',
    };
}

function extractModelFromMappingTarget(value) {
    const normalized = normalizeString(value);
    if (!normalized || normalized === 'pass') {
        return '';
    }

    const separatorIndex = normalized.indexOf(':');
    if (separatorIndex === -1) {
        return '';
    }

    return normalizeString(normalized.slice(separatorIndex + 1));
}

function collectGlobalModels(globalModels, modelRoutes, providers, mapping) {
    const collected = normalizeStringArray(globalModels);

    const addModel = (value) => {
        const normalized = normalizeString(value);
        if (!normalized || collected.includes(normalized)) {
            return;
        }
        collected.push(normalized);
    };

    addModel(extractModelFromMappingTarget(mapping?.main));
    addModel(extractModelFromMappingTarget(mapping?.haiku));

    if (Array.isArray(modelRoutes)) {
        modelRoutes.forEach((route) => {
            addModel(route?.sourceModel);
            addModel(route?.targetModel);
        });
    }

    BUILTIN_PROVIDER_KEYS.forEach((providerKey) => {
        const provider = providers[providerKey];
        if (provider && Array.isArray(provider.models)) {
            provider.models.forEach(addModel);
        }
    });

    const customProviders = Array.isArray(providers.customProviders)
        ? providers.customProviders
        : [];

    customProviders.forEach((provider) => {
        if (provider && Array.isArray(provider.models)) {
            provider.models.forEach(addModel);
        }
    });

    return collected;
}

function normalizeConfig(config) {
    const merged = deepMerge(deepClone(DEFAULT_CONFIG), config && typeof config === 'object' ? config : {});
    const providers = merged.providers && typeof merged.providers === 'object' ? merged.providers : {};
    const normalizedProviders = {};

    BUILTIN_PROVIDER_KEYS.forEach((providerKey) => {
        normalizedProviders[providerKey] = normalizeProviderConfig(providers[providerKey]);
    });

    normalizedProviders.customProviders = Array.isArray(providers.customProviders)
        ? providers.customProviders.map((provider, index) => normalizeCustomProvider(provider, index))
        : [];

    const normalizedMapping = {
        main: normalizeString(merged.mapping?.main, 'pass') || 'pass',
        haiku: normalizeString(merged.mapping?.haiku, 'pass') || 'pass',
    };
    const normalizedModelRoutes = Array.isArray(merged.modelRoutes)
        ? merged.modelRoutes.map((route, index) => normalizeModelRoute(route, index))
        : [];

    return {
        configVersion: CURRENT_CONFIG_VERSION,
        mapping: normalizedMapping,
        globalModels: collectGlobalModels(
            merged.globalModels,
            normalizedModelRoutes,
            normalizedProviders,
            normalizedMapping
        ),
        modelRoutes: normalizedModelRoutes,
        providers: normalizedProviders,
        settings: {
            autoLaunch: merged.settings?.autoLaunch !== false,
        },
    };
}

function readConfig() {
    ensureConfigFile();

    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeConfig(parsed);
    } catch (error) {
        return deepClone(DEFAULT_CONFIG);
    }
}

function writeConfig(config) {
    ensureConfigFile();
    const nextConfig = normalizeConfig(config);
    const tempFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(nextConfig, null, 2), 'utf8');
    fs.renameSync(tempFile, CONFIG_FILE);
    return nextConfig;
}

function getByPath(data, key) {
    if (!key) {
        return data;
    }

    return key.split('.').reduce((current, segment) => {
        if (current == null) {
            return undefined;
        }
        return current[segment];
    }, data);
}

function setByPath(data, key, value) {
    const segments = key.split('.');
    const last = segments.pop();
    if (!last) {
        return;
    }

    let current = data;
    for (const segment of segments) {
        if (!current[segment] || typeof current[segment] !== 'object') {
            current[segment] = {};
        }
        current = current[segment];
    }

    current[last] = value;
}

module.exports = {
    CURRENT_CONFIG_VERSION,
    CONFIG_FILE,
    readConfig,
    writeConfig,
    getByPath,
    setByPath,
};

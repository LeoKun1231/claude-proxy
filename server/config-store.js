const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
    mapping: {
        main: 'pass',
        haiku: 'pass',
    },
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

function readConfig() {
    ensureConfigFile();

    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return deepMerge(deepClone(DEFAULT_CONFIG), parsed);
    } catch (error) {
        return deepClone(DEFAULT_CONFIG);
    }
}

function writeConfig(config) {
    ensureConfigFile();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
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
    CONFIG_FILE,
    readConfig,
    writeConfig,
    getByPath,
    setByPath,
};

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const {
    readConfig,
    writeConfig,
    getByPath,
    setByPath,
} = require('./config-store');
const {
    setConfigProvider,
    startProxyServer,
    stopProxyServer,
    getProxyStatus,
} = require('./proxy-server');

const WEB_PORT = Number(process.env.WEB_PORT || 5056);
const PROXY_PORT = Number(process.env.PROXY_PORT || 5055);
const AUTO_START_PROXY = String(process.env.AUTO_START_PROXY || '').toLowerCase() === 'true';

const app = express();
const events = new EventEmitter();

let appConfig = readConfig();
setConfigProvider(() => appConfig);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function emitEvent(type, payload) {
    events.emit('event', { type, payload });
}

function persistConfig(nextConfig) {
    appConfig = writeConfig(nextConfig);
}

function sendProxyLog(log) {
    emitEvent('proxy-log', log);
}

function addTarget(targets, target) {
    const normalized = String(target || '').trim();
    if (!normalized || targets.includes(normalized)) {
        return;
    }

    targets.push(normalized);
}

function getAvailableTargets(config) {
    const targets = ['pass'];
    const providers = config.providers || {};
    const modelRoutes = Array.isArray(config.modelRoutes) ? config.modelRoutes : [];

    modelRoutes.forEach((route) => {
        if (!route || route.enabled === false) {
            return;
        }

        if (!route.providerId || !route.targetModel) {
            return;
        }

        addTarget(targets, `${route.providerId}:${route.targetModel}`);
    });

    addTarget(targets, config.mapping?.main);
    addTarget(targets, config.mapping?.haiku);

    Object.keys(providers).forEach((key) => {
        if (key === 'customProviders') {
            return;
        }

        const provider = providers[key];
        if (provider && provider.enabled && Array.isArray(provider.models)) {
            provider.models.forEach((model) => {
                addTarget(targets, `${key}:${model}`);
            });
        }
    });

    const customProviders = Array.isArray(providers.customProviders)
        ? providers.customProviders
        : [];

    customProviders.forEach((provider) => {
        if (provider && provider.enabled && Array.isArray(provider.models)) {
            provider.models.forEach((model) => {
                addTarget(targets, `${provider.id}:${model}`);
            });
        }
    });

    return targets;
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 25000);

    const handleEvent = ({ type, payload }) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    events.on('event', handleEvent);

    req.on('close', () => {
        clearInterval(keepAlive);
        events.off('event', handleEvent);
    });
});

app.get('/api/config', (req, res) => {
    const key = String(req.query.key || '');
    const value = getByPath(appConfig, key);
    res.json(value ?? null);
});

app.post('/api/config', (req, res) => {
    const { key, value } = req.body || {};
    if (!key || typeof key !== 'string') {
        res.status(400).json({ success: false, error: 'key 必填' });
        return;
    }

    const nextConfig = JSON.parse(JSON.stringify(appConfig));
    setByPath(nextConfig, key, value);
    persistConfig(nextConfig);

    emitEvent('config-updated', { key, updatedAt: Date.now() });
    res.json({ success: true });
});

app.get('/api/config/all', (_req, res) => {
    res.json(appConfig);
});

app.get('/api/auto-launch', (_req, res) => {
    res.json(Boolean(appConfig.settings?.autoLaunch));
});

app.post('/api/auto-launch', (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const nextConfig = JSON.parse(JSON.stringify(appConfig));
    if (!nextConfig.settings || typeof nextConfig.settings !== 'object') {
        nextConfig.settings = {};
    }
    nextConfig.settings.autoLaunch = enabled;
    persistConfig(nextConfig);

    emitEvent('config-updated', { key: 'settings.autoLaunch', updatedAt: Date.now() });
    res.json({ success: true });
});

app.get('/api/mapping/:type', (req, res) => {
    const type = req.params.type;
    const value = getByPath(appConfig, `mapping.${type}`) || 'pass';
    res.json(value);
});

app.post('/api/mapping/:type', (req, res) => {
    const type = req.params.type;
    const value = String(req.body?.value || 'pass');

    const nextConfig = JSON.parse(JSON.stringify(appConfig));
    setByPath(nextConfig, `mapping.${type}`, value);
    persistConfig(nextConfig);

    emitEvent('config-updated', { key: `mapping.${type}`, updatedAt: Date.now() });
    res.json({ success: true });
});

app.get('/api/targets', (_req, res) => {
    res.json(getAvailableTargets(appConfig));
});

app.get('/api/system-env', (_req, res) => {
    res.json(process.env.ANTHROPIC_BASE_URL || null);
});

app.post('/api/system-env', (req, res) => {
    const url = req.body?.url;
    if (url === null || url === '') {
        delete process.env.ANTHROPIC_BASE_URL;
        delete process.env.ANTHROPIC_API_KEY;
    } else {
        process.env.ANTHROPIC_BASE_URL = String(url);
        if (!process.env.ANTHROPIC_API_KEY) {
            process.env.ANTHROPIC_API_KEY = 'sk-local-proxy';
        }
    }

    res.json({ success: true });
});

app.post('/api/proxy/start', async (_req, res) => {
    const result = await startProxyServer(PROXY_PORT, sendProxyLog);
    res.json(result);
});

app.post('/api/proxy/stop', async (_req, res) => {
    await stopProxyServer(sendProxyLog);
    res.json({ success: true });
});

app.post('/api/proxy/restart', async (_req, res) => {
    await stopProxyServer(sendProxyLog);
    const result = await startProxyServer(PROXY_PORT, sendProxyLog);
    res.json(result);
});

app.get('/api/proxy/status', (_req, res) => {
    res.json(getProxyStatus());
});

app.post('/api/export', (_req, res) => {
    res.json({ success: true, config: appConfig });
});

app.post('/api/import', (req, res) => {
    const incomingConfig = req.body?.config;
    if (!incomingConfig || typeof incomingConfig !== 'object') {
        res.status(400).json({ success: false, error: 'config 无效' });
        return;
    }

    persistConfig(incomingConfig);
    emitEvent('config-imported', { importedAt: Date.now() });
    emitEvent('config-updated', { key: 'all', updatedAt: Date.now() });
    res.json({ success: true });
});

const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

app.listen(WEB_PORT, async () => {
    const shouldAutoStartProxy = AUTO_START_PROXY || Boolean(appConfig.settings?.autoLaunch);
    if (shouldAutoStartProxy) {
        await startProxyServer(PROXY_PORT, sendProxyLog);
    }

    console.log(`Web 服务已启动: http://127.0.0.1:${WEB_PORT}`);
    console.log(`代理端口: ${PROXY_PORT} (AUTO_START_PROXY=${shouldAutoStartProxy})`);
});

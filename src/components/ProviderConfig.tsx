/**
 * Provider 配置组件
 * 支持多个自定义 Provider
 */
import { useState, useEffect } from 'react';
import { Collapse, Form, Input, Switch, Button, Space, Tag, message, Divider, Card, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';

// 内置 Provider 定义
const BUILTIN_PROVIDERS = [
    { key: 'anthropic', name: 'Anthropic 官方', endpoint: 'https://api.anthropic.com' },
    { key: 'glm', name: 'GLM (智谱AI)', endpoint: 'https://open.bigmodel.cn/api/anthropic' },
    { key: 'kimi', name: 'Kimi (Moonshot)', endpoint: 'https://api.moonshot.cn/anthropic' },
    { key: 'minimax', name: 'MiniMax', endpoint: 'https://api.minimaxi.com/anthropic' },
    { key: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/anthropic' },
    { key: 'litellm', name: 'LiteLLM', endpoint: '本地代理' },
    { key: 'cliproxyapi', name: 'CLIProxyAPI', endpoint: '本地代理' }
];

interface ProviderConfigData {
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl?: string;
    binPath?: string;
    port?: number;
    configPath?: string;
}

interface CustomProviderData extends ProviderConfigData {
    id: string;
    name: string;
    baseUrl: string;
}

function ProviderConfig() {
    const [configs, setConfigs] = useState<Record<string, ProviderConfigData>>({});
    const [customProviders, setCustomProviders] = useState<CustomProviderData[]>([]);
    const [loading, setLoading] = useState(false);
    const [newModel, setNewModel] = useState<Record<string, string>>({});

    // 加载配置
    useEffect(() => {
        const loadConfigs = async () => {
            try {
                const allConfig = await window.electronAPI.getAllConfig();
                setConfigs(allConfig.providers || {});
                setCustomProviders(allConfig.providers?.customProviders || []);
            } catch (error) {
                console.error('加载配置失败:', error);
            }
        };
        loadConfigs();
    }, []);

    // 更新内置 Provider 配置
    const updateProvider = async (providerKey: string, field: string, value: any) => {
        const updated = {
            ...configs,
            [providerKey]: {
                ...configs[providerKey],
                [field]: value
            }
        };
        setConfigs(updated);
    };

    // 保存内置 Provider
    const saveProvider = async (providerKey: string) => {
        setLoading(true);
        try {
            await window.electronAPI.setConfig(`providers.${providerKey}`, configs[providerKey]);
            message.success(`${providerKey} 配置已保存`);
        } catch (error: any) {
            message.error('保存失败: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // 添加模型到内置 Provider
    const addModel = (providerKey: string) => {
        const modelName = newModel[providerKey]?.trim();
        if (!modelName) return;

        const currentModels = configs[providerKey]?.models || [];
        if (currentModels.includes(modelName)) {
            message.warning('模型已存在');
            return;
        }

        updateProvider(providerKey, 'models', [...currentModels, modelName]);
        setNewModel({ ...newModel, [providerKey]: '' });
    };

    // 删除模型
    const removeModel = (providerKey: string, modelName: string) => {
        const currentModels = configs[providerKey]?.models || [];
        updateProvider(providerKey, 'models', currentModels.filter((m: string) => m !== modelName));
    };

    // ========== 自定义 Provider 相关 ==========

    // 添加新的自定义 Provider
    const addCustomProvider = () => {
        const newId = `custom_${Date.now()}`;
        const newProvider: CustomProviderData = {
            id: newId,
            name: `自定义 ${customProviders.length + 1}`,
            enabled: false,
            apiKey: '',
            models: [],
            baseUrl: 'https://api.example.com'
        };
        setCustomProviders([...customProviders, newProvider]);
    };

    // 更新自定义 Provider
    const updateCustomProvider = (id: string, field: string, value: any) => {
        setCustomProviders(
            customProviders.map((p) =>
                p.id === id ? { ...p, [field]: value } : p
            )
        );
    };

    // 保存所有自定义 Provider
    const saveCustomProviders = async () => {
        setLoading(true);
        try {
            await window.electronAPI.setConfig('providers.customProviders', customProviders);
            message.success('自定义 Provider 已保存');
        } catch (error: any) {
            message.error('保存失败: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // 删除自定义 Provider
    const deleteCustomProvider = async (id: string) => {
        const updated = customProviders.filter((p) => p.id !== id);
        setCustomProviders(updated);
        try {
            await window.electronAPI.setConfig('providers.customProviders', updated);
            message.success('已删除');
        } catch (error: any) {
            message.error('删除失败: ' + error.message);
        }
    };

    // 添加模型到自定义 Provider
    const addCustomModel = (providerId: string) => {
        const modelName = newModel[providerId]?.trim();
        if (!modelName) return;

        const provider = customProviders.find((p) => p.id === providerId);
        if (!provider) return;

        if (provider.models.includes(modelName)) {
            message.warning('模型已存在');
            return;
        }

        updateCustomProvider(providerId, 'models', [...provider.models, modelName]);
        setNewModel({ ...newModel, [providerId]: '' });
    };

    // 删除自定义 Provider 的模型
    const removeCustomModel = (providerId: string, modelName: string) => {
        const provider = customProviders.find((p) => p.id === providerId);
        if (!provider) return;
        updateCustomProvider(providerId, 'models', provider.models.filter((m) => m !== modelName));
    };

    // ========== 渲染 ==========

    // 内置 Provider 面板
    const builtinItems = BUILTIN_PROVIDERS.map((provider) => {
        const config = configs[provider.key] || { enabled: false, apiKey: '', models: [] };

        return {
            key: provider.key,
            label: (
                <Space>
                    <span>{provider.name}</span>
                    {config.enabled && <Tag color="success">已启用</Tag>}
                </Space>
            ),
            children: (
                <Form layout="vertical" size="small">
                    <Form.Item label="启用">
                        <Switch
                            checked={config.enabled}
                            onChange={(checked) => updateProvider(provider.key, 'enabled', checked)}
                        />
                    </Form.Item>

                    <Form.Item label="API Key">
                        <Input.Password
                            value={config.apiKey}
                            onChange={(e) => updateProvider(provider.key, 'apiKey', e.target.value)}
                            placeholder="输入 API 密钥"
                        />
                    </Form.Item>

                    {['litellm', 'cliproxyapi'].includes(provider.key) && (
                        <>
                            <Form.Item label="程序路径">
                                <Input
                                    value={config.binPath}
                                    onChange={(e) => updateProvider(provider.key, 'binPath', e.target.value)}
                                    placeholder="~/.local/bin/litellm"
                                />
                            </Form.Item>
                            <Form.Item label="端口">
                                <Input
                                    type="number"
                                    value={config.port}
                                    onChange={(e) => updateProvider(provider.key, 'port', parseInt(e.target.value))}
                                    placeholder="4100"
                                />
                            </Form.Item>
                            <Form.Item label="配置文件路径">
                                <Input
                                    value={config.configPath}
                                    onChange={(e) => updateProvider(provider.key, 'configPath', e.target.value)}
                                    placeholder="~/.claude/proxy/litellm.yaml"
                                />
                            </Form.Item>
                        </>
                    )}

                    <Form.Item label="可用模型">
                        <Space wrap style={{ marginBottom: 8 }}>
                            {(config.models || []).map((model: string) => (
                                <Tag key={model} closable onClose={() => removeModel(provider.key, model)}>
                                    {model}
                                </Tag>
                            ))}
                        </Space>
                        <Space.Compact style={{ width: '100%' }}>
                            <Input
                                value={newModel[provider.key] || ''}
                                onChange={(e) => setNewModel({ ...newModel, [provider.key]: e.target.value })}
                                placeholder="输入模型名称"
                                onPressEnter={() => addModel(provider.key)}
                            />
                            <Button icon={<PlusOutlined />} onClick={() => addModel(provider.key)}>
                                添加
                            </Button>
                        </Space.Compact>
                    </Form.Item>

                    <Form.Item>
                        <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            onClick={() => saveProvider(provider.key)}
                            loading={loading}
                        >
                            保存配置
                        </Button>
                    </Form.Item>

                    {provider.endpoint !== '本地代理' && (
                        <div style={{ marginTop: 8 }}>
                            <Tag>Endpoint: {provider.endpoint}</Tag>
                        </div>
                    )}
                </Form>
            )
        };
    });

    return (
        <div>
            {/* 内置 Provider */}
            <Collapse accordion items={builtinItems} style={{ background: 'transparent' }} />

            <Divider>自定义 Provider</Divider>

            {/* 自定义 Provider 列表 */}
            {customProviders.map((custom) => (
                <Card
                    key={custom.id}
                    size="small"
                    title={
                        <Space>
                            <Input
                                value={custom.name}
                                onChange={(e) => updateCustomProvider(custom.id, 'name', e.target.value)}
                                style={{ width: 150 }}
                                placeholder="Provider 名称"
                            />
                            {custom.enabled && <Tag color="success">已启用</Tag>}
                        </Space>
                    }
                    extra={
                        <Popconfirm
                            title="确定删除此 Provider?"
                            onConfirm={() => deleteCustomProvider(custom.id)}
                        >
                            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                        </Popconfirm>
                    }
                    style={{ marginBottom: 12 }}
                >
                    <Form layout="vertical" size="small">
                        <Form.Item label="启用">
                            <Switch
                                checked={custom.enabled}
                                onChange={(checked) => updateCustomProvider(custom.id, 'enabled', checked)}
                            />
                        </Form.Item>

                        <Form.Item label="Base URL">
                            <Input
                                value={custom.baseUrl}
                                onChange={(e) => updateCustomProvider(custom.id, 'baseUrl', e.target.value)}
                                placeholder="https://api.example.com"
                            />
                        </Form.Item>

                        <Form.Item label="API Key">
                            <Input.Password
                                value={custom.apiKey}
                                onChange={(e) => updateCustomProvider(custom.id, 'apiKey', e.target.value)}
                                placeholder="输入 API 密钥"
                            />
                        </Form.Item>

                        <Form.Item label="可用模型">
                            <Space wrap style={{ marginBottom: 8 }}>
                                {custom.models.map((model) => (
                                    <Tag key={model} closable onClose={() => removeCustomModel(custom.id, model)}>
                                        {model}
                                    </Tag>
                                ))}
                            </Space>
                            <Space.Compact style={{ width: '100%' }}>
                                <Input
                                    value={newModel[custom.id] || ''}
                                    onChange={(e) => setNewModel({ ...newModel, [custom.id]: e.target.value })}
                                    placeholder="输入模型名称"
                                    onPressEnter={() => addCustomModel(custom.id)}
                                />
                                <Button icon={<PlusOutlined />} onClick={() => addCustomModel(custom.id)}>
                                    添加
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                    </Form>
                </Card>
            ))}

            {/* 添加自定义 Provider 按钮 */}
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Button icon={<PlusOutlined />} onClick={addCustomProvider}>
                    添加自定义 Provider
                </Button>
                {customProviders.length > 0 && (
                    <Button type="primary" icon={<SaveOutlined />} onClick={saveCustomProviders} loading={loading}>
                        保存所有自定义 Provider
                    </Button>
                )}
            </Space>
        </div>
    );
}

export default ProviderConfig;

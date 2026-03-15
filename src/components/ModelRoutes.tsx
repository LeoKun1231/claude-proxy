import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Form, Input, Popconfirm, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, BranchesOutlined } from '@ant-design/icons';
import type { AppConfig, ModelRoute } from '../types/config';

const { Text } = Typography;

interface ProviderOption {
    value: string;
    label: string;
    baseUrl: string;
    apiKey: string;
}

function buildModelOptions(globalModels: string[], currentModel = '') {
    const values = [...globalModels];

    if (currentModel && !values.includes(currentModel)) {
        values.unshift(currentModel);
    }

    return values.map((model) => ({
        label: model,
        value: model,
    }));
}

function buildProviderOptions(config: AppConfig): ProviderOption[] {
    const providers = config.providers || {} as AppConfig['providers'];
    const customOptions = Array.isArray(providers.customProviders)
        ? providers.customProviders.map((provider) => ({
            value: provider.id,
            label: provider.name,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey || '',
        }))
        : [];

    return customOptions;
}

function createRouteId() {
    return `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRoute(providerOptions: ProviderOption[]): ModelRoute {
    const defaultProvider = providerOptions[0];
    return {
        id: createRouteId(),
        enabled: true,
        sourceModel: '',
        targetModel: '',
        providerId: defaultProvider?.value || '',
        providerLabel: defaultProvider?.label || '',
        baseUrl: defaultProvider?.baseUrl || '',
        apiKey: defaultProvider?.apiKey || '',
    };
}

function ModelRoutes() {
    const [routes, setRoutes] = useState<ModelRoute[]>([]);
    const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
    const [globalModels, setGlobalModels] = useState<string[]>([]);
    const saveTimerRef = useRef<number | null>(null);

    const loadData = useCallback(async () => {
        try {
            const allConfig = await window.electronAPI.getAllConfig();
            setRoutes(Array.isArray(allConfig.modelRoutes) ? allConfig.modelRoutes : []);
            setProviderOptions(buildProviderOptions(allConfig));
            setGlobalModels(Array.isArray(allConfig.globalModels) ? allConfig.globalModels : []);
        } catch (error) {
            console.error('加载模型路由失败:', error);
        }
    }, []);

    useEffect(() => {
        loadData();

        const handleUpdate = () => {
            loadData();
        };

        window.electronAPI.onConfigUpdated?.(handleUpdate);
        window.electronAPI.onConfigImported?.(handleUpdate);
        window.addEventListener('focus', handleUpdate);

        return () => {
            window.electronAPI.removeConfigUpdatedListener?.(handleUpdate);
            window.electronAPI.removeConfigImportedListener?.(handleUpdate);
            window.removeEventListener('focus', handleUpdate);
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
            }
        };
    }, [loadData]);

    const queueSaveRoutes = useCallback((nextRoutes: ModelRoute[]) => {
        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = window.setTimeout(async () => {
            try {
                await window.electronAPI.setConfig('modelRoutes', nextRoutes);
            } catch (error: any) {
                message.error('模型路由保存失败: ' + (error?.message || '未知错误'));
            }
        }, 400);
    }, []);

    const providerMap = useMemo(() => {
        return providerOptions.reduce<Record<string, ProviderOption>>((result, option) => {
            result[option.value] = option;
            return result;
        }, {});
    }, [providerOptions]);

    const applyRouteUpdate = useCallback((updater: (current: ModelRoute[]) => ModelRoute[]) => {
        setRoutes((current) => {
            const nextRoutes = updater(current);
            queueSaveRoutes(nextRoutes);
            return nextRoutes;
        });
    }, [queueSaveRoutes]);

    const updateRouteField = useCallback((routeId: string, field: keyof ModelRoute, value: string | boolean) => {
        applyRouteUpdate((current) => current.map((route) => {
            if (route.id !== routeId) {
                return route;
            }

            if (field === 'providerId') {
                const nextProvider = providerMap[String(value)] || null;
                return {
                    ...route,
                    providerId: String(value),
                    providerLabel: nextProvider?.label || '',
                    baseUrl: nextProvider?.baseUrl || '',
                    apiKey: nextProvider?.apiKey || '',
                };
            }

            return {
                ...route,
                [field]: value,
            };
        }));
    }, [applyRouteUpdate, providerMap]);

    const addRoute = useCallback(() => {
        if (providerOptions.length === 0) {
            message.warning('请先添加自定义 Provider，再创建模型路由');
            return;
        }
        applyRouteUpdate((current) => [...current, createEmptyRoute(providerOptions)]);
    }, [applyRouteUpdate, providerOptions]);

    const deleteRoute = useCallback((routeId: string) => {
        applyRouteUpdate((current) => current.filter((route) => route.id !== routeId));
        message.success('模型路由已删除');
    }, [applyRouteUpdate]);

    return (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <Space size="small">
                    <Tag color="processing">{routes.length} 条路由</Tag>
                    <Tag color="success">{routes.filter((route) => route.enabled).length} 条启用</Tag>
                </Space>
                <Button icon={<PlusOutlined />} onClick={addRoute}>
                    添加模型路由
                </Button>
            </div>

            {routes.length === 0 ? (
                <Card size="small" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="还没有配置模型路由，未命中时会继续使用默认回退映射"
                    />
                </Card>
            ) : (
                routes.map((route) => {
                    const routeModelOptions = buildModelOptions(globalModels, route.targetModel);

                    return (
                        <Card
                            key={route.id}
                            size="small"
                            title={(
                                <Space wrap>
                                    <BranchesOutlined />
                                    <Text strong>{route.sourceModel || '未命名源模型'}</Text>
                                    <Text type="secondary">→</Text>
                                    <Text>{route.targetModel || '未设置目标模型'}</Text>
                                    {route.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>}
                                </Space>
                            )}
                            extra={(
                                <Popconfirm
                                    title="删除这条模型路由？"
                                    onConfirm={() => deleteRoute(route.id)}
                                >
                                    <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                                </Popconfirm>
                            )}
                            style={{ background: 'rgba(255,255,255,0.02)' }}
                        >
                            <Form layout="vertical" size="small">
                                <Form.Item label="启用">
                                    <Switch
                                        checked={route.enabled}
                                        onChange={(checked) => updateRouteField(route.id, 'enabled', checked)}
                                    />
                                </Form.Item>

                                <Form.Item label="源模型">
                                    <Input
                                        value={route.sourceModel}
                                        onChange={(event) => updateRouteField(route.id, 'sourceModel', event.target.value)}
                                        placeholder="例如 claude-sonnet-4-6"
                                    />
                                </Form.Item>

                                <Form.Item label="目标 Provider">
                                    <Select
                                        value={route.providerId || undefined}
                                        onChange={(value) => updateRouteField(route.id, 'providerId', value)}
                                        options={providerOptions}
                                        placeholder="选择目标 Provider"
                                        showSearch
                                        optionFilterProp="label"
                                        disabled={providerOptions.length === 0}
                                    />
                                </Form.Item>

                                <Form.Item label="目标模型">
                                    <Select
                                        value={route.targetModel || undefined}
                                        onChange={(value) => updateRouteField(route.id, 'targetModel', value)}
                                        options={routeModelOptions}
                                        placeholder="选择全局目标模型"
                                        showSearch
                                        optionFilterProp="label"
                                        disabled={routeModelOptions.length === 0}
                                    />
                                </Form.Item>

                                <Form.Item label="Base URL">
                                    <Input
                                        value={route.baseUrl}
                                        onChange={(event) => updateRouteField(route.id, 'baseUrl', event.target.value)}
                                        placeholder="https://api.example.com"
                                    />
                                </Form.Item>

                                <Form.Item label="API Key">
                                    <Input.Password
                                        value={route.apiKey}
                                        onChange={(event) => updateRouteField(route.id, 'apiKey', event.target.value)}
                                        placeholder="输入该模型路由专用密钥"
                                    />
                                </Form.Item>

                                <Form.Item>
                                    <Space wrap size={[8, 8]}>
                                        <Tag>{route.providerLabel || providerMap[route.providerId]?.label || '未命名 Provider'}</Tag>
                                        <Text type="secondary">保存到 `DATA_DIR/config.json`，容器重建后可从挂载卷恢复</Text>
                                    </Space>
                                </Form.Item>
                            </Form>
                        </Card>
                    );
                })
            )}
        </Space>
    );
}

export default ModelRoutes;

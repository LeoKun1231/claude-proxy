import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Empty, Form, Input, Select, Space, Tag, Typography, message } from 'antd';
import { BranchesOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import type { CustomProviderData, ModelRoute } from '../types/config';

const { Text } = Typography;

interface ModelMappingProps {
    onMappingChange?: () => void;
}

function parseFallbackTarget(target: string) {
    if (!target || target === 'pass') {
        return { providerId: '', targetModel: '' };
    }

    const separatorIndex = target.indexOf(':');
    if (separatorIndex === -1) {
        return { providerId: '', targetModel: '' };
    }

    return {
        providerId: target.slice(0, separatorIndex),
        targetModel: target.slice(separatorIndex + 1),
    };
}

function formatFallbackTarget(providerId: string, targetModel: string) {
    if (!providerId || !targetModel) {
        return 'pass';
    }

    return `${providerId}:${targetModel}`;
}

function normalizeModelName(value: string) {
    return value.trim();
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

function ModelMapping({ onMappingChange }: ModelMappingProps) {
    const [fallbackTarget, setFallbackTarget] = useState<string>('pass');
    const [routes, setRoutes] = useState<ModelRoute[]>([]);
    const [customProviders, setCustomProviders] = useState<CustomProviderData[]>([]);
    const [globalModels, setGlobalModels] = useState<string[]>([]);
    const [globalModelInput, setGlobalModelInput] = useState<string>('');
    const [fallbackProviderId, setFallbackProviderId] = useState<string>('');
    const [fallbackModel, setFallbackModel] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [savingModels, setSavingModels] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const [main, allConfig] = await Promise.all([
                window.electronAPI.getMapping('main'),
                window.electronAPI.getAllConfig()
            ]);

            const parsedFallback = parseFallbackTarget(main);
            setFallbackTarget(main);
            setFallbackProviderId(parsedFallback.providerId);
            setFallbackModel(parsedFallback.targetModel);
            setRoutes(Array.isArray(allConfig.modelRoutes) ? allConfig.modelRoutes : []);
            setCustomProviders(Array.isArray(allConfig.providers?.customProviders) ? allConfig.providers.customProviders : []);
            setGlobalModels(Array.isArray(allConfig.globalModels) ? allConfig.globalModels : []);
        } catch (error) {
            console.error('加载路由概览失败:', error);
            message.error('加载路由概览失败');
        }
    }, []);

    useEffect(() => {
        loadData();

        const handleConfigUpdate = () => {
            loadData();
        };

        window.electronAPI.onConfigUpdated?.(handleConfigUpdate);
        window.electronAPI.onConfigImported?.(handleConfigUpdate);
        window.addEventListener('focus', handleConfigUpdate);

        return () => {
            window.electronAPI.removeConfigUpdatedListener?.(handleConfigUpdate);
            window.electronAPI.removeConfigImportedListener?.(handleConfigUpdate);
            window.removeEventListener('focus', handleConfigUpdate);
        };
    }, [loadData]);

    const handleRefresh = async () => {
        setLoading(true);
        try {
            await loadData();
            message.success('路由信息已刷新');
        } finally {
            setLoading(false);
        }
    };

    const saveFallback = async () => {
        const nextTarget = formatFallbackTarget(fallbackProviderId, fallbackModel.trim());
        setLoading(true);
        try {
            await window.electronAPI.setMapping('main', nextTarget);
            await window.electronAPI.setMapping('haiku', nextTarget);
            setFallbackTarget(nextTarget);
            message.success(nextTarget === 'pass' ? '默认回退已关闭' : '默认回退已更新');
            onMappingChange?.();
        } catch (error: any) {
            message.error('更新失败: ' + (error?.message || '未知错误'));
        } finally {
            setLoading(false);
        }
    };

    const disableFallback = async () => {
        setFallbackProviderId('');
        setFallbackModel('');
        setLoading(true);
        try {
            await window.electronAPI.setMapping('main', 'pass');
            await window.electronAPI.setMapping('haiku', 'pass');
            setFallbackTarget('pass');
            message.success('默认回退已关闭');
            onMappingChange?.();
        } catch (error: any) {
            message.error('更新失败: ' + (error?.message || '未知错误'));
        } finally {
            setLoading(false);
        }
    };

    const enabledRoutes = useMemo(() => {
        return routes.filter((route) => route.enabled);
    }, [routes]);

    const providerOptions = useMemo(() => {
        return customProviders.map((provider) => ({
            label: provider.name,
            value: provider.id,
        }));
    }, [customProviders]);

    const fallbackModelOptions = useMemo(() => {
        return buildModelOptions(globalModels, fallbackModel);
    }, [globalModels, fallbackModel]);

    const currentFallbackLabel = useMemo(() => {
        if (fallbackTarget === 'pass') {
            return '不回退';
        }

        const provider = customProviders.find((item) => item.id === parseFallbackTarget(fallbackTarget).providerId);
        const parsedFallback = parseFallbackTarget(fallbackTarget);
        return provider ? `${provider.name} / ${parsedFallback.targetModel}` : fallbackTarget;
    }, [customProviders, fallbackTarget]);

    const saveGlobalModels = async (nextModels: string[], successMessage: string) => {
        setSavingModels(true);
        try {
            await window.electronAPI.setConfig('globalModels', nextModels);
            setGlobalModels(nextModels);
            message.success(successMessage);
        } catch (error: any) {
            message.error('全局模型名保存失败: ' + (error?.message || '未知错误'));
        } finally {
            setSavingModels(false);
        }
    };

    const handleAddGlobalModel = async () => {
        const nextModel = normalizeModelName(globalModelInput);
        if (!nextModel) {
            message.warning('请先输入模型名');
            return;
        }

        if (globalModels.includes(nextModel)) {
            setGlobalModelInput('');
            message.info('该模型名已存在');
            return;
        }

        setGlobalModelInput('');
        await saveGlobalModels([...globalModels, nextModel], '全局模型名已添加');
    };

    const handleRemoveGlobalModel = async (model: string) => {
        await saveGlobalModels(
            globalModels.filter((item) => item !== model),
            '全局模型名已删除'
        );
    };

    return (
        <div className="fade-in">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space wrap>
                        <Tag color="processing">{routes.length} 条模型路由</Tag>
                        <Tag color="success">{enabledRoutes.length} 条启用</Tag>
                    </Space>
                    <Button
                        size="small"
                        icon={<ReloadOutlined className={loading ? 'spin-icon' : ''} />}
                        onClick={handleRefresh}
                        loading={loading}
                        style={{ borderRadius: 6 }}
                    >
                        刷新
                    </Button>
                </div>

                <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        <BranchesOutlined style={{ marginRight: 8 }} />
                        路由命中概览
                    </Text>

                    {enabledRoutes.length === 0 ? (
                        <div className="info-box">
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="当前没有启用的模型路由，所有请求都会依赖默认回退"
                            />
                        </div>
                    ) : (
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                            {enabledRoutes.map((route) => (
                                <div
                                    key={route.id}
                                    className="info-box"
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                >
                                    <Space wrap>
                                        <Text code>{route.sourceModel || '未设置源模型'}</Text>
                                        <Text type="secondary">→</Text>
                                        <Text>{route.providerLabel || route.providerId || '未设置 Provider'}</Text>
                                        <Text code>{route.targetModel || '未设置目标模型'}</Text>
                                    </Space>
                                    <Tag color="success">精确匹配</Tag>
                                </div>
                            ))}
                        </Space>
                    )}
                </div>

                <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        全局模型名
                    </Text>
                    <div className="info-box">
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            {globalModels.length === 0 ? (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description="还没有全局模型名，先添加后才能在模型路由和默认回退里选择目标模型"
                                />
                            ) : (
                                <Space wrap size={[8, 8]}>
                                    {globalModels.map((model) => (
                                        <Tag
                                            key={model}
                                            closable
                                            onClose={(event) => {
                                                event.preventDefault();
                                                void handleRemoveGlobalModel(model);
                                            }}
                                        >
                                            {model}
                                        </Tag>
                                    ))}
                                </Space>
                            )}

                            <Space.Compact style={{ width: '100%' }}>
                                <Input
                                    value={globalModelInput}
                                    onChange={(event) => setGlobalModelInput(event.target.value)}
                                    onPressEnter={() => void handleAddGlobalModel()}
                                    placeholder="例如 gpt-5.4(xhigh)"
                                />
                                <Button
                                    icon={<PlusOutlined />}
                                    onClick={() => void handleAddGlobalModel()}
                                    loading={savingModels}
                                >
                                    添加
                                </Button>
                            </Space.Compact>

                            <Text type="secondary" style={{ fontSize: 12 }}>
                                这里维护全局可选模型名，默认回退和每条模型路由的目标模型都从这份列表里选择。
                            </Text>
                        </Space>
                    </div>
                </div>

                <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        <SwapOutlined style={{ marginRight: 8 }} />
                        默认回退
                    </Text>
                    <Form layout="vertical" size="small">
                        <Form.Item label="目标 Provider">
                            <Select
                                style={{ width: '100%' }}
                                value={fallbackProviderId || undefined}
                                onChange={setFallbackProviderId}
                                options={providerOptions}
                                loading={loading}
                                placeholder="选择未命中路由时的目标 Provider"
                                size="large"
                                allowClear
                            />
                        </Form.Item>

                        <Form.Item label="目标模型">
                            <Select
                                value={fallbackModel || undefined}
                                onChange={(value) => setFallbackModel(value || '')}
                                options={fallbackModelOptions}
                                placeholder="选择全局目标模型"
                                size="large"
                                showSearch
                                optionFilterProp="label"
                                allowClear
                                disabled={fallbackModelOptions.length === 0}
                            />
                        </Form.Item>

                        <Space>
                            <Button
                                type="primary"
                                icon={<SaveOutlined />}
                                onClick={saveFallback}
                                loading={loading}
                                disabled={!fallbackProviderId || !fallbackModel.trim()}
                            >
                                保存默认回退
                            </Button>
                            <Button
                                icon={<StopOutlined />}
                                onClick={disableFallback}
                                loading={loading}
                            >
                                关闭回退
                            </Button>
                        </Space>
                    </Form>
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                        仅当请求中的 `model` 没有命中任何启用路由时，才会使用这里配置的全局默认回退。
                    </Text>
                </div>
            </Space>

            <div className="info-box" style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    当前默认回退：
                    <Text code style={{ marginLeft: 8 }}>
                        {currentFallbackLabel}
                    </Text>
                </Text>
            </div>
        </div>
    );
}

export default ModelMapping;

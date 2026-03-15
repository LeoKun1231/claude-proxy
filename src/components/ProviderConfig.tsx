/**
 * Provider 配置组件
 * 仅保留自定义 Provider 配置
 */
import { useState, useEffect, useRef } from 'react';
import { Form, Input, Switch, Button, Space, Tag, message, Divider, Card, Popconfirm, Typography, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

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

const { Text } = Typography;

function ProviderConfig() {
    const [customProviders, setCustomProviders] = useState<CustomProviderData[]>([]);
    const customSaveTimerRef = useRef<number | null>(null);

    // 加载配置
    useEffect(() => {
        const loadConfigs = async () => {
            try {
                const allConfig = await window.electronAPI.getAllConfig();
                setCustomProviders(allConfig.providers?.customProviders || []);
            } catch (error) {
                console.error('加载配置失败:', error);
            }
        };
        loadConfigs();
    }, []);

    // 防抖保存自定义 Provider 列表
    const queueSaveCustomProviders = (nextProviders: CustomProviderData[]) => {
        if (customSaveTimerRef.current) {
            window.clearTimeout(customSaveTimerRef.current);
        }

        customSaveTimerRef.current = window.setTimeout(async () => {
            try {
                await window.electronAPI.setConfig('providers.customProviders', nextProviders);
            } catch (error: any) {
                message.error('自动保存失败: ' + (error?.message || '未知错误'));
            }
        }, 400);
    };

    useEffect(() => {
        return () => {
            if (customSaveTimerRef.current) {
                window.clearTimeout(customSaveTimerRef.current);
            }
        };
    }, []);

    // ========== 自定义 Provider 相关 ==========

    // 添加新的自定义 Provider
    const addCustomProvider = () => {
        const newId = `custom_${Date.now()}`;
        const newProvider: CustomProviderData = {
            id: newId,
            name: `自定义 ${customProviders.length + 1}`,
            enabled: true,
            apiKey: '',
            models: [],
            baseUrl: 'https://api.example.com'
        };
        const updated = [...customProviders, newProvider];
        setCustomProviders(updated);
        queueSaveCustomProviders(updated);
    };

    // 更新自定义 Provider
    const updateCustomProvider = (id: string, field: string, value: any) => {
        setCustomProviders((prev) => {
            const updated = prev.map((p) =>
                p.id === id ? { ...p, [field]: value } : p
            );
            queueSaveCustomProviders(updated);
            return updated;
        });
    };

    // 删除自定义 Provider
    const deleteCustomProvider = (id: string) => {
        const updated = customProviders.filter((p) => p.id !== id);
        setCustomProviders(updated);
        queueSaveCustomProviders(updated);
        message.success('已删除并自动保存');
    };

    return (
        <div>
            <Card size="small" style={{ marginBottom: 12, background: 'rgba(255,255,255,0.02)' }}>
                <Text type="secondary">
                    这里只维护自定义 Provider 的连接信息。模型选择改为全局配置，在“模型路由 / 默认回退”区域统一维护。
                </Text>
            </Card>

            <Divider>自定义 Provider</Divider>

            {customProviders.length === 0 && (
                <Card size="small" style={{ marginBottom: 12, background: 'rgba(255,255,255,0.02)' }}>
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="还没有自定义 Provider，先添加一个再去配置模型路由。"
                    />
                </Card>
            )}

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

                        <Form.Item>
                            <Text type="secondary">模型由全局“模型路由 / 默认回退”统一控制</Text>
                        </Form.Item>
                    </Form>
                </Card>
            ))}

            {/* 添加自定义 Provider 按钮 */}
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Button icon={<PlusOutlined />} onClick={addCustomProvider}>
                    添加自定义 Provider
                </Button>
                {customProviders.length > 0 && <Text type="secondary">已开启自动保存</Text>}
            </Space>
        </div>
    );
}

export default ProviderConfig;

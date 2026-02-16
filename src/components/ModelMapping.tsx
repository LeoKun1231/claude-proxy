/**
 * 模型映射选择组件
 * 仅保留 Main 模型映射
 */
import { useState, useEffect, useCallback } from 'react';
import { Select, Space, Typography, message, Button } from 'antd';
import { SwapOutlined, ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface ModelMappingProps {
    onMappingChange?: () => void;
}

function ModelMapping({ onMappingChange }: ModelMappingProps) {
    const [mainMapping, setMainMapping] = useState<string>('pass');
    const [targets, setTargets] = useState<string[]>(['pass']);
    const [providers, setProviders] = useState<any>({}); // 存储 Provider 配置以获取名称
    const [loading, setLoading] = useState(false);

    // 加载 targets 列表和配置
    const loadData = useCallback(async () => {
        try {
            const [main, availableTargets, allConfig] = await Promise.all([
                window.electronAPI.getMapping('main'),
                window.electronAPI.getAvailableTargets(),
                window.electronAPI.getAllConfig()
            ]);
            setMainMapping(main);
            setTargets(availableTargets);
            setProviders(allConfig.providers || {});
            return availableTargets;
        } catch (error) {
            console.error('加载数据失败:', error);
            return ['pass'];
        }
    }, []);

    // 初始加载
    useEffect(() => {
        loadData();

        const handleConfigUpdate = () => {
            loadData();
        };

        window.electronAPI.onConfigUpdated?.(handleConfigUpdate);
        window.electronAPI.onConfigImported?.(handleConfigUpdate);
        window.addEventListener('focus', handleConfigUpdate);

        return () => {
            window.electronAPI.removeConfigUpdatedListener?.();
            window.electronAPI.removeConfigImportedListener?.();
            window.removeEventListener('focus', handleConfigUpdate);
        };
    }, [loadData]);

    // 刷新
    const handleRefresh = async () => {
        setLoading(true);
        try {
            await loadData();
            message.success('模型列表已刷新');
        } finally {
            setLoading(false);
        }
    };

    // 更新 Main 映射
    const handleMainChange = async (value: string) => {
        setLoading(true);
        try {
            await window.electronAPI.setMapping('main', value);
            // 同步设置 Haiku 为相同值
            await window.electronAPI.setMapping('haiku', value);
            setMainMapping(value);
            message.success(`模型映射已更新`);
            onMappingChange?.();
        } catch (error: any) {
            message.error('更新失败: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // 获取 Provider 显示名称
    const getProviderDisplay = (target: string) => {
        if (target === 'pass') return '透传 (Direct)';

        const separatorIndex = target.indexOf(':');
        if (separatorIndex === -1) return target;

        const providerId = target.substring(0, separatorIndex);
        const modelName = target.substring(separatorIndex + 1);

        // 尝试从内置 Provider 或自定义 Provider 中查找名称
        let providerName = providerId;

        // 查找自定义 Provider
        if (providers.customProviders) {
            const custom = providers.customProviders.find((p: any) => p.id === providerId);
            if (custom) {
                providerName = custom.name;
            }
        }

        // 查找内置 Provider (如果 custom 里没找到，再看内置 map)
        const builtinMap: Record<string, string> = {
            'anthropic': 'Anthropic',
            'glm': '智谱 GLM',
            'kimi': 'Kimi',
            'minimax': 'MiniMax',
            'deepseek': 'DeepSeek',
            'litellm': 'LiteLLM',
            'cliproxyapi': 'CLIProxyAPI'
        };

        if (builtinMap[providerId]) {
            providerName = builtinMap[providerId];
        }

        return `${providerName} : ${modelName}`;
    };

    // 生成选项
    const options = targets.map((target) => ({
        label: getProviderDisplay(target),
        value: target
    }));

    return (
        <div className="fade-in">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {/* 刷新按钮 */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        size="small"
                        icon={<ReloadOutlined className={loading ? 'spin-icon' : ''} />}
                        onClick={handleRefresh}
                        loading={loading}
                        style={{ borderRadius: 6 }}
                    >
                        刷新模型列表
                    </Button>
                </div>

                {/* Main 映射 */}
                <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        <SwapOutlined style={{ marginRight: 8 }} />
                        目标模型
                    </Text>
                    <Select
                        style={{ width: '100%' }}
                        value={mainMapping}
                        onChange={handleMainChange}
                        options={options}
                        loading={loading}
                        placeholder="选择映射目标"
                        size="large"
                    />
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                        将 Claude API 请求转发到选定的模型
                    </Text>
                </div>
            </Space>

            {/* 当前状态 */}
            <div className="info-box" style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    当前映射：
                    <Text code style={{ marginLeft: 8 }}>
                        {mainMapping === 'pass' ? '透传模式' : mainMapping}
                    </Text>
                </Text>
            </div>
        </div>
    );
}

export default ModelMapping;

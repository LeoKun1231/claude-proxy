/**
 * 环境变量配置组件
 * 用于一键设置 ANTHROPIC_BASE_URL
 */
import { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Tooltip, message, Tag } from 'antd';
import {
    CodeOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    QuestionCircleOutlined,
    PoweroffOutlined
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

// 当前预期端口 (应该动态获取，这里先硬编码或者从 proxyStatus 拿)
const EXPECTED_URL = 'http://127.0.0.1:5055';

function EnvConfig() {
    const [currentEnv, setCurrentEnv] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // 检查环境变量
    const checkEnv = async () => {
        try {
            const env = await window.electronAPI.checkSystemEnv();
            setCurrentEnv(env);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        checkEnv();
        // 聚焦窗口时重新检查
        window.addEventListener('focus', checkEnv);
        return () => window.removeEventListener('focus', checkEnv);
    }, []);

    // 一键设置
    const handleSetEnv = async () => {
        setLoading(true);
        try {
            await window.electronAPI.setSystemEnv(EXPECTED_URL);
            message.success('环境变量已设置！请重启终端生效');
            await checkEnv();
        } catch (e) {
            message.error('设置失败');
        } finally {
            setLoading(false);
        }
    };

    // 清除
    const handleClearEnv = async () => {
        setLoading(true);
        try {
            await window.electronAPI.setSystemEnv(null);
            message.success('环境变量已清除');
            await checkEnv();
        } catch (e) {
            message.error('清除失败');
        } finally {
            setLoading(false);
        }
    };

    const isConfigured = currentEnv === EXPECTED_URL;

    return (
        <Card
            title={
                <Space>
                    <CodeOutlined style={{ color: '#722ed1' }} />
                    <span>命令行配置</span>
                    <Tooltip title="为 Claude Code 命令行工具自动配置代理地址">
                        <QuestionCircleOutlined style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }} />
                    </Tooltip>
                </Space>
            }
            size="small"
            style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
            }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>当前 ANTHROPIC_BASE_URL</Text>
                    <div style={{ marginTop: 4 }}>
                        {currentEnv ? (
                            <Tag color={isConfigured ? 'success' : 'warning'} style={{ marginRight: 0 }}>
                                {currentEnv}
                            </Tag>
                        ) : (
                            <Tag style={{ borderStyle: 'dashed', background: 'transparent', opacity: 0.6 }}>
                                未设置
                            </Tag>
                        )}
                    </div>
                </div>

                {!isConfigured ? (
                    <Button
                        type="primary"
                        block
                        icon={<CheckCircleOutlined />}
                        onClick={handleSetEnv}
                        loading={loading}
                        style={{ borderRadius: 6, background: '#722ed1', borderColor: '#722ed1' }}
                    >
                        一键配置代理
                    </Button>
                ) : (
                    <Space style={{ width: '100%' }}>
                        <Button
                            block
                            disabled
                            style={{ flex: 1, borderRadius: 6, color: '#52c41a', borderColor: '#52c41a', background: 'rgba(82,196,26,0.1)' }}
                        >
                            已配置
                        </Button>
                        <Tooltip title="清除环境变量">
                            <Button
                                icon={<PoweroffOutlined />}
                                onClick={handleClearEnv}
                                loading={loading}
                                style={{ borderRadius: 6 }}
                            />
                        </Tooltip>
                    </Space>
                )}

                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
                    <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                    设置后必须 <Text type="warning" style={{ fontSize: 11 }}>重启终端 (VSCode)</Text> 才能生效
                </div>
            </Space>
        </Card>
    );
}

export default EnvConfig;

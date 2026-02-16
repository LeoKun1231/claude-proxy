/**
 * 环境变量配置组件
 * 用于一键设置 ANTHROPIC_BASE_URL
 */
import { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Tooltip, message, Tag } from 'antd';
import {
    CodeOutlined,
    ExclamationCircleOutlined,
    QuestionCircleOutlined,
    PoweroffOutlined,
    CopyOutlined
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

// 当前预期端口 (应该动态获取，这里先硬编码或者从 proxyStatus 拿)
const EXPECTED_URL = 'http://127.0.0.1:5055';
const SET_ENV_COMMAND = `export ANTHROPIC_BASE_URL=${EXPECTED_URL}
export ANTHROPIC_API_KEY=sk-local-proxy`;
const CLEAR_ENV_COMMAND = `unset ANTHROPIC_BASE_URL
unset ANTHROPIC_API_KEY`;

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
            await navigator.clipboard.writeText(SET_ENV_COMMAND);
            message.success('已复制命令，请在 Claude Code 所在终端执行后重启会话');
        } catch (e) {
            message.error('复制失败，请手动复制下方命令');
        } finally {
            setLoading(false);
        }
    };

    // 清除
    const handleClearEnv = async () => {
        setLoading(true);
        try {
            await navigator.clipboard.writeText(CLEAR_ENV_COMMAND);
            message.success('已复制清理命令，请在终端执行');
        } catch (e) {
            message.error('复制失败，请手动复制下方命令');
        } finally {
            setLoading(false);
        }
    };

    const isConfigured = currentEnv === EXPECTED_URL;

    return (
        <Card
            title={
                <Space>
                    <CodeOutlined style={{ color: '#1890ff' }} />
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
                        icon={<CopyOutlined />}
                        onClick={handleSetEnv}
                        loading={loading}
                        style={{ borderRadius: 6, background: '#1890ff', borderColor: '#1890ff' }}
                    >
                        复制配置命令
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

                <Paragraph
                    copyable={{ text: SET_ENV_COMMAND }}
                    style={{
                        margin: 0,
                        fontSize: 11,
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        whiteSpace: 'pre-wrap',
                        color: 'rgba(255,255,255,0.75)'
                    }}
                >
                    {SET_ENV_COMMAND}
                </Paragraph>

                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
                    <ExclamationCircleOutlined style={{ marginRight: 4 }} />
                    在 <Text type="warning" style={{ fontSize: 11 }}>Claude Code 所在终端</Text> 执行后才会生效
                </div>
            </Space>
        </Card>
    );
}

export default EnvConfig;

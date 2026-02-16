/**
 * 服务状态栏组件
 * 增强视觉反馈和交互动画
 */
import { Space, Button, Typography, Tooltip } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { useState } from 'react';

const { Text } = Typography;

interface StatusBarProps {
    status: {
        running: boolean;
        port: number;
    };
    loading?: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
}

function StatusBar({ status, loading = false, onStart, onStop, onRestart }: StatusBarProps) {
    const [copied, setCopied] = useState(false);

    const proxyUrl = `http://127.0.0.1:${status.port}`;

    // 复制地址
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(proxyUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // 降级方案
            const input = document.createElement('input');
            input.value = proxyUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="fade-in">
            {/* 状态卡片 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: status.running
                    ? 'linear-gradient(135deg, rgba(82, 196, 26, 0.12) 0%, rgba(82, 196, 26, 0.04) 100%)'
                    : 'linear-gradient(135deg, rgba(255, 77, 79, 0.12) 0%, rgba(255, 77, 79, 0.04) 100%)',
                borderRadius: 10,
                border: `1px solid ${status.running ? 'rgba(82, 196, 26, 0.25)' : 'rgba(255, 77, 79, 0.25)'}`,
                marginBottom: 16,
                transition: 'all 0.3s ease',
            }}>
                <Space size="middle">
                    {/* 状态指示器 */}
                    <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: status.running
                            ? 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)'
                            : 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: status.running
                            ? '0 4px 12px rgba(82, 196, 26, 0.3)'
                            : '0 4px 12px rgba(255, 77, 79, 0.3)',
                        transition: 'all 0.3s ease',
                    }}>
                        <div style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: '#fff',
                            animation: status.running ? 'pulse 2s ease-in-out infinite' : 'none',
                        }} />
                    </div>

                    <div>
                        <Text style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: status.running ? '#52c41a' : '#ff4d4f',
                            display: 'block',
                            lineHeight: 1.3,
                        }}>
                            {status.running ? '运行中' : '已停止'}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                            代理服务器 · 端口 {status.port}
                        </Text>
                    </div>
                </Space>

                {/* 操作按钮 */}
                <Space className="action-group">
                    {status.running ? (
                        <>
                            <Tooltip title="重启服务">
                                <Button
                                    icon={<ReloadOutlined className={loading ? 'spin-icon' : ''} />}
                                    onClick={onRestart}
                                    loading={loading}
                                    style={{ borderRadius: 8 }}
                                >
                                    重启
                                </Button>
                            </Tooltip>
                            <Tooltip title="停止服务">
                                <Button
                                    danger
                                    icon={<PauseCircleOutlined />}
                                    onClick={onStop}
                                    loading={loading}
                                    style={{ borderRadius: 8 }}
                                >
                                    停止
                                </Button>
                            </Tooltip>
                        </>
                    ) : (
                        <Button
                            type="primary"
                            size="large"
                            icon={<PlayCircleOutlined />}
                            onClick={onStart}
                            loading={loading}
                            style={{
                                borderRadius: 8,
                                height: 44,
                                paddingLeft: 24,
                                paddingRight: 24,
                                fontWeight: 500,
                            }}
                        >
                            启动服务
                        </Button>
                    )}
                </Space>
            </div>

            {/* 配置提示 */}
            <div className="info-box" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
            }}>
                <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                        将 Claude Code 的 API endpoint 设置为:
                    </Text>
                    <Text
                        code
                        style={{
                            fontSize: 13,
                            padding: '4px 10px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: 4,
                        }}
                    >
                        {proxyUrl}
                    </Text>
                </div>
                <Tooltip title={copied ? '已复制!' : '复制地址'}>
                    <Button
                        type="text"
                        icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
                        onClick={handleCopy}
                        style={{
                            borderRadius: 6,
                            transition: 'all 0.2s ease',
                        }}
                    />
                </Tooltip>
            </div>
        </div>
    );
}

export default StatusBar;

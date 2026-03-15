/**
 * 主应用组件
 * 优化版：使用自定义 hooks、减少重复渲染、增强视觉效果
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout, Card, Row, Col, Typography, Space, Tag, message, Button, Tooltip, Dropdown, ConfigProvider, theme, Skeleton } from 'antd';
import {
    ApiOutlined, SettingOutlined, FileTextOutlined,
    ExportOutlined, ImportOutlined, MoreOutlined,
    EyeOutlined, EyeInvisibleOutlined, ThunderboltOutlined,
    CloudServerOutlined, CopyOutlined
} from '@ant-design/icons';
import EnvConfig from './components/EnvConfig';
import Settings from './components/Settings';

import StatusBar from './components/StatusBar';
import ModelMapping from './components/ModelMapping';
import ModelRoutes from './components/ModelRoutes';
import ProviderConfig from './components/ProviderConfig';
import LogViewer from './components/LogViewer';
import FloatBall from './components/FloatBall';
import { useProxyStatus, useLogs } from './hooks';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
const APP_FONT_FAMILY = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// 卡片通用样式
const cardStyle = {
    background: 'rgba(15, 23, 42, 0.45)',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    borderRadius: 12,
    backdropFilter: 'blur(6px)',
};

const cardHeadStyle = {
    borderBottom: '1px solid rgba(255,255,255,0.08)',
};

function App() {
    // 使用自定义 hooks
    const { status: proxyStatus, loading: proxyLoading, start, stop, restart } = useProxyStatus({
        pollInterval: 5000,
        backgroundPollInterval: 30000,
        fastPollCount: 3,
        fastPollInterval: 1000,
    });
    const { logs, clearLogs } = useLogs({ maxLogs: 200, autoScroll: false });
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const isDesktopRuntime = typeof window !== 'undefined' && window.location.protocol === 'file:';

    // 检查是否是悬浮球模式
    const isFloatMode = window.location.hash === '#/float';
    if (isFloatMode) {
        return <FloatBall />;
    }

    // 启动代理
    const handleStart = useCallback(async () => {
        const result = await start();
        if (result.success) {
            message.success(`代理服务器已启动 (端口: ${result.port})`);
        } else {
            message.error(result.error || '启动失败');
        }
    }, [start]);

    // 停止代理
    const handleStop = useCallback(async () => {
        await stop();
        message.success('代理服务器已停止');
    }, [stop]);

    // 重启代理
    const handleRestart = useCallback(async () => {
        const result = await restart();
        if (result.success) {
            message.success('代理服务器已重启');
        } else {
            message.error(result.error || '重启失败');
        }
    }, [restart]);

    // 导出配置
    const handleExport = useCallback(async () => {
        const result = await window.electronAPI.exportConfig();
        if (result.success) {
            message.success('配置已导出');
        } else if (result.error !== '已取消') {
            message.error('导出失败: ' + result.error);
        }
    }, []);

    // 导入配置
    const handleImport = useCallback(async () => {
        const result = await window.electronAPI.importConfig();
        if (result.success) {
            message.success('配置已导入，页面将刷新');
            setTimeout(() => window.location.reload(), 500);
        } else if (result.error !== '已取消') {
            message.error('导入失败: ' + result.error);
        }
    }, []);

    // 悬浮球控制
    const showFloatWindow = useCallback(() => {
        window.electronAPI.showFloatWindow?.();
    }, []);
    const hideFloatWindow = useCallback(() => {
        window.electronAPI.hideFloatWindow?.();
    }, []);
    const handleCopyProxyUrl = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(`http://127.0.0.1:${proxyStatus.port}`);
            message.success('代理地址已复制');
        } catch {
            message.error('复制失败');
        }
    }, [proxyStatus.port]);

    // 初始加载状态
    useEffect(() => {
        const timerId = window.setTimeout(() => setIsInitialLoad(false), 300);

        return () => {
            window.clearTimeout(timerId);
        };
    }, []);

    // 更多菜单
    const moreMenuItems = useMemo(() => {
        const items: any[] = [
            { key: 'export', label: '导出配置', icon: <ExportOutlined />, onClick: handleExport },
            { key: 'import', label: '导入配置', icon: <ImportOutlined />, onClick: handleImport },
        ];

        if (isDesktopRuntime) {
            items.push(
                { type: 'divider' as const },
                { key: 'showFloat', label: '显示悬浮球', icon: <EyeOutlined />, onClick: showFloatWindow },
                { key: 'hideFloat', label: '隐藏悬浮球', icon: <EyeInvisibleOutlined />, onClick: hideFloatWindow },
            );
        }

        return items;
    }, [handleExport, handleImport, isDesktopRuntime, showFloatWindow, hideFloatWindow]);

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorPrimary: '#1890ff',
                    borderRadius: 8,
                    colorBgContainer: '#1f1f1f',
                    colorBgElevated: '#252525',
                    fontFamily: APP_FONT_FAMILY,
                }
            }}
        >
            <Layout style={{
                height: '100dvh',
                background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #16213e 100%)',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* 背景噪点纹理 */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                    opacity: 0.03,
                    pointerEvents: 'none',
                    zIndex: 0,
                }} />

                {/* 顶部标题栏 */}
                <Header style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    backdropFilter: 'blur(12px)',
                    padding: '0 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    height: 64,
                    lineHeight: 'normal',
                    flexShrink: 0,
                    position: 'sticky',
                    top: 0,
                    zIndex: 100
                }}>
                    <Space size="middle">
                        <div style={{
                            width: 42,
                            height: 42,
                            background: 'linear-gradient(135deg, #1890ff 0%, #0050b3 100%)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 16px rgba(24, 144, 255, 0.35)',
                            transition: 'transform 0.2s ease',
                        }}>
                            <ThunderboltOutlined style={{ fontSize: 22, color: '#fff' }} />
                        </div>
                        <div>
                            <Title level={4} style={{ margin: 0, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                                Claude Proxy
                            </Title>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                API 代理与模型切换
                            </Text>
                        </div>
                    </Space>

                    <Space size="middle">
                        <Tag
                            icon={proxyStatus.running ? <CloudServerOutlined /> : null}
                            color={proxyStatus.running ? 'success' : 'default'}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 20,
                                background: proxyStatus.running ? 'rgba(82, 196, 26, 0.12)' : 'rgba(255,255,255,0.08)',
                                border: proxyStatus.running ? '1px solid rgba(82, 196, 26, 0.3)' : '1px solid rgba(255,255,255,0.1)',
                                fontSize: 13,
                                fontWeight: 500,
                                transition: 'all 0.3s ease',
                            }}
                        >
                            {proxyStatus.running ? `运行中 · 端口 ${proxyStatus.port}` : '已停止'}
                        </Tag>
                        {isDesktopRuntime && (
                            <Tooltip title="悬浮球">
                                <Button
                                    type="text"
                                    icon={<EyeOutlined style={{ color: 'rgba(255,255,255,0.65)' }} />}
                                    onClick={showFloatWindow}
                                    style={{ borderRadius: 8 }}
                                />
                            </Tooltip>
                        )}
                        <Dropdown menu={{ items: moreMenuItems }} trigger={['click']}>
                            <Button
                                type="text"
                                icon={<MoreOutlined style={{ color: 'rgba(255,255,255,0.65)' }} />}
                                style={{ borderRadius: 8 }}
                            />
                        </Dropdown>
                    </Space>
                </Header>

                <Content style={{
                    padding: '20px clamp(12px, 2.2vw, 28px) 24px',
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    overscrollBehavior: 'contain',
                    position: 'relative',
                    zIndex: 1
                }}>
                    {isInitialLoad ? (
                        // 骨架屏
                        <div style={{ maxWidth: 1480, margin: '0 auto' }}>
                            <Row gutter={[20, 20]}>
                                <Col xs={24} lg={13}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={20}>
                                        <Card style={cardStyle}>
                                            <Skeleton active paragraph={{ rows: 3 }} />
                                        </Card>
                                        <Card style={cardStyle}>
                                            <Skeleton active paragraph={{ rows: 4 }} />
                                        </Card>
                                    </Space>
                                </Col>
                                <Col xs={24} lg={12}>
                                    <Card style={cardStyle}>
                                        <Skeleton active paragraph={{ rows: 8 }} />
                                    </Card>
                                </Col>
                            </Row>
                        </div>
                    ) : (
                        <div style={{ maxWidth: 1480, margin: '0 auto' }}>
                            <Row gutter={[20, 20]} className="fade-in">
                                {/* 左侧 */}
                                <Col xs={24} lg={12}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={20}>
                                        {/* 服务状态卡片 */}
                                        <Card
                                            title={
                                                <Space>
                                                    <ApiOutlined style={{ color: '#1890ff' }} />
                                                    <span>服务状态</span>
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                        >
                                            <StatusBar
                                                status={proxyStatus}
                                                loading={proxyLoading}
                                                onStart={handleStart}
                                                onStop={handleStop}
                                                onRestart={handleRestart}
                                            />
                                        </Card>

                                        {/* 模型映射卡片 */}
                                        <Card
                                            title={
                                                <Space>
                                                    <SettingOutlined style={{ color: '#52c41a' }} />
                                                    <span>模型路由 / 默认回退</span>
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                        >
                                            <ModelMapping />
                                        </Card>

                                        {/* 环境变量配置 */}
                                        <EnvConfig />

                                        {/* 系统设置 */}
                                        <Settings />

                                        {/* 日志面板 */}
                                        <Card
                                            title={
                                                <Space>
                                                    <FileTextOutlined style={{ color: '#faad14' }} />
                                                    <span>请求日志</span>
                                                    {logs.length > 0 && (
                                                        <Tag style={{
                                                            marginLeft: 8,
                                                            fontSize: 11,
                                                            padding: '0 6px',
                                                            borderRadius: 10,
                                                        }}>
                                                            {logs.length}
                                                        </Tag>
                                                    )}
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                        >
                                            <LogViewer logs={logs} onClear={clearLogs} />
                                        </Card>
                                    </Space>
                                </Col>

                                {/* 右侧 */}
                                <Col xs={24} lg={11}>
                                    <Space direction="vertical" style={{ width: '100%' }} size={20}>
                                        <Card
                                            title={
                                                <Space>
                                                    <SettingOutlined style={{ color: '#722ed1' }} />
                                                    <span>模型路由配置</span>
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                        >
                                            <ModelRoutes />
                                        </Card>

                                        <Card
                                            title={
                                                <Space>
                                                    <SettingOutlined style={{ color: '#13c2c2' }} />
                                                    <span>自定义 Provider 配置</span>
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                            bodyStyle={{ maxHeight: 'calc(100dvh - 460px)', overflowY: 'auto' }}
                                        >
                                            <ProviderConfig />
                                        </Card>

                                        <Card
                                            title={
                                                <Space>
                                                    <ApiOutlined style={{ color: '#22c55e' }} />
                                                    <span>快捷操作</span>
                                                </Space>
                                            }
                                            size="small"
                                            style={cardStyle}
                                            headStyle={cardHeadStyle}
                                        >
                                            <Space direction="vertical" style={{ width: '100%' }} size={14}>
                                                <div style={{ display: 'flex', gap: 10 }}>
                                                    <Button
                                                        icon={<ExportOutlined />}
                                                        onClick={handleExport}
                                                        style={{ flex: 1 }}
                                                    >
                                                        导出配置
                                                    </Button>
                                                    <Button
                                                        type="primary"
                                                        icon={<ImportOutlined />}
                                                        onClick={handleImport}
                                                        style={{ flex: 1 }}
                                                    >
                                                        导入配置
                                                    </Button>
                                                </div>

                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: 10,
                                                }}>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        当前代理入口
                                                    </Text>
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<CopyOutlined />}
                                                        onClick={handleCopyProxyUrl}
                                                    />
                                                </div>

                                                <Text
                                                    code
                                                    style={{
                                                        display: 'block',
                                                        background: 'rgba(0,0,0,0.35)',
                                                        border: '1px solid rgba(255,255,255,0.1)',
                                                        borderRadius: 8,
                                                        padding: '8px 10px',
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    {`http://127.0.0.1:${proxyStatus.port}`}
                                                </Text>
                                            </Space>
                                        </Card>
                                    </Space>
                                </Col>
                            </Row>
                        </div>
                    )}
                </Content>

                <Footer style={{
                    textAlign: 'center',
                    background: 'transparent',
                    padding: '16px 24px',
                    color: 'rgba(255,255,255,0.2)',
                    fontSize: 12,
                    position: 'relative',
                    zIndex: 1,
                }}>
                    Claude Proxy v1.0.0 · Web + React + Ant Design
                </Footer>
            </Layout>
        </ConfigProvider>
    );
}

export default App;

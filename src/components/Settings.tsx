import { useState, useEffect } from 'react';
import { Card, Switch, Space, Typography, message } from 'antd';
import { SettingOutlined, RocketOutlined } from '@ant-design/icons';

const { Text } = Typography;

function Settings() {
    const [autoLaunch, setAutoLaunch] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadAutoLaunch();
    }, []);

    const loadAutoLaunch = async () => {
        try {
            const enabled = await window.electronAPI.getAutoLaunch();
            setAutoLaunch(enabled);
        } catch (error) {
            console.error('获取开机自启状态失败:', error);
        }
    };

    const handleAutoLaunchChange = async (checked: boolean) => {
        setLoading(true);
        try {
            await window.electronAPI.setAutoLaunch(checked);
            setAutoLaunch(checked);
            message.success(checked ? '已开启开机自启' : '已关闭开机自启');
        } catch (error: any) {
            message.error('设置失败: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card
            title={
                <Space>
                    <SettingOutlined style={{ color: '#1890ff' }} />
                    <span>系统设置</span>
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
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                        <RocketOutlined style={{ fontSize: 16, color: '#1890ff' }} />
                        <div>
                            <Text strong style={{ display: 'block' }}>开机自启</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                系统启动时自动运行应用
                            </Text>
                        </div>
                    </Space>
                    <Switch
                        checked={autoLaunch}
                        onChange={handleAutoLaunchChange}
                        loading={loading}
                    />
                </div>
            </Space>
        </Card>
    );
}

export default Settings;

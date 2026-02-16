import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/index.css';
import { installWebElectronAPI } from './services/web-electron-api';

const APP_FONT_FAMILY = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// 在 Web 模式注入 electronAPI 兼容层，复用现有前端调用方式
installWebElectronAPI();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ConfigProvider
            locale={zhCN}
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorPrimary: '#1890ff',
                    borderRadius: 6,
                    fontFamily: APP_FONT_FAMILY,
                },
            }}
        >
            <App />
        </ConfigProvider>
    </React.StrictMode>
);

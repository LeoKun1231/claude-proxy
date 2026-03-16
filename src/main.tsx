import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { installWebElectronAPI } from './services/web-electron-api';
import { Toaster } from 'sonner';

installWebElectronAPI();

if (typeof document !== 'undefined') {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <div className="dark app-theme">
            <App />
            <Toaster theme="dark" position="bottom-right" richColors />
        </div>
    </React.StrictMode>
);

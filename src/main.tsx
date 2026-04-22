import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { installDesktopTauriAPI } from './services/desktop-api';
import { Toaster } from 'sonner';

if (typeof document !== 'undefined') {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
}

async function bootstrap() {
    await installDesktopTauriAPI();

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <div className="dark app-theme">
                <App />
                <Toaster theme="dark" position="bottom-right" richColors />
            </div>
        </React.StrictMode>
    );
}

void bootstrap();

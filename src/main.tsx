import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { installDesktopTauriAPI } from './services/desktop-api';

async function bootstrap() {
    await installDesktopTauriAPI();

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}

void bootstrap();

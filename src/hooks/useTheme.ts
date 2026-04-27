import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

let cachedTheme: Theme | null = null;

function applyThemeClass(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
}

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(cachedTheme || 'dark');

    const loadTheme = useCallback(async () => {
        if (window.electronAPI) {
            try {
                const config = await window.electronAPI.getAllConfig();
                const t = config?.settings?.theme === 'light' ? 'light' : 'dark';
                cachedTheme = t;
                setTheme(t);
                applyThemeClass(t);
                return;
            } catch {}
        }
        // fallback: localStorage for non-Tauri env
        const stored = localStorage.getItem('app-theme');
        const t: Theme = stored === 'light' ? 'light' : 'dark';
        cachedTheme = t;
        setTheme(t);
        applyThemeClass(t);
    }, []);

    useEffect(() => {
        loadTheme();
        if (!window.electronAPI?.onConfigUpdated) return;
        const handler = ({ key }: { key: string }) => {
            if (key === 'all' || key === 'settings.theme' || key === 'settings') {
                loadTheme();
            }
        };
        window.electronAPI.onConfigUpdated(handler);
        return () => {
            window.electronAPI.removeConfigUpdatedListener?.(handler);
        };
    }, [loadTheme]);

    const setThemeValue = useCallback(async (next: Theme) => {
        cachedTheme = next;
        setTheme(next);
        applyThemeClass(next);
        if (window.electronAPI) {
            try {
                await window.electronAPI.setConfig('settings.theme', next);
            } catch {}
        } else {
            localStorage.setItem('app-theme', next);
        }
    }, []);

    const toggleTheme = useCallback(() => {
        void setThemeValue(theme === 'dark' ? 'light' : 'dark');
    }, [theme, setThemeValue]);

    return { theme, setTheme: setThemeValue, toggleTheme };
}

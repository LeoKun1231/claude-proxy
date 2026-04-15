import { useCallback } from 'react';
import DesktopWorkbench from './components/DesktopWorkbench';
import FloatBall from './components/FloatBall';
import { useLogs, useProxyStatus } from './hooks';
import { toast } from 'sonner';

const QUICK_COMMAND = [
    'unset ANTHROPIC_AUTH_TOKEN',
    'export ANTHROPIC_BASE_URL=http://127.0.0.1:5055',
    'export ANTHROPIC_API_KEY=sk-local-proxy',
].join('\n');

export default function App() {
    const { status: proxyStatus, loading: proxyLoading, start, stop, restart } = useProxyStatus({
        pollInterval: 5000,
        backgroundPollInterval: 30000,
        fastPollCount: 3,
        fastPollInterval: 1000,
    });
    const { logs, clearLogs } = useLogs({ maxLogs: 200, autoScroll: false });
    const isFloatMode = typeof window !== 'undefined' && window.location.hash === '#/float';
    const isDesktopRuntime = typeof window !== 'undefined'
        && (import.meta.env.VITE_DESKTOP_RUNTIME === 'tauri' || '__TAURI_INTERNALS__' in window);

    const handleStart = useCallback(async () => {
        const result = await start();
        if (result.success) {
            if (result.alreadyRunning) toast.info(`代理已在端口 ${result.port} 运行`);
            else toast.success(`已在端口 ${result.port} 启动`);
            return;
        }
        toast.error('启动失败: ' + result.error);
    }, [start]);

    const handleStop = useCallback(async () => {
        await stop();
        toast.info('代理已停止');
    }, [stop]);

    const handleRestart = useCallback(async () => {
        const result = await restart();
        result.success ? toast.success('重启成功') : toast.error('重启失败: ' + result.error);
    }, [restart]);

    const handleExport = useCallback(async () => {
        if (!window.electronAPI?.exportConfig) return;
        const result = await window.electronAPI.exportConfig();
        if (result.success) toast.success('配置已导出');
        else if (result.error !== '已取消') toast.error('导出失败: ' + result.error);
    }, []);

    const handleImport = useCallback(async () => {
        if (!window.electronAPI?.importConfig) return;
        const result = await window.electronAPI.importConfig();
        if (result.success) {
            toast.success('配置已导入');
            setTimeout(() => window.location.reload(), 500);
        } else if (result.error !== '已取消') {
            toast.error('导入失败: ' + result.error);
        }
    }, []);

    const handleCopyProxyUrl = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(`http://127.0.0.1:${proxyStatus.port}`);
            toast.success('代理地址已复制');
        } catch {
            toast.error('复制失败');
        }
    }, [proxyStatus.port]);

    const handleCopyCommand = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(QUICK_COMMAND.replace('5055', String(proxyStatus.port)));
            toast.success('命令已复制');
        } catch {
            toast.error('复制失败');
        }
    }, [proxyStatus.port]);

    if (isFloatMode) return <FloatBall />;

    return (
        <DesktopWorkbench
            isDesktopRuntime={isDesktopRuntime}
            proxyStatus={proxyStatus}
            proxyLoading={proxyLoading}
            logs={logs}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
            onClearLogs={clearLogs}
            onCopyProxyUrl={handleCopyProxyUrl}
            onCopyCommand={handleCopyCommand}
            onExport={handleExport}
            onImport={handleImport}
        />
    );
}

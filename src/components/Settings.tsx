import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cable, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { DEFAULT_PROXY_PORT } from '@/types/config';

export default function AppSettings() {
    const [autoLaunch, setAutoLaunch] = useState(false);
    const [proxyPort, setProxyPort] = useState(DEFAULT_PROXY_PORT);
    const [proxyPortDraft, setProxyPortDraft] = useState(String(DEFAULT_PROXY_PORT));
    const [proxyRunning, setProxyRunning] = useState(false);
    const [loadingAutoLaunch, setLoadingAutoLaunch] = useState(false);
    const [loadingProxyPort, setLoadingProxyPort] = useState(false);

    const loadSettings = useCallback(async () => {
        try {
            const [config, status] = await Promise.all([
                window.electronAPI?.getAllConfig?.(),
                window.electronAPI?.getProxyStatus?.(),
            ]);
            const nextPort = Number(config?.settings?.proxyPort);
            setAutoLaunch(Boolean(config?.settings?.autoLaunch));
            if (Number.isInteger(nextPort) && nextPort > 0) {
                setProxyPort(nextPort);
                setProxyPortDraft(String(nextPort));
            } else {
                setProxyPort(DEFAULT_PROXY_PORT);
                setProxyPortDraft(String(DEFAULT_PROXY_PORT));
            }
            setProxyRunning(Boolean(status?.running));
        } catch {
            // 加载失败时保留当前界面状态
        }
    }, []);

    useEffect(() => {
        void loadSettings();
        const timer = window.setInterval(() => {
            void loadSettings();
        }, 5000);

        let handler: ((payload: { key: string }) => void) | undefined;
        if (window.electronAPI?.onConfigUpdated) {
            handler = ({ key }: { key: string }) => {
                if (
                    key === 'all'
                    || key === 'settings'
                    || key === 'settings.autoLaunch'
                    || key === 'settings.proxyPort'
                ) {
                    void loadSettings();
                }
            };
            window.electronAPI.onConfigUpdated(handler);
        }

        return () => {
            window.clearInterval(timer);
            if (handler) {
                window.electronAPI.removeConfigUpdatedListener?.(handler);
            }
        };
    }, [loadSettings]);

    const toggle = async (checked: boolean) => {
        setLoadingAutoLaunch(true);
        try {
            await window.electronAPI?.setAutoLaunch?.(checked);
            setAutoLaunch(checked);
            toast.success(checked ? '开机自启已启用' : '开机自启已禁用');
        } catch (e: any) { toast.error(e?.message || '设置失败'); }
        finally { setLoadingAutoLaunch(false); }
    };

    const parsedProxyPort = Number.parseInt(proxyPortDraft, 10);
    const isProxyPortValid = Number.isInteger(parsedProxyPort) && parsedProxyPort >= 1 && parsedProxyPort <= 65535;
    const proxyPortChanged = isProxyPortValid && parsedProxyPort !== proxyPort;
    const proxyPortHint = useMemo(() => {
        if (!proxyPortDraft.trim()) return '请输入 1 到 65535 之间的端口。';
        if (!isProxyPortValid) return '端口范围必须在 1 到 65535 之间。';
        if (proxyRunning && parsedProxyPort !== proxyPort) return '代理正在运行，保存后需点击“重启代理”才会切换到新端口。';
        return `当前配置端口：${proxyPort}`;
    }, [isProxyPortValid, parsedProxyPort, proxyPort, proxyPortDraft, proxyRunning]);

    const saveProxyPort = async () => {
        if (!isProxyPortValid) {
            toast.error('请输入有效端口，范围 1 到 65535');
            return;
        }
        if (!proxyPortChanged) return;

        setLoadingProxyPort(true);
        try {
            await window.electronAPI?.setConfig?.('settings.proxyPort', parsedProxyPort);
            setProxyPort(parsedProxyPort);
            setProxyPortDraft(String(parsedProxyPort));
            toast.success(
                proxyRunning
                    ? `监听端口已保存为 ${parsedProxyPort}，重启代理后生效`
                    : `监听端口已更新为 ${parsedProxyPort}`,
            );
        } catch (e: any) {
            toast.error(e?.message || '端口保存失败');
        } finally {
            setLoadingProxyPort(false);
        }
    };

    if (!window.electronAPI) return null;

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-[24px] font-normal tracking-[0px] text-foreground">系统设置</h3>
                <p className="text-[18px] text-muted-foreground mt-1 leading-relaxed">桌面应用偏好设置</p>
            </div>

            <div className="flex items-center justify-between border border-[rgba(226,226,226,0.35)] rounded-[12px] p-6 bg-transparent">
                <div className="flex items-center gap-4">
                    <Rocket className="w-5 h-5 text-muted-foreground" />
                    <div>
                        <p className="text-[16px] font-medium text-foreground tracking-tight">开机时启动</p>
                        <p className="text-[14px] text-muted-foreground mt-0.5">在系统启动时自动运行代理服务</p>
                    </div>
                </div>
                <Switch checked={autoLaunch} onCheckedChange={toggle} disabled={loadingAutoLaunch} />
            </div>

            <div className="border border-[rgba(226,226,226,0.35)] rounded-[12px] p-6 bg-transparent space-y-4">
                <div className="flex items-start gap-4">
                    <Cable className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-medium text-foreground tracking-tight">代理监听端口</p>
                        <p className="text-[14px] text-muted-foreground mt-0.5">
                            自定义桌面代理绑定的本地端口。命令行配置、状态栏和启动逻辑都会使用这里的值。
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="flex-1 space-y-2">
                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">
                            监听端口
                        </label>
                        <Input
                            type="number"
                            min={1}
                            max={65535}
                            inputMode="numeric"
                            value={proxyPortDraft}
                            onChange={(event) => setProxyPortDraft(event.target.value)}
                            placeholder={String(DEFAULT_PROXY_PORT)}
                            className="h-10 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px]"
                        />
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                            {proxyPortHint}
                        </p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 px-5 border-[rgba(226,226,226,0.35)] rounded-[50px] shadow-none hover:bg-[rgba(255,255,255,0.04)]"
                        disabled={!proxyPortChanged || !isProxyPortValid || loadingProxyPort}
                        onClick={saveProxyPort}
                    >
                        保存端口
                    </Button>
                </div>
            </div>
        </div>
    );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Icon } from '@iconify/react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { useTheme } from '@/hooks';
import { DEFAULT_PROXY_PORT } from '@/types/config';

export default function AppSettings() {
    const [autoLaunch, setAutoLaunch] = useState(false);
    const [proxyPort, setProxyPort] = useState(DEFAULT_PROXY_PORT);
    const [proxyPortDraft, setProxyPortDraft] = useState(String(DEFAULT_PROXY_PORT));
    const [proxyRunning, setProxyRunning] = useState(false);
    const [loadingAutoLaunch, setLoadingAutoLaunch] = useState(false);
    const [loadingProxyPort, setLoadingProxyPort] = useState(false);
    const { theme, setTheme } = useTheme();

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
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <div className="rounded-[24px] border border-border/40 bg-gradient-to-br from-card/60 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-md mb-6">
                <h3 className="text-[24px] font-medium tracking-tight text-foreground flex items-center gap-2">
                    <Icon icon="ph:gear-six-bold" className="text-primary/80" /> 系统设置
                </h3>
                <p className="text-[15px] text-muted-foreground/80 mt-1.5 leading-relaxed">
                    桌面应用偏好设置
                </p>
            </div>

            <div className="flex items-center justify-between border border-border/40 rounded-[20px] p-6 bg-gradient-to-r from-muted/20 to-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-muted/30 transition-all hover:border-border/80 group">
                <div className="flex items-center gap-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-primary/10 text-primary border border-primary/20 shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <Icon icon="ph:rocket-launch-bold" className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-[17px] font-medium text-foreground tracking-tight">开机时启动</p>
                        <p className="text-[14px] text-muted-foreground/80 mt-1">在系统启动时自动运行代理服务</p>
                    </div>
                </div>
                <Switch checked={autoLaunch} onCheckedChange={toggle} disabled={loadingAutoLaunch} className="data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
            </div>

            <div className="flex items-center justify-between border border-border/40 rounded-[20px] p-6 bg-gradient-to-r from-muted/20 to-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-muted/30 transition-all hover:border-border/80 group">
                <div className="flex items-center gap-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-background text-foreground border border-border/50 shadow-sm group-hover:scale-110 transition-transform duration-300">
                        {theme === 'dark' ? (
                            <Icon icon="ph:moon-bold" className="w-6 h-6" />
                        ) : (
                            <Icon icon="ph:sun-bold" className="w-6 h-6" />
                        )}
                    </div>
                    <div>
                        <p className="text-[17px] font-medium text-foreground tracking-tight">亮色主题</p>
                        <p className="text-[14px] text-muted-foreground/80 mt-1">切换应用亮色 / 暗色外观</p>
                    </div>
                </div>
                <Switch
                    checked={theme === 'light'}
                    onCheckedChange={(checked) => setTheme(checked ? 'light' : 'dark')}
                    className="data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                />
            </div>

            <div className="border border-border/40 rounded-[20px] p-7 bg-gradient-to-r from-muted/20 to-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-border/80 transition-colors space-y-6 group">
                <div className="flex items-start gap-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-secondary text-secondary-foreground border border-border/50 shadow-sm group-hover:scale-110 transition-transform duration-300">
                        <Icon icon="ph:plugs-connected-bold" className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-[17px] font-medium text-foreground tracking-tight">代理监听端口</p>
                        <p className="text-[14px] text-muted-foreground/80 mt-1 leading-relaxed max-w-2xl">
                            自定义桌面代理绑定的本地端口。命令行配置、状态栏和启动逻辑都会使用这里的值。
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-4 md:flex-row md:items-end pl-[68px]">
                    <div className="flex-1 space-y-2.5">
                        <label className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[1.5px] ml-1">
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
                            className="h-11 text-[15px] font-mono bg-background/50 border-border/50 rounded-xl backdrop-blur-sm shadow-sm focus-visible:ring-primary/30"
                        />
                        <p className="text-[13px] text-muted-foreground/80 leading-relaxed font-medium mt-2">
                            {proxyPortHint}
                        </p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-11 px-6 border-border/60 rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-medium"
                        disabled={!proxyPortChanged || !isProxyPortValid || loadingProxyPort}
                        onClick={saveProxyPort}
                    >
                        <Icon icon="ph:floppy-disk-bold" className="mr-2 h-4 w-4" />
                        保存端口
                    </Button>
                </div>
            </div>
        </div>
    );
}

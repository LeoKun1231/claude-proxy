import { useState, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DEFAULT_PROXY_PORT } from '@/types/config';

export default function EnvConfig() {
    const [apiKey, setApiKey] = useState('sk-local-proxy');
    const [port, setPort] = useState(DEFAULT_PROXY_PORT);

    useEffect(() => {
        const loadPort = async () => {
            try {
                const status = await window.electronAPI?.getProxyStatus?.();
                const nextPort = Number(status?.port);
                if (Number.isInteger(nextPort) && nextPort > 0) {
                    setPort(nextPort);
                }
            } catch {
                // 配置加载失败时保持默认端口
            }
        };

        void loadPort();
        const timer = window.setInterval(() => {
            void loadPort();
        }, 5000);

        let handler: ((payload: { key: string }) => void) | undefined;
        if (window.electronAPI?.onConfigUpdated) {
            handler = ({ key }: { key: string }) => {
                if (key === 'all' || key === 'settings.proxyPort' || key === 'settings') {
                    void loadPort();
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
    }, []);

    const commands = `unset ANTHROPIC_AUTH_TOKEN\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:${port}\nexport ANTHROPIC_API_KEY=${apiKey}`;

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(commands);
            toast.success('已复制到剪贴板');
        } catch { toast.error('复制失败'); }
    }, [commands]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 fill-mode-both">
            <div className="flex items-center justify-between rounded-[24px] border border-border/40 bg-gradient-to-br from-card/60 to-transparent p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-md mb-6">
                <div className="space-y-1.5">
                    <h3 className="text-[24px] font-medium tracking-tight text-foreground flex items-center gap-2">
                        <Icon icon="ph:terminal-window-bold" className="text-primary/80" /> 命令行配置
                    </h3>
                    <p className="text-[15px] text-muted-foreground/80 leading-relaxed max-w-xl">
                        用于 Claude Code 或其他终端工具的环境变量
                    </p>
                </div>
            </div>

            <div className="w-full space-y-2 mt-6">
                <label className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[1.5px] ml-1">API 密钥</label>
                <Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-11 text-[14px] font-mono bg-background/50 backdrop-blur-sm border-border/50 rounded-xl focus-visible:ring-primary/30 transition-colors hover:border-border/80" />
            </div>

            <div className="relative border border-border/40 rounded-[20px] bg-gradient-to-br from-muted/20 to-transparent p-6 group shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-[40px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <pre className="text-[14px] font-mono text-muted-foreground/90 whitespace-pre-wrap leading-relaxed relative z-10 selection:bg-primary/20">{commands}</pre>
                <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-4 right-4 h-9 w-9 cursor-pointer rounded-xl transition-all opacity-0 group-hover:opacity-100 bg-background/80 backdrop-blur-md hover:bg-background text-foreground hover:text-primary shadow-sm border border-border/40 z-20"
                    onClick={copy}
                >
                    <Icon icon="ph:copy-bold" className="w-4.5 h-4.5" />
                </Button>
            </div>

            <div className="pt-2">
                <Button size="sm" variant="outline" onClick={copy} className="h-11 px-6 rounded-xl border-border/60 bg-transparent shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-medium">
                    <Icon icon="ph:copy-bold" className="w-4.5 h-4.5 mr-2" /> 复制命令
                </Button>
            </div>
        </div>
    );
}

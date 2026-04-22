import { useState, useCallback, useEffect } from 'react';
import { Copy } from 'lucide-react';
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
        <div className="space-y-4">
            <div>
                <h3 className="text-[24px] font-normal tracking-[0px] text-foreground">命令行配置</h3>
                <p className="text-[18px] text-muted-foreground mt-1 leading-relaxed">用于 Claude Code 的环境变量</p>
            </div>

            <div className="w-full space-y-2 mt-6">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-[1.4px]">API 密钥</label>
                <Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-10 text-[14px] font-mono bg-black/20 border-[rgba(226,226,226,0.15)] rounded-[8px] focus-visible:ring-1 focus-visible:ring-[rgba(226,226,226,0.35)]" />
            </div>

            <div className="relative border border-[rgba(226,226,226,0.35)] rounded-[12px] bg-black/20 p-6 group">
                <pre className="text-[14px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">{commands}</pre>
                <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-3 right-3 h-8 w-8 cursor-pointer rounded-full transition-all opacity-0 group-hover:opacity-100 bg-white/[0.05] hover:bg-white/[0.1] text-foreground"
                    onClick={copy}
                >
                    <Copy className="w-4 h-4" />
                </Button>
            </div>

            <div className="pt-2">
                <Button size="sm" variant="outline" onClick={copy} className="h-10 px-6 rounded-[50px] border border-[rgba(226,226,226,0.35)] bg-transparent hover:bg-[rgba(255,255,255,0.04)] text-foreground text-[14px] font-medium shadow-none cursor-pointer tracking-wide">
                    <Copy className="w-4 h-4 mr-2" /> 复制命令
                </Button>
            </div>
        </div>
    );
}

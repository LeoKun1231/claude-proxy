import { useState, useCallback } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';

export default function EnvConfig() {
    const [apiKey, setApiKey] = useState('sk-local-proxy');
    const port = 5055;

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
                <h3 className="text-sm font-semibold">命令行配置</h3>
                <p className="text-xs text-muted-foreground mt-0.5">用于 Claude Code 的环境变量</p>
            </div>

            <div className="w-full space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">API 密钥</label>
                <Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-8 text-sm font-mono" />
            </div>

            <div className="relative border rounded-lg bg-muted/30 p-4 group">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">{commands}</pre>
                <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={copy}
                >
                    <Copy className="w-3.5 h-3.5" />
                </Button>
            </div>

            <Button size="sm" variant="outline" onClick={copy} className="cursor-pointer">
                <Copy className="w-3.5 h-3.5 mr-1.5" /> 复制命令
            </Button>
        </div>
    );
}

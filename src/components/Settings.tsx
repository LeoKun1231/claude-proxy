import { useState, useEffect } from 'react';
import { Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from './ui/switch';

export default function AppSettings() {
    const [autoLaunch, setAutoLaunch] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                if (window.electronAPI?.getAutoLaunch) {
                    setAutoLaunch(await window.electronAPI.getAutoLaunch());
                }
            } catch {}
        })();
    }, []);

    const toggle = async (checked: boolean) => {
        setLoading(true);
        try {
            await window.electronAPI?.setAutoLaunch?.(checked);
            setAutoLaunch(checked);
            toast.success(checked ? '开机自启已启用' : '开机自启已禁用');
        } catch (e: any) { toast.error(e?.message || '设置失败'); }
        finally { setLoading(false); }
    };

    if (!window.electronAPI) return null;

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-semibold">系统设置</h3>
                <p className="text-xs text-muted-foreground mt-0.5">桌面应用偏好设置</p>
            </div>

            <div className="flex items-center justify-between border rounded-lg p-4">
                <div className="flex items-center gap-3">
                    <Rocket className="w-4 h-4 text-muted-foreground" />
                    <div>
                        <p className="text-sm font-medium">开机时启动</p>
                        <p className="text-xs text-muted-foreground">在系统启动时自动运行代理服务</p>
                    </div>
                </div>
                <Switch checked={autoLaunch} onCheckedChange={toggle} disabled={loading} />
            </div>
        </div>
    );
}

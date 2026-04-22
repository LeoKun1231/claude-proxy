/**
 * 代理状态管理 Hook
 * 使用智能轮询策略，减少不必要的请求
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_PROXY_PORT } from '@/types/config';

interface ProxyStatus {
    running: boolean;
    port: number;
}

interface UseProxyStatusOptions {
    // 正常轮询间隔 (毫秒)
    pollInterval?: number;
    // 页面不可见时的轮询间隔 (毫秒)
    backgroundPollInterval?: number;
    // 启用/停止操作后的快速轮询次数
    fastPollCount?: number;
    // 快速轮询间隔 (毫秒)
    fastPollInterval?: number;
}

const defaultOptions: UseProxyStatusOptions = {
    pollInterval: 5000,
    backgroundPollInterval: 30000,
    fastPollCount: 3,
    fastPollInterval: 1000,
};

export function useProxyStatus(options: UseProxyStatusOptions = {}) {
    const opts = { ...defaultOptions, ...options };

    const [status, setStatus] = useState<ProxyStatus>({ running: false, port: DEFAULT_PROXY_PORT });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 用于追踪快速轮询
    const fastPollCountRef = useRef(0);
    const timerRef = useRef<number | null>(null);
    const isVisibleRef = useRef(true);
    const statusRef = useRef<ProxyStatus>(status);
    const isMountedRef = useRef(true);
    const isFetchingRef = useRef(false);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // 获取状态
    const fetchStatus = useCallback(async () => {
        if (isFetchingRef.current) {
            return;
        }

        isFetchingRef.current = true;
        try {
            const newStatus = await window.electronAPI.getProxyStatus();
            if (isMountedRef.current) {
                setStatus(prev => {
                    // 仅状态变化时更新，减少渲染
                    if (prev.running !== newStatus.running || prev.port !== newStatus.port) {
                        return newStatus;
                    }
                    return prev;
                });
                setError(null);
            }
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err.message || '获取状态失败');
            }
        } finally {
            isFetchingRef.current = false;
        }
    }, []);

    // 启动代理
    const start = useCallback(async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.startProxy();
            if (result.success) {
                setStatus({ running: true, port: result.port });
                // 触发快速轮询
                fastPollCountRef.current = opts.fastPollCount!;
            }
            setError(result.error || null);
            return result;
        } catch (err: any) {
            setError(err.message);
            return { success: false, error: err.message, port: statusRef.current.port };
        } finally {
            setLoading(false);
        }
    }, [opts.fastPollCount]);

    // 停止代理
    const stop = useCallback(async () => {
        setLoading(true);
        try {
            await window.electronAPI.stopProxy();
            setStatus(prev => ({ ...prev, running: false }));
            fastPollCountRef.current = opts.fastPollCount!;
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [opts.fastPollCount]);

    // 重启代理
    const restart = useCallback(async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.restartProxy();
            if (result.success) {
                setStatus({ running: true, port: result.port });
                fastPollCountRef.current = opts.fastPollCount!;
            }
            setError(result.error || null);
            return result;
        } catch (err: any) {
            setError(err.message);
            return { success: false, error: err.message, port: statusRef.current.port };
        } finally {
            setLoading(false);
        }
    }, [opts.fastPollCount]);

    // 智能轮询
    useEffect(() => {
        const poll = () => {
            fetchStatus();

            // 计算下次轮询间隔
            let interval: number;
            if (fastPollCountRef.current > 0) {
                // 快速轮询模式
                interval = opts.fastPollInterval!;
                fastPollCountRef.current--;
            } else if (!isVisibleRef.current) {
                // 后台模式
                interval = opts.backgroundPollInterval!;
            } else {
                // 正常模式
                interval = opts.pollInterval!;
            }

            timerRef.current = window.setTimeout(poll, interval);
        };

        // 初始获取
        fetchStatus();
        timerRef.current = window.setTimeout(poll, opts.pollInterval!);

        // 页面可见性监听
        const handleVisibilityChange = () => {
            isVisibleRef.current = document.visibilityState === 'visible';
            if (isVisibleRef.current) {
                // 页面重新可见时立即刷新
                fetchStatus();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchStatus, opts.pollInterval, opts.backgroundPollInterval, opts.fastPollInterval]);

    return {
        status,
        loading,
        error,
        start,
        stop,
        restart,
        refresh: fetchStatus,
    };
}

/**
 * 日志管理 Hook
 * 优化日志存储，支持虚拟滚动准备
 */
import { useState, useEffect, useCallback, useRef } from 'react';

export interface LogItem {
    id: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
}

interface UseLogsOptions {
    // 最大日志条数
    maxLogs?: number;
    // 自动滚动到底部
    autoScroll?: boolean;
}

const defaultOptions: UseLogsOptions = {
    maxLogs: 200,
    autoScroll: true,
};

let logIdCounter = 0;

export function useLogs(options: UseLogsOptions = {}) {
    const opts = { ...defaultOptions, ...options };

    const [logs, setLogs] = useState<LogItem[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const pendingLogsRef = useRef<LogItem[]>([]);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // 添加日志
    const addLog = useCallback((data: { message: string; type: 'info' | 'warn' | 'error'; timestamp: string }) => {
        const newLog: LogItem = {
            id: `log_${++logIdCounter}_${Date.now()}`,
            ...data,
        };

        if (isPaused) {
            // 暂停时缓存日志
            pendingLogsRef.current.push(newLog);
            if (pendingLogsRef.current.length > opts.maxLogs!) {
                pendingLogsRef.current = pendingLogsRef.current.slice(-opts.maxLogs!);
            }
        } else {
            setLogs(prev => {
                const updated = [...prev, newLog];
                // 限制日志数量
                if (updated.length > opts.maxLogs!) {
                    return updated.slice(-opts.maxLogs!);
                }
                return updated;
            });
        }
    }, [isPaused, opts.maxLogs]);

    // 清空日志
    const clearLogs = useCallback(() => {
        setLogs([]);
        pendingLogsRef.current = [];
    }, []);

    // 暂停/恢复
    const togglePause = useCallback(() => {
        setIsPaused(prev => {
            if (prev) {
                // 恢复时合并缓存的日志
                setLogs(currentLogs => {
                    const merged = [...currentLogs, ...pendingLogsRef.current];
                    pendingLogsRef.current = [];
                    if (merged.length > opts.maxLogs!) {
                        return merged.slice(-opts.maxLogs!);
                    }
                    return merged;
                });
            }
            return !prev;
        });
    }, [opts.maxLogs]);

    // 过滤日志
    const getFilteredLogs = useCallback((filter?: 'info' | 'warn' | 'error') => {
        if (!filter) return logs;
        return logs.filter(log => log.type === filter);
    }, [logs]);

    // 统计
    const stats = {
        total: logs.length,
        info: logs.filter(l => l.type === 'info').length,
        warn: logs.filter(l => l.type === 'warn').length,
        error: logs.filter(l => l.type === 'error').length,
        pending: pendingLogsRef.current.length,
    };

    // 监听日志事件
    useEffect(() => {
        const handleLog = (data: any) => {
            addLog(data as { message: string; type: 'info' | 'warn' | 'error'; timestamp: string });
        };

        window.electronAPI.onProxyLog(handleLog);

        return () => {
            window.electronAPI.removeProxyLogListener();
        };
    }, [addLog]);

    // 自动滚动
    useEffect(() => {
        if (opts.autoScroll && scrollContainerRef.current && !isPaused) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [logs, opts.autoScroll, isPaused]);

    return {
        logs,
        isPaused,
        stats,
        addLog,
        clearLogs,
        togglePause,
        getFilteredLogs,
        scrollContainerRef,
    };
}

/**
 * 日志管理 Hook
 * 优化日志存储，支持虚拟滚动准备
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

export interface LogItem {
    id: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
    repeatCount?: number;
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
const REPEAT_MERGE_WINDOW_MS = 5000;

// 合并连续重复日志，降低日志噪音
function mergeRepeatLog(logList: LogItem[], incomingLog: LogItem): LogItem[] {
    const lastLog = logList[logList.length - 1];
    if (!lastLog) {
        return [...logList, incomingLog];
    }

    const incomingTs = new Date(incomingLog.timestamp).getTime();
    const lastTs = new Date(lastLog.timestamp).getTime();
    const withinMergeWindow = Number.isFinite(incomingTs) && Number.isFinite(lastTs)
        ? incomingTs - lastTs <= REPEAT_MERGE_WINDOW_MS
        : false;

    if (withinMergeWindow && lastLog.type === incomingLog.type && lastLog.message === incomingLog.message) {
        const nextRepeatCount = (lastLog.repeatCount || 1) + 1;
        return [
            ...logList.slice(0, -1),
            {
                ...lastLog,
                repeatCount: nextRepeatCount,
                // 使用最新时间戳，便于观察最近一次出现时间
                timestamp: incomingLog.timestamp,
            }
        ];
    }

    return [...logList, incomingLog];
}

export function useLogs(options: UseLogsOptions = {}) {
    const maxLogs = options.maxLogs ?? defaultOptions.maxLogs!;
    const autoScroll = options.autoScroll ?? defaultOptions.autoScroll!;

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
            const mergedPending = mergeRepeatLog(pendingLogsRef.current, newLog);
            pendingLogsRef.current = mergedPending.length > maxLogs
                ? mergedPending.slice(-maxLogs)
                : mergedPending;
        } else {
            setLogs(prev => {
                const updated = mergeRepeatLog(prev, newLog);
                // 限制日志数量
                if (updated.length > maxLogs) {
                    return updated.slice(-maxLogs);
                }
                return updated;
            });
        }
    }, [isPaused, maxLogs]);

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
                    let merged = currentLogs;
                    for (const pendingLog of pendingLogsRef.current) {
                        merged = mergeRepeatLog(merged, pendingLog);
                    }
                    pendingLogsRef.current = [];
                    if (merged.length > maxLogs) {
                        return merged.slice(-maxLogs);
                    }
                    return merged;
                });
            }
            return !prev;
        });
    }, [maxLogs]);

    // 过滤日志
    const getFilteredLogs = useCallback((filter?: 'info' | 'warn' | 'error') => {
        if (!filter) return logs;
        return logs.filter(log => log.type === filter);
    }, [logs]);

    // 统计
    const stats = useMemo(() => {
        const base = { total: logs.length, info: 0, warn: 0, error: 0, pending: pendingLogsRef.current.length };
        for (const log of logs) {
            if (log.type === 'info') base.info += 1;
            if (log.type === 'warn') base.warn += 1;
            if (log.type === 'error') base.error += 1;
        }
        return base;
    }, [logs]);

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
        if (autoScroll && scrollContainerRef.current && !isPaused) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll, isPaused]);

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

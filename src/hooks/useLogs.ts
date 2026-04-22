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
    requestId?: string;
    providerId?: string;
    providerLabel?: string;
    model?: string;
    routeKind?: string;
    repeatCount?: number;
}

interface UseLogsOptions {
    // 最大日志条数
    maxLogs?: number;
    // 自动滚动到底部
    autoScroll?: boolean;
}

const defaultOptions: UseLogsOptions = {
    maxLogs: 5000,
    autoScroll: true,
};

const API_BASE = '/api';

let logIdCounter = 0;
const REPEAT_MERGE_WINDOW_MS = 5000;

function mergeLogCollections(history: LogItem[], current: LogItem[], maxLogs: number) {
    const seen = new Set<string>();
    const merged: LogItem[] = [];

    const pushLog = (log: LogItem) => {
        const key = `${log.timestamp}|${log.type}|${log.message}|${log.requestId || ''}|${log.providerLabel || ''}|${log.model || ''}|${log.routeKind || ''}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        merged.push(log);
    };

    history.forEach(pushLog);
    current.forEach(pushLog);

    if (merged.length > maxLogs) {
        return merged.slice(-maxLogs);
    }

    return merged;
}

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
    const isDesktopRuntime = typeof window !== 'undefined'
        && (import.meta.env.VITE_DESKTOP_RUNTIME === 'tauri' || '__TAURI_INTERNALS__' in window);
    const isWebRuntime = typeof window !== 'undefined' && !isDesktopRuntime;

    const [logs, setLogs] = useState<LogItem[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const pendingLogsRef = useRef<LogItem[]>([]);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // 添加日志
    const addLog = useCallback((data: {
        message: string;
        type: 'info' | 'warn' | 'error';
        timestamp: string;
        requestId?: string;
        providerId?: string;
        providerLabel?: string;
        model?: string;
        routeKind?: string;
    }) => {
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

        if (isWebRuntime) {
            void fetch(`${API_BASE}/logs/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }).catch(() => {
                // 忽略清理失败，避免打断 UI 操作
            });
        } else {
            void window.electronAPI.clearLogs?.().catch(() => {
                // 桌面模式清理失败时不阻断 UI 操作
            });
        }
    }, [isWebRuntime]);

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
        let cancelled = false;

        const handleLog = (data: any) => {
            addLog(data as {
                message: string;
                type: 'info' | 'warn' | 'error';
                timestamp: string;
                requestId?: string;
                providerId?: string;
                providerLabel?: string;
                model?: string;
                routeKind?: string;
            });
        };

        if (isWebRuntime) {
            const eventSource = new EventSource(`${API_BASE}/events`);

            eventSource.addEventListener('proxy-log', (event) => {
                const payload = JSON.parse((event as MessageEvent).data) as {
                    message: string;
                    type: 'info' | 'warn' | 'error';
                    timestamp: string;
                    requestId?: string;
                    providerId?: string;
                    providerLabel?: string;
                    model?: string;
                    routeKind?: string;
                };
                handleLog(payload);
            });

            void fetch(`${API_BASE}/logs`)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`请求失败: ${response.status}`);
                    }
                    return response.json() as Promise<Array<{
                        message: string;
                        type: 'info' | 'warn' | 'error';
                        timestamp: string;
                        requestId?: string;
                        providerId?: string;
                        providerLabel?: string;
                        model?: string;
                        routeKind?: string;
                    }>>;
                })
                .then((items) => {
                    if (cancelled || !Array.isArray(items)) {
                        return;
                    }

                    setLogs((currentLogs) => {
                        let historyLogs: LogItem[] = [];
                        for (const item of items.slice(-maxLogs)) {
                            historyLogs = mergeRepeatLog(historyLogs, {
                                id: `log_${++logIdCounter}_${Date.now()}`,
                                ...item,
                            });
                        }
                        return mergeLogCollections(historyLogs, currentLogs, maxLogs);
                    });
                })
                .catch(() => {
                    // 保持实时日志可用，历史日志加载失败时不阻断页面
                });

            return () => {
                cancelled = true;
                eventSource.close();
            };
        }

        void window.electronAPI.getLogs?.()
            .then((items) => {
                if (cancelled || !Array.isArray(items)) return;
                setLogs(() => {
                    let historyLogs: LogItem[] = [];
                    for (const item of items.slice(-maxLogs)) {
                            historyLogs = mergeRepeatLog(historyLogs, {
                                id: `log_${++logIdCounter}_${Date.now()}`,
                                message: item.message,
                                type: item.type as 'info' | 'warn' | 'error',
                                timestamp: item.timestamp,
                                requestId: item.requestId,
                                providerId: item.providerId,
                                providerLabel: item.providerLabel,
                                model: item.model,
                                routeKind: item.routeKind,
                            });
                    }
                    return historyLogs;
                });
            })
            .catch(() => {
                // 桌面模式历史日志加载失败时不阻断实时监听
            });

        window.electronAPI.onProxyLog(handleLog);

        return () => {
            cancelled = true;
            window.electronAPI.removeProxyLogListener(handleLog);
        };
    }, [addLog, isWebRuntime, maxLogs]);

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

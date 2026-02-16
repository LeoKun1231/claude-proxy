/**
 * 日志查看器组件
 * 增强版：支持过滤、暂停、统计
 */
import { useState, useRef, useEffect, memo } from 'react';
import { Button, Empty, Space, Tag, Tooltip, Segmented } from 'antd';
import { ClearOutlined, PauseCircleOutlined, PlayCircleOutlined, DownOutlined } from '@ant-design/icons';

interface LogItem {
    id?: string;
    message: string;
    type: 'info' | 'warn' | 'error';
    timestamp: string;
}

interface LogViewerProps {
    logs: LogItem[];
    onClear: () => void;
}

// 单条日志 - 使用 memo 优化渲染
const LogEntry = memo(({ log, index }: { log: LogItem; index: number }) => {
    const typeColors = {
        info: '#52c41a',
        warn: '#faad14',
        error: '#ff4d4f',
    };

    const typeLabels = {
        info: 'INFO',
        warn: 'WARN',
        error: 'ERROR',
    };

    return (
        <div
            className="log-item"
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
            }}
        >
            <span className="log-time">
                {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <Tag
                color={typeColors[log.type]}
                style={{
                    fontSize: 10,
                    lineHeight: '16px',
                    padding: '0 4px',
                    margin: 0,
                    flexShrink: 0,
                }}
            >
                {typeLabels[log.type]}
            </Tag>
            <span
                className={`log-${log.type}`}
                style={{
                    flex: 1,
                    wordBreak: 'break-all',
                    lineHeight: 1.5,
                }}
            >
                {log.message}
            </span>
        </div>
    );
});

LogEntry.displayName = 'LogEntry';

function LogViewer({ logs, onClear }: LogViewerProps) {
    const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
    const [isPaused, setIsPaused] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const autoScrollRef = useRef(true);

    // 过滤日志
    const filteredLogs = filter === 'all'
        ? logs
        : logs.filter(log => log.type === filter);

    // 统计
    const stats = {
        total: logs.length,
        info: logs.filter(l => l.type === 'info').length,
        warn: logs.filter(l => l.type === 'warn').length,
        error: logs.filter(l => l.type === 'error').length,
    };

    // 自动滚动
    useEffect(() => {
        if (!isPaused && autoScrollRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [filteredLogs.length, isPaused]);

    // 监听滚动
    const handleScroll = () => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        autoScrollRef.current = isAtBottom;
        setShowScrollButton(!isAtBottom && filteredLogs.length > 5);
    };

    // 滚动到底部
    const scrollToBottom = () => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
            autoScrollRef.current = true;
            setShowScrollButton(false);
        }
    };

    if (logs.length === 0) {
        return (
            <Empty
                description="暂无日志"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ padding: '32px 0' }}
            />
        );
    }

    return (
        <div className="fade-in">
            {/* 工具栏 */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                flexWrap: 'wrap',
                gap: 8,
            }}>
                {/* 过滤器 */}
                <Segmented
                    size="small"
                    value={filter}
                    onChange={(value) => setFilter(value as typeof filter)}
                    options={[
                        { label: `全部 (${stats.total})`, value: 'all' },
                        { label: `信息 (${stats.info})`, value: 'info' },
                        { label: `警告 (${stats.warn})`, value: 'warn' },
                        { label: `错误 (${stats.error})`, value: 'error' },
                    ]}
                />

                {/* 操作按钮 */}
                <Space size="small">
                    <Tooltip title={isPaused ? '继续滚动' : '暂停滚动'}>
                        <Button
                            type="text"
                            size="small"
                            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                            onClick={() => setIsPaused(!isPaused)}
                            style={{
                                color: isPaused ? '#faad14' : undefined,
                            }}
                        />
                    </Tooltip>
                    <Tooltip title="清空日志">
                        <Button
                            type="text"
                            size="small"
                            icon={<ClearOutlined />}
                            onClick={onClear}
                            danger
                        />
                    </Tooltip>
                </Space>
            </div>

            {/* 暂停提示 */}
            {isPaused && (
                <div style={{
                    padding: '6px 12px',
                    background: 'rgba(250, 173, 20, 0.1)',
                    border: '1px solid rgba(250, 173, 20, 0.3)',
                    borderRadius: 6,
                    marginBottom: 8,
                    fontSize: 12,
                    color: '#faad14',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    <PauseCircleOutlined />
                    自动滚动已暂停
                </div>
            )}

            {/* 日志列表 */}
            <div
                ref={containerRef}
                className="log-panel"
                onScroll={handleScroll}
                style={{ position: 'relative' }}
            >
                {filteredLogs.map((log, index) => (
                    <LogEntry
                        key={log.id || `${log.timestamp}_${index}`}
                        log={log}
                        index={index}
                    />
                ))}
            </div>

            {/* 滚动到底部按钮 */}
            {showScrollButton && (
                <div style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'center',
                    marginTop: -24,
                    zIndex: 5,
                }}>
                    <Button
                        size="small"
                        icon={<DownOutlined />}
                        onClick={scrollToBottom}
                        style={{
                            borderRadius: 16,
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                        }}
                    >
                        新日志
                    </Button>
                </div>
            )}
        </div>
    );
}

export default LogViewer;

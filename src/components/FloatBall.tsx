/**
 * 悬浮球组件 - 极简纯球版
 */
import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Tooltip, ConfigProvider, theme } from 'antd';
import { RocketOutlined } from '@ant-design/icons';
import './FloatBall.css';

// Provider 名称映射
const BUILTIN_PROVIDER_NAMES: Record<string, string> = {
    'anthropic': 'Anthropic',
    'glm': 'GLM',
    'kimi': 'Kimi',
    'minimax': 'MiniMax',
    'deepseek': 'DeepSeek',
    'litellm': 'LiteLLM',
    'cliproxyapi': 'CLIProxyAPI',
};

function FloatBall() {
    const [mainMapping, setMainMapping] = useState<string>('pass');
    const [targets, setTargets] = useState<string[]>(['pass']);
    const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number }>({ running: false, port: 5055 });
    const [providerNames, setProviderNames] = useState<Record<string, string>>(BUILTIN_PROVIDER_NAMES);

    // 加载数据
    const loadData = useCallback(async () => {
        try {
            const [main, availableTargets, status, allConfig] = await Promise.all([
                window.electronAPI.getMapping('main'),
                window.electronAPI.getAvailableTargets(),
                window.electronAPI.getProxyStatus(),
                window.electronAPI.getAllConfig()
            ]);

            setMainMapping(main);
            setTargets(availableTargets);
            setProxyStatus(prev => {
                if (prev.running !== status.running || prev.port !== status.port) {
                    return status;
                }
                return prev;
            });

            if (allConfig.providers?.customProviders) {
                const customNames: Record<string, string> = {};
                allConfig.providers.customProviders.forEach((p: any) => {
                    customNames[p.id] = p.name;
                });
                setProviderNames(prev => ({ ...BUILTIN_PROVIDER_NAMES, ...customNames }));
            }
        } catch (error) {
            console.error('加载数据失败:', error);
        }
    }, []);

    // 轮询与事件监听
    useEffect(() => {
        const interval = setInterval(loadData, 5000);
        loadData();

        window.electronAPI.onConfigImported?.(() => loadData());
        window.electronAPI.onContextMenuCommand?.(async (value) => {
            try {
                await window.electronAPI.setMapping('main', value);
                await window.electronAPI.setMapping('haiku', value); // 同步设置
                setMainMapping(value);
                await window.electronAPI.restartProxy();
            } catch (error) {
                console.error('切换失败:', error);
            }
        });

        return () => {
            clearInterval(interval);
            window.electronAPI.removeContextMenuListener?.();
        };
    }, [loadData]);

    const handleHide = useCallback(() => window.electronAPI.hideFloatWindow?.(), []);
    const handleOpenMain = useCallback(() => window.electronAPI.showMainWindow?.(), []);

    const formatOptionLabel = useCallback((target: string) => {
        if (target === 'pass') return '透传 (不修改)';
        const [providerId, model] = target.split(':');
        const providerName = providerNames[providerId] || providerId;
        return `${providerName} / ${model}`;
    }, [providerNames]);

    const showMenu = useCallback(() => {
        const menuOptions = targets.map(target => ({
            label: formatOptionLabel(target),
            value: target,
            checked: target === mainMapping
        }));
        window.electronAPI.showContextMenu(menuOptions);
    }, [targets, formatOptionLabel, mainMapping]);

    // 当前模型简称
    const currentModelInfo = useMemo(() => {
        if (mainMapping === 'pass') return '透传模式';
        const parts = mainMapping.split(':');
        if (parts.length >= 2) {
            const providerKey = parts[0];
            const model = parts[1];
            const providerName = providerNames[providerKey] || providerKey;
            return `${providerName} · ${model}`;
        }
        return mainMapping;
    }, [mainMapping, providerNames]);

    // 切换到下一个模型
    const handleNextModel = async () => {
        if (targets.length <= 1) return;

        const currentIndex = targets.indexOf(mainMapping);
        const nextIndex = (currentIndex + 1) % targets.length;
        const nextTarget = targets[nextIndex];

        try {
            // 乐观更新
            setMainMapping(nextTarget);

            // 执行切换
            await window.electronAPI.setMapping('main', nextTarget);
            await window.electronAPI.setMapping('haiku', nextTarget);
            await window.electronAPI.restartProxy();

            // 重新加载以确认
            loadData();
        } catch (error) {
            console.error('切换失败:', error);
            loadData(); // 回滚
        }
    };

    // 拖拽 + 点击处理
    const dragState = useRef({
        isDragging: false,
        startX: 0,
        startY: 0,
        windowStartX: 0,
        windowStartY: 0,
        hasMoved: false
    });

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // 只处理左键
        e.preventDefault();

        dragState.current = {
            isDragging: true,
            startX: e.screenX,
            startY: e.screenY,
            windowStartX: window.screenX,
            windowStartY: window.screenY,
            hasMoved: false
        };

        // 监听全局鼠标事件
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!dragState.current.isDragging) return;

        const deltaX = e.screenX - dragState.current.startX;
        const deltaY = e.screenY - dragState.current.startY;

        // 如果移动超过阈值，标记为拖拽
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
            dragState.current.hasMoved = true;
        }

        // 移动窗口
        const newX = dragState.current.windowStartX + deltaX;
        const newY = dragState.current.windowStartY + deltaY;
        window.electronAPI.moveFloatWindow(newX, newY);
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        dragState.current.isDragging = false;
    };

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: { colorPrimary: '#1890ff' }
            }}
        >
            <div
                className={`float-ball ${proxyStatus.running ? 'running' : 'stopped'}`}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onContextMenu={showMenu}
                onDoubleClick={handleOpenMain}
            >
                <RocketOutlined className="float-ball-icon" />
            </div>
        </ConfigProvider>
    );
}

export default memo(FloatBall);

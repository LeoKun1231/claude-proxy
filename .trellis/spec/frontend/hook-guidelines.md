# Hook Guidelines

> How hooks are used in this project.

---

## Overview

The project has three custom hooks, all in `src/hooks/` and re-exported from `src/hooks/index.ts`. Hooks are the primary way to encapsulate stateful logic and Tauri backend communication. There is no data fetching library (no React Query, no SWR). Hooks manage their own polling, event subscriptions, and state.

---

## Custom Hook Inventory

| Hook | File | Purpose |
|------|------|---------|
| `useProxyStatus` | `src/hooks/useProxyStatus.ts` | Proxy lifecycle (start/stop/restart) + smart polling for status |
| `useLogs` | `src/hooks/useLogs.ts` | Log event subscription, repeat merging, history loading, pause/resume |
| `useTheme` | `src/hooks/useTheme.ts` | Theme loading from config/localStorage, theme switching, config sync |

---

## Custom Hook Patterns

### Structure Convention

Every hook follows this structure:

```tsx
// 1. React imports
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// 2. Types specific to this hook
interface UseProxyStatusOptions {
    pollInterval?: number;
    backgroundPollInterval?: number;
    fastPollCount?: number;
    fastPollInterval?: number;
}

// 3. Default options object with all required values
const defaultOptions: UseProxyStatusOptions = {
    pollInterval: 5000,
    backgroundPollInterval: 30000,
    fastPollCount: 3,
    fastPollInterval: 1000,
};

// 4. Exported function: useXxx(options?)
export function useProxyStatus(options: UseProxyStatusOptions = {}) {
    const opts = { ...defaultOptions, ...options };
    // 5. State declarations
    const [status, setStatus] = useState<ProxyStatus>({ running: false, port: DEFAULT_PROXY_PORT });
    // 6. Refs for mutable values
    const timerRef = useRef<number | null>(null);
    const isMountedRef = useRef(true);
    // 7. Callbacks using useCallback
    const fetchStatus = useCallback(async () => { /* ... */ }, []);
    // 8. Effects for lifecycle
    useEffect(() => { /* ... */ }, []);
    // 9. Return object with state, actions, and refs
    return { status, loading, error, start, stop, restart, refresh: fetchStatus };
}
```

Real example: `src/hooks/useProxyStatus.ts` (31-193) demonstrates this exact structure.

### Options Pattern

Hooks that accept options use a defaults merge pattern:

```tsx
const defaultOptions: UseLogsOptions = {
    maxLogs: 5000,
    autoScroll: true,
};

export function useLogs(options: UseLogsOptions = {}) {
    const maxLogs = options.maxLogs ?? defaultOptions.maxLogs!;
    const autoScroll = options.autoScroll ?? defaultOptions.autoScroll!;
    // ...
}
```

From `src/hooks/useLogs.ts` line 89-91.

### Return Value Convention

Hooks always return an object (never an array/tuple):

```tsx
// Good -- from useProxyStatus.ts lines 184-192
return {
    status,
    loading,
    error,
    start,
    stop,
    restart,
    refresh: fetchStatus, // renamed for clarity
};

// Good -- from useLogs.ts lines 308-317
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
```

### Mounted Guard Pattern

All hooks use `isMountedRef` to avoid state updates after unmount:

```tsx
const isMountedRef = useRef(true);

useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
}, []);

// In async callbacks:
if (isMountedRef.current) {
    setStatus(newStatus);
}
```

From `src/hooks/useProxyStatus.ts` lines 50-56, 67.

### Fetch Deduplication

Concurrent fetch calls are prevented via `isFetchingRef`:

```tsx
const isFetchingRef = useRef(false);

const fetchStatus = useCallback(async () => {
    if (isFetchingRef.current) return;  // skip if already in flight
    isFetchingRef.current = true;
    try {
        // ... fetch
    } finally {
        isFetchingRef.current = false;
    }
}, []);
```

From `src/hooks/useProxyStatus.ts` lines 59-84.

---

## Tauri Backend Integration

### Direct Invocation

Hooks call `window.electronAPI.*` methods directly. The API object is installed at app bootstrap (see `src/main.tsx` line 8). Hooks do not call `invoke()` from `@tauri-apps/api/core` themselves.

```tsx
// From useProxyStatus.ts
const newStatus = await window.electronAPI.getProxyStatus();
const result = await window.electronAPI.startProxy();
```

### Event Subscription

Hooks subscribe to Tauri events for real-time updates:

```tsx
// From useTheme.ts lines 38-50
useEffect(() => {
    loadTheme();
    if (!window.electronAPI?.onConfigUpdated) return;
    const handler = ({ key }: { key: string }) => {
        if (key === 'all' || key === 'settings.theme' || key === 'settings') {
            loadTheme();
        }
    };
    window.electronAPI.onConfigUpdated(handler);
    return () => {
        window.electronAPI.removeConfigUpdatedListener?.(handler);
    };
}, [loadTheme]);
```

Key event subscription pattern:
1. Subscribe in `useEffect`
2. Always provide a cleanup function that removes the listener
3. Use optional chaining (`?.`) since `electronAPI` may be undefined in non-Tauri environments
4. Filter by event `key` to avoid unnecessary reloads

---

## Dual-Runtime Support

Some hooks support both desktop (Tauri) and web (pure browser) runtimes. See `src/hooks/useLogs.ts` lines 92-94:

```tsx
const isDesktopRuntime = typeof window !== 'undefined'
    && (import.meta.env.VITE_DESKTOP_RUNTIME === 'tauri' || '__TAURI_INTERNALS__' in window);
const isWebRuntime = typeof window !== 'undefined' && !isDesktopRuntime;
```

The `useTheme` hook has a localStorage fallback for non-Tauri environments (`src/hooks/useTheme.ts` lines 30-34).

---

## Naming Conventions

- All custom hook files use `use` prefix: `useProxyStatus.ts`, `useLogs.ts`, `useTheme.ts`
- Hook function names match file names: `useProxyStatus`, `useLogs`, `useTheme`
- Internal state variables are plain nouns: `status`, `loading`, `error`, `logs`, `theme`
- Options interface: `Use<Name>Options` (e.g., `UseProxyStatusOptions`, `UseLogsOptions`)
- Actions in return object are imperative verbs: `start`, `stop`, `restart`, `clearLogs`, `togglePause`

---

## Common Mistakes

1. **Array destructuring hooks** -- Always return an object, not `[value, setter]`. Only React built-ins use tuples.
2. **Forgetting cleanup in useEffect** -- Every event listener subscription must be unsubscribed on unmount.
3. **Blocking polling on absent API** -- Always guard with `if (!window.electronAPI) return` before calling backend methods.
4. **Causing infinite re-render loops** -- When using `useCallback`, be careful with dependency arrays. `fetchStatus` in useProxyStatus has `[]` dependencies, which is correct because it only reads refs.
5. **Over-fetching on config updates** -- Always filter by `key` in the configUpdated handler to avoid refreshing on unrelated config changes.

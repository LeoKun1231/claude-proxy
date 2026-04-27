# State Management

> How state is managed in this project.

---

## Overview

This project uses **React built-in state management only** -- no Redux, Zustand, MobX, Jotai, or any external state library. The app is a single-page desktop workbench without client-side routing, so (1) there is no URL state, and (2) the component tree is shallow enough that prop drilling is not a problem.

Verification: `package.json` dependencies (`src/../package.json`) contain no state management libraries. All state across 11 components and 3 hooks uses `useState`, `useRef`, `useCallback`, `useMemo`, and `useEffect`.

---

## State Categories

### Local Component State (`useState`)

Used for UI state scoped to a single component:

| Pattern | Example | Source |
|---------|---------|--------|
| Tab selection | `const [activeTab, setActiveTab] = useState<TabKey>('routing')` | `DesktopWorkbench.tsx:218` |
| Form field values | `const [autoLaunch, setAutoLaunch] = useState(false)` | `Settings.tsx:11` |
| List data | `const [providers, setProviders] = useState<CustomProvider[]>([])` | `ProviderConfig.tsx:44` |
| Loading flags | `const [loadingAutoLaunch, setLoadingAutoLaunch] = useState(false)` | `Settings.tsx:15` |
| Filter state | `const [filter, setFilter] = useState<'all' \| 'info' \| 'warn' \| 'error'>('all')` | `LogViewer.tsx:99` |
| Draft values | `const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})` | `ProviderConfig.tsx:45` |

### Ref State (`useRef`)

Used for mutable values that should not trigger re-renders:

| Pattern | Example | Source |
|---------|---------|--------|
| Timer IDs | `const timerRef = useRef<number \| null>(null)` | `ProviderConfig.tsx:48` |
| DOM references | `const scrollContainerRef = useRef<HTMLDivElement \| null>(null)` | `useLogs.ts:99` |
| Fetch dedup flags | `const isFetchingRef = useRef(false)` | `useProxyStatus.ts:44` |
| Mount guards | `const isMountedRef = useRef(true)` | `useProxyStatus.ts:43` |
| State snapshots for async | `const statusRef = useRef<ProxyStatus>(status)` | `useProxyStatus.ts:42` |
| Visibility tracking | `const isVisibleRef = useRef(true)` | `useProxyStatus.ts:41` |
| Pending buffers | `const pendingLogsRef = useRef<LogItem[]>([])` | `useLogs.ts:98` |

### Derived State (`useMemo`)

Used for computed values from existing state:

```tsx
// From DesktopWorkbench.tsx:219-222
const activeView = useMemo(
    () => TAB_ITEMS.find((item) => item.key === activeTab) ?? TAB_ITEMS[0],
    [activeTab]
);

// From ProviderConfig.tsx:224-238
const sortedProviders = useMemo(() => {
    const list = [...providers];
    switch (sortBy) {
        case 'name':
            list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            break;
        // ...
    }
    return list;
}, [providers, sortBy]);

// From useLogs.ts:182-190
const stats = useMemo(() => {
    const base = { total: logs.length, info: 0, warn: 0, error: 0, pending: pendingLogsRef.current.length };
    for (const log of logs) {
        if (log.type === 'info') base.info += 1;
        // ...
    }
    return base;
}, [logs]);
```

### Server State (Tauri Backend)

The "server" is the Rust backend process. There is no HTTP API, no caching layer, no React Query. State flows in two directions:

**Downward (Rust -> React):** Tauri events notify the frontend of changes:
- `config-updated` event -- Emitted when any config key changes. Handlers reload config data.
- `proxy-log` event -- Emitted each time the proxy processes a request. Delivers log entries.
- `config-imported` event -- Emitted when config is imported from file.

**Upward (React -> Rust):** `window.electronAPI.*` methods call Rust commands:
- `getConfig(key)` / `setConfig(key, value)` -- Read/write individual config keys
- `getAllConfig()` -- Read entire config object
- `getProxyStatus()` -- Check if proxy is running
- `startProxy()` / `stopProxy()` / `restartProxy()` -- Control proxy lifecycle

### Module-Level Cached State

Only used once, in `src/hooks/useTheme.ts`:

```tsx
let cachedTheme: Theme | null = null;
```

This avoids an initial flash of wrong theme by caching the theme value across hot reloads. Used sparingly and documented.

---

## Config State Sharing

The `AppConfig` object (from `src/types/config.ts`) is the central data model. It is read by all hooks and many components:

1. `App.tsx` (top level) owns proxy status and action handlers
2. `useProxyStatus` hook owns proxy lifecycle state (running/port)
3. `useTheme` hook owns theme state
4. `useLogs` hook owns log buffer state
5. Individual components (Settings, ProviderConfig, ActiveProviderSwitcher, EnvConfig, RouterConfig, TokenStatsPanel, StatusBar) each load their own config slices from `window.electronAPI`

**There is no single shared config context.** Each component loads what it needs via `getAllConfig()`. Config changes are synchronized via the `config-updated` event, which components subscribe to and reload on relevant key changes.

---

## When to Use Global State

This project does not use a global state store. Decisions:

| Scenario | Solution | Reason |
|----------|----------|--------|
| Config shared across tabs | Each component loads from Tauri | Config is persisted in Rust, so every component can read independently |
| Proxy status visible everywhere | Polled in one hook, passed via props | Component tree is shallow (App -> DesktopWorkbench -> children) |
| Theme | Module-level variable + `useTheme` hook | Needs to apply at mount without flash |
| Logs | Managed in `useLogs` hook, used in `LogsSection` | Scoped to logs tab |

If new state needs to be shared, the existing pattern is to add it to `useProxyStatus` or create a new hook, not to introduce a global store.

---

## Common Mistakes

1. **Storing timer IDs as React state** -- Use `useRef` for timer IDs. Setting state for timer IDs causes unnecessary re-renders.
2. **Not keeping a state ref for async callbacks** -- When an async callback reads state, use `statusRef.current` (not `status`) to get the latest value without stale closures.
3. **Prop drilling without memo** -- The sub-component pattern in DesktopWorkbench.tsx uses `memo` on `SectionContent` (line 159) to prevent re-renders when tab props haven't changed.
4. **Loading config in a loop** -- Config loading should happen once in `useEffect([])`, and then updates should come from the `config-updated` event listener, not from polling config.
5. **Forgetting that `useState` setters are asynchronous** -- When updating state and then immediately saving, always use the functional updater form: `setProviders(prev => { ... return next; }); queueSave(next);`

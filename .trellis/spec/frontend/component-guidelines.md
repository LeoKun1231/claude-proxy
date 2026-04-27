# Component Guidelines

> How components are built in this project.

---

## Overview

Components are React functional components with TypeScript. All are default exports. Props are typed via local `interface` declarations above the component function. Components use Tailwind utility classes directly in JSX for styling. State management uses `useState`, `useRef`, `useCallback`, `useMemo`, and `useEffect` -- no external state library.

Icons come from `lucide-react` (not emoji, not inline SVG). Toast notifications use `sonner`.

---

## Component Structure

Components follow a consistent structure tested across 11 feature components:

```tsx
// 1. React imports first (useState, useEffect, useCallback, useMemo, useRef, memo)
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';

// 2. Icon imports from lucide-react
import { Play, Square, Activity } from 'lucide-react';

// 3. Toast import
import { toast } from 'sonner';

// 4. UI primitive imports from ./ui/
import { Button } from './ui/button';
import { Input } from './ui/input';

// 5. Library/utility imports
import { cn } from '@/lib/utils';

// 6. Type imports
import type { RoutingMode } from '@/types/config';

// 7. Props interface (local to file, not exported unless reused)
interface StatusBarProps {
    status: { running: boolean; port: number };
    loading: boolean;
    onStart: () => void;
    onStop: () => void;
}

// 8. Helper functions (before component, if pure)
function formatRouteKind(routeKind?: string) { /* ... */ }

// 9. Sub-components using memo for performance
const LogEntry = memo(({ log }: { log: LogItem }) => ( /* ... */ ));
LogEntry.displayName = 'LogEntry';

// 10. Main component as default export
export default function StatusBar({ status, loading, onStart }: StatusBarProps) {
    // ... state, effects, callbacks, JSX
}
```

Real examples of this pattern:
- `src/components/StatusBar.tsx` (lines 1-69)
- `src/components/Settings.tsx` (lines 1-195)
- `src/components/LogViewer.tsx` (lines 1-179)
- `src/components/ActiveProviderSwitcher.tsx` (lines 1-490)

---

## Props Conventions

**Props are always defined as `interface` at the top of the file.** The interface is not exported unless another file needs to pass those props (e.g., `DesktopWorkbenchProps` is exported because `App.tsx` passes it down).

```tsx
// Standard pattern -- props interface above component
interface DesktopWorkbenchProps {
    isDesktopRuntime: boolean;
    proxyStatus: { running: boolean; port: number };
    proxyLoading: boolean;
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
    onReleasePort: () => void;
    onCopyProxyUrl: () => void;
    onCopyCommand: () => void;
    onExport: () => void;
    onImport: () => void;
}

export default function DesktopWorkbench({
    isDesktopRuntime,
    proxyStatus,
    proxyLoading,
    onStart,
    onStop,
    // ...
}: DesktopWorkbenchProps) {
```

Key observations from the codebase:
- Callback props use `on` prefix: `onStart`, `onStop`, `onClear`, `onExport`
- Optional callbacks guard with optional chaining: `window.electronAPI?.onConfigUpdated`
- Destructuring in function signature, not in body
- Props are not memoized with `React.memo` wrappers at the top level unless children are known to be static

---

## Styling Patterns

All styling uses Tailwind utility classes directly in JSX `className` attributes. There is no CSS modules, no styled-components, no Emotion.

**Global CSS** in `src/styles/index.css` defines:
- Tailwind `@tailwind base/components/utilities`
- CSS custom properties for light/dark themes via `:root` and `.dark`
- Base styles for `html`, `body`, `#root`
- Custom scrollbar styling

**Component-level styling conventions:**
- Border radius: `rounded-[8px]` for inputs, `rounded-[12px]` for cards, `rounded-[50px]` for pills/buttons
- Font sizes: explicit pixel values, e.g., `text-[14px]`, `text-[11px]` for labels
- Color usage: semantic Tailwind tokens: `text-foreground`, `text-muted-foreground`, `bg-primary`, `bg-muted`, `border-border`
- Border style: `border border-border` for cards and inputs
- Background: `bg-transparent` (not `bg-background`) for containers, relying on parent backgrounds
- Animation: `animate-in fade-in duration-500 fill-mode-both` for tab content transitions
- The `cn()` helper from `@/lib/utils` merges conditional classes

```tsx
// Real example from StatusBar.tsx lines 39-41
className="h-10 px-5 rounded-[50px] bg-primary border-none hover:bg-primary/90 text-primary-foreground font-medium text-[16px] shadow-none"
```

---

## State Management in Components

Local state uses `useState`. Refs use `useRef` for mutable values that don't trigger re-render (timers, fetch guards, status snapshots). Callbacks use `useCallback`. Derived values use `useMemo`.

Common patterns:
- **Debounced save**: `timerRef` with `setTimeout` and a 300-400ms delay before writing to Tauri config
- **Mounted guard**: `isMountedRef` to prevent state updates after unmount
- **Fetch deduplication**: `isFetchingRef` to skip concurrent fetch calls
- **Config change subscription**: `useEffect` with `window.electronAPI.onConfigUpdated` and cleanup
- **Empty state**: When data is empty, render a centered placeholder `<div>` with instructional text and optional action buttons

---

## Event Handling

Event handlers use `useCallback` with proper dependencies. Inline event handlers in JSX are simple arrow functions. For complex logic, named handler functions are used.

```tsx
// Named handler with useCallback -- from App.tsx lines 27-36
const handleStart = useCallback(async () => {
    const result = await start();
    if (result.success) {
        const alreadyRunning = 'alreadyRunning' in result && Boolean(result.alreadyRunning);
        if (alreadyRunning) toast.info(`代理已在端口 ${result.port} 运行`);
        else toast.success(`已在端口 ${result.port} 启动`);
        return;
    }
    toast.error('启动失败: ' + result.error);
}, [start]);
```

`<button>` elements always use `type="button"` explicitly to prevent accidental form submission. Buttons that stop click propagation use `onClick={(event) => event.stopPropagation()}`.

---

## Common Mistakes

1. **Forgetting `type="button"` on `<button>` elements** -- Always set it explicitly; without `type="button"`, bare `<button>` elements inside forms default to `type="submit"`, causing unexpected form submissions. Every button in the codebase has this attribute set.

2. **Directly mutating state** -- Always use the setter function patterns shown in ProviderConfig: `setProviders(prev => next)` then `queueSave(next)`.
3. **Missing dependency arrays in `useCallback`/`useEffect`** -- The tsconfig has `strict: true` and TypeScript should catch most of these.
4. **Importing from wrong paths** -- Always use `@/` alias for src-internal imports (`@/lib/utils`, `@/hooks`, `@/types/config`), not relative paths like `../../lib/utils`.
5. **Not cleaning up timers/listeners** -- Every `setTimeout`/`setInterval` needs a corresponding `clearTimeout`/`clearInterval` in the effect cleanup. Every `onConfigUpdated` needs `removeConfigUpdatedListener` in cleanup.

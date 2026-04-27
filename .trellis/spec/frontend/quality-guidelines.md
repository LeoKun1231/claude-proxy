# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

This project has no test framework, no lint script in `package.json`, and no CI pipeline for the frontend. Quality is maintained through code conventions, TypeScript strict mode, and the patterns documented in the other spec files. This file captures the explicit rules, forbidden patterns, and team conventions derived from the codebase and project CLAUDE.md.

---

## Forbidden Patterns

### Visual Design

| Forbidden | Reason | Source |
|-----------|--------|--------|
| Emoji as functional icons | Looks unprofessional; use `lucide-react` | Project CLAUDE.md, ~/.claude/CLAUDE.md |
| Purple or indigo gradients as defaults | Overused in AI tools; avoid generic AI aesthetics | Project CLAUDE.md, ~/.claude/CLAUDE.md |
| Hero + 3-card landing layouts | Generic template pattern; not appropriate for a desktop app | Project CLAUDE.md |
| Perfect vertical centering as default | Meaningless when there is actual content | Project CLAUDE.md |
| Overuse of `ease-in-out` linear animations | Generic animation; use `animate-in fade-in duration-500` as seen in codebase | Project CLAUDE.md, `DesktopWorkbench.tsx` |

### Code Patterns

| Forbidden | Reason | Source |
|-----------|--------|--------|
| `any` without explicit justification | Breaks type safety | Strict mode enabled in tsconfig |
| Array destructuring for custom hooks | Hook returns must be objects, not tuples | Codebase convention |
| Unnecessary abstractions | "Three similar lines > premature abstraction" | ~/.claude/CLAUDE.md |
| CSS modules or styled-components | Project uses Tailwind exclusively | `src/components/` -- no .module.css files |
| `git commit` / `git push` / `git merge` | Reserved for developer; AI must not execute these | Workflow spec |
| Creating test files without explicit request | No test framework configured | ~/.claude/CLAUDE.md |
| Creating documentation files without explicit request | No README, no docs/ unless asked | ~/.claude/CLAUDE.md |
| Adding error handling for impossible states | "Don't add error handling for scenarios that can't happen" | ~/.claude/CLAUDE.md |

---

## Required Patterns

### Import Organization

Import order within each file must follow this exact sequence (observed in all components):

```
1. React imports (useState, useEffect, useCallback, useMemo, useRef, memo)
2. Icon imports from lucide-react
3. Toast import from sonner
4. UI primitive imports from ./ui/
5. Utility imports from @/lib/
6. Type imports (use `import type`)
```

Real example ordering from `StatusBar.tsx`:
```tsx
import { Play, Square, RefreshCcw, Activity } from 'lucide-react';       // Icons
import { Button } from './ui/button';                                      // UI primitives
```

From `ActiveProviderSwitcher.tsx`:
```tsx
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Pencil, Plus, Server, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { /* ... */ } from '@/lib/provider-options';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { CustomProviderData, ModelRoute } from '../types/config';
```

### Path Alias Usage

Internal src imports must use the `@/` alias:

```tsx
// Correct
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks';
import { DEFAULT_PROXY_PORT } from '@/types/config';

// Incorrect -- relative paths to src-internal modules
import { cn } from '../../lib/utils';
```

The alias is defined in `tsconfig.json` (line 23-25) and `vite.config.ts`.

### Button Element Attributes

Every `<button>` must have `type="button"` explicitly set (all buttons in StatusBar.tsx, ProviderConfig.tsx, etc.). This prevents accidental form submission.

### Cleanup in useEffect

Every effect that creates timers, intervals, or event listeners must return a cleanup function:

```tsx
useEffect(() => {
    const timer = window.setInterval(() => { void loadSettings(); }, 5000);
    window.electronAPI.onConfigUpdated(handler);
    return () => {
        window.clearInterval(timer);
        window.electronAPI.removeConfigUpdatedListener?.(handler);
    };
}, [loadSettings]);
```

### Error Handling at Tauri Boundary

Calls to `window.electronAPI` methods should be wrapped in try/catch:

```tsx
try {
    await window.electronAPI?.setConfig?.('settings.proxyPort', parsedProxyPort);
    toast.success('保存成功');
} catch (e: any) {
    toast.error(e?.message || '保存失败');
}
```

However, catch blocks should not be added for scenarios that truly cannot occur (e.g., getProxyStatus failing in a desktop runtime).

### External Link Security

When using `target="_blank"` on `<a>` tags, always include `rel="noopener noreferrer"`.

---

## Comments Policy

The project follows these commenting rules (from CLAUDE.md and codebase patterns):

- **Default: no comments** -- Write clear code that doesn't need explanation
- **Add comments only when the WHY is non-obvious** -- If a future reader would ask "why is this done this way?", add a brief comment
- **No JSDoc on exported functions** -- Not used in the codebase. See `useProxyStatus.ts` which has a 3-line Chinese block comment (lines 1-4), but `useLogs.ts` and `useTheme.ts` have none
- **Comments in Chinese are acceptable** -- The codebase uses both Chinese (hook headers like `日志管理 Hook`) and English (inline notes like `// fastPollCountRef`)

Observed comment styles from the codebase:
```tsx
// 用于追踪快速轮询
const fastPollCountRef = useRef(0);

// 仅状态变化时更新，减少渲染
if (prev.running !== newStatus.running || prev.port !== newStatus.port) {
    return newStatus;
}

// 保持实时日志可用，历史日志加载失败时不阻断页面
```

---

## Testing Requirements

- **No test framework is configured.** `package.json` has no test scripts. There is no `vitest`, `jest`, or `@testing-library/react` dependency.
- **Do not create test files** unless the user explicitly asks for them.
- If tests are requested, options include Vitest (Vite-native) or manual testing via `npm run dev`.

---

## Code Review Checklist

When reviewing frontend changes (or before self-checking implementation), verify:

1. Are imports in the correct order (React, icons, toast, UI, lib, types)?
2. Is the `@/` alias used for all src-internal imports?
3. Do all `<button>` elements have `type="button"`?
4. Do all `useEffect` hooks with timers/listeners have proper cleanup?
5. Are icons from `lucide-react` (not emoji, not raw SVG)?
6. Are colors hex values or Tailwind semantic tokens (not purple/indigo gradients)?
7. Are types properly defined (interface for objects, type for unions)?
8. Is `any` usage minimized and justified?
9. Is there any over-engineering (abstractions for fewer than 3 occurrences)?
10. Are catch blocks handling only realistic failure modes?

---

## Dependency Rules

- `@tauri-apps/api` is the Tauri IPC bridge -- components use it indirectly via `window.electronAPI`
- `lucide-react` is the icon library -- use this for all icons
- `sonner` is the toast library -- use for user-facing notifications
- `@base-ui/react` is the headless UI primitive underlying shadcn components
- `class-variance-authority` + `clsx` + `tailwind-merge` are used for component styling variants

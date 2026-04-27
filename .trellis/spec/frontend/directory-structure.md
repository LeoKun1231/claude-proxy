# Directory Structure

> How frontend code is organized in this project.

---

## Overview

This is a Tauri 2 + React + TypeScript desktop app using Vite as the bundler. The renderer lives in `src/` and is loaded by the Rust backend in `src-tauri/`. There is no page-based routing -- everything is a single-page desktop workbench with tab-based navigation.

---

## Directory Layout

```
src/
├── main.tsx                    # Renderer entry point, installs Tauri API bridge
├── App.tsx                     # Top-level orchestration (proxy actions, clipboard, toasts)
├── vite-env.d.ts               # Vite env types, global Window.electronAPI declaration
├── components/
│   ├── DesktopWorkbench.tsx    # Main shell: sidebar tabs + tab content routing
│   ├── DesktopWorkbenchHeader.tsx
│   ├── StatusBar.tsx           # Proxy start/stop/restart controls
│   ├── ActiveProviderSwitcher.tsx  # Gateway mode: one active provider for all traffic
│   ├── ProviderConfig.tsx      # Custom provider CRUD with model management
│   ├── ProviderListPicker.tsx
│   ├── RouterConfig.tsx        # Routes mode: category-based routing rules
│   ├── TokenStatsPanel.tsx     # Token usage visualization
│   ├── LogViewer.tsx           # Real-time log display with filtering
│   ├── EnvConfig.tsx           # CLI environment variable configuration helper
│   ├── Settings.tsx            # Auto-launch, theme, proxy port settings
│   └── ui/                     # Primitive UI components (shadcn-based via base-ui)
│       ├── badge.tsx
│       ├── button.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── separator.tsx
│       ├── switch.tsx
│       └── tooltip.tsx
├── hooks/
│   ├── index.ts                # Barrel re-export file for all hooks
│   ├── useProxyStatus.ts       # Proxy lifecycle: start/stop/restart + smart polling
│   ├── useLogs.ts              # Log event subscription, merge, history load
│   └── useTheme.ts             # Theme load/change with config persistence
├── services/
│   └── desktop-api.ts          # Tauri bridge: wraps invoke() and Tauri event listeners
├── types/
│   ├── config.ts               # Shared AppConfig types (mirrors Rust config.rs)
│   └── token-usage.ts          # Token usage payload and record interfaces
├── lib/
│   ├── utils.ts                # cn() helper (clsx + tailwind-merge)
│   └── provider-options.ts     # Provider/model normalization and merge utilities
└── styles/
    └── index.css               # Global styles, CSS custom properties, Tailwind, dark mode
```

---

## Module Organization

- **`components/`** -- Feature components go directly in the folder. UI primitives (buttons, inputs, switches) go in `components/ui/`. There is no feature-based nesting or route-based colocation.
- **`hooks/`** -- One file per custom hook. Each hook is re-exported from `hooks/index.ts` for clean imports. Module-level (non-component) state like `cachedTheme` is allowed.
- **`services/`** -- Backend bridge layer. Currently only `desktop-api.ts`, which creates the `window.electronAPI` object that all hooks and components call.
- **`types/`** -- Shared TypeScript interfaces and type aliases. Types are shared with Rust via convention (Rust structs in `config.rs` mirror the TS interfaces). No runtime validation library (no Zod).
- **`lib/`** -- Pure utility functions with no React or Tauri dependencies. Stateless, importable anywhere.
- **`styles/`** -- Global CSS only. Component-specific styles are applied via Tailwind utility classes in JSX. No CSS modules, no styled-components.

---

## Naming Conventions

| Category | Convention | Examples |
|----------|-----------|---------|
| Components | PascalCase, `.tsx` extension | `DesktopWorkbench.tsx`, `StatusBar.tsx`, `LogViewer.tsx` |
| UI primitives | kebab-case, `.tsx` extension | `button.tsx`, `switch.tsx`, `dropdown-menu.tsx` |
| Hooks | camelCase, `use` prefix, `.ts` extension | `useProxyStatus.ts`, `useLogs.ts`, `useTheme.ts` |
| Service files | kebab-case, `.ts` extension | `desktop-api.ts` |
| Type files | kebab-case, `.ts` extension | `config.ts`, `token-usage.ts` |
| Utility files | kebab-case, `.ts` extension | `utils.ts`, `provider-options.ts` |
| Interfaces/types | PascalCase, no `I` prefix | `AppConfig`, `ProviderConfigData`, `LogItem` |
| Types vs interfaces | `interface` for objects, `type` for unions/literals | `interface AppConfig`, `type RoutingMode = 'gateway' \| 'routes'` |

---

## Examples

Well-organized modules in this codebase:

- `src/hooks/useProxyStatus.ts` -- Self-contained hook with its own options interface, default options object, and internal ref management. Exports only `useProxyStatus`.
- `src/lib/provider-options.ts` -- Pure utility file with no React imports. Functions are independently testable and composable (`normalizeModels`, `parseModelsInput`, `mergeModels`, `replaceModel`, `removeProviderModel`, `hasModel`).
- `src/components/ui/button.tsx` -- UI primitive pattern: imports from `@base-ui/react`, applies `cn()` helper + `cva` variants, re-exports with a clean API.

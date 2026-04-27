# Type Safety

> Type safety patterns in this project.

---

## Overview

This project uses TypeScript with **strict mode enabled** (`tsconfig.json` line 18: `"strict": true`). There is no runtime validation library (no Zod, Yup, io-ts, or Joi). Types are defined in `.ts` declaration files and shared by convention with the Rust backend.

---

## TypeScript Configuration

From `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx"
  }
}
```

Key points:
- `strict: true` enables all strict type-checking options
- `noUnusedLocals` and `noUnusedParameters` are **disabled** -- unused variables are allowed
- `noFallthroughCasesInSwitch` is enabled
- Path alias: `@/*` maps to `src/*`

---

## Type Organization

### Primary Type Files

| File | Types defined | Shared with |
|------|---------------|-------------|
| `src/types/config.ts` | `AppConfig`, `ProviderConfigData`, `RouterConfig`, `ModelRoute`, `RoutingMode`, etc. | Rust `src-tauri/src/config.rs` |
| `src/types/token-usage.ts` | `TokenUsagePayload`, `TokenUsageRecord` | Rust proxy module |
| `src/vite-env.d.ts` | `ElectronAPI` interface, `Window.electronAPI` global declaration | `src/services/desktop-api.ts` |

### Local Types

Types used only within a single file are defined there:

```tsx
// From src/components/ActiveProviderSwitcher.tsx:16-21
interface EditingModelState {
    providerId: string;
    original: string;
    value: string;
}

interface ProviderModelUpdate {
    updatedProvider: CustomProviderData;
    nextProviders: CustomProviderData[];
}
```

### Type Sharing with Rust

The frontend `src/types/config.ts` and the backend `src-tauri/src/config.rs` define mirroring data structures. There is no auto-generated type bridge. The convention is:

- TS `interface AppConfig` <-> Rust `struct AppConfig`
- TS `interface ProviderConfigData` <-> Rust `struct ProviderConfig`
- Types/strip-fields/legacy-mappings etc. are maintained manually in both languages

When adding a new config field, it must be added to both `src/types/config.ts` and `src-tauri/src/config.rs`.

---

## Interface vs Type Alias Convention

The codebase consistently uses:

- **`interface`** for object shapes:

```tsx
// From src/types/config.ts
export interface ProviderConfigData {
    enabled: boolean;
    apiKey: string;
    models: string[];
    baseUrl?: string;
    // ...
}

export interface AppConfig {
    configVersion: number;
    router: RouterConfig;
    // ...
}
```

- **`type`** for unions, literals, and mapped types:

```tsx
// From src/types/config.ts
export type LegacyMappingType = 'main' | 'haiku';
export type RoutingMode = 'gateway' | 'routes';
export type RouterCategoryKey = 'default' | 'background' | 'think' | 'longContext' | 'webSearch' | 'image';
```

- **`type`** for local sub-component types:

```tsx
// From src/services/desktop-api.ts:6-16
type ProxyLogPayload = {
    message: string;
    type: 'info' | 'warn' | 'error';
    // ...
};
```

Rule of thumb seen across all files:
- If it has only properties -> `interface`
- If it is a union/intersection/literal -> `type`
- No `I` prefix (no `IAppConfig`, no `IProvider`)

---

## Global Type Declarations

The `Window.electronAPI` global is declared in `src/vite-env.d.ts` (lines 80-84):

```tsx
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
```

The `ElectronAPI` interface (lines 14-78) defines the full API surface that components call. When adding a new Rust command, its TS signature must be added here.

---

## Type Guards and Utilities

The project does not define custom type guard functions. Type narrowing relies on:
- JavaScript runtime checks: `typeof`, `in`, `Array.isArray()` and `Boolean()`
- Optional chaining: `window.electronAPI?.getAllConfig()`
- Null checks: `if (timerRef.current) clearTimeout(timerRef.current)`

Example from `src-tauri/src/proxy.rs` (accessed via Rust compatibility layer in `openai.ts`):

```tsx
// From App.tsx:29 -- runtime type check
const alreadyRunning = 'alreadyRunning' in result && Boolean(result.alreadyRunning);
```

---

## Const Assertions

Used for compile-time literal types in config objects:

```tsx
// From DesktopWorkbench.tsx:147
] as const;

// From lib/provider-options.ts:18
] as const;
```

---

## Forbidden Patterns

1. **Using `any` without explicit justification** -- The codebase does use `any` in catch blocks (`catch (error: any)`) and config loading (`(cfg as any)?.routingMode`). These are tolerated for Tauri API boundary and error handling, but should not proliferate.
2. **Type assertions (`as Type`) on data from the backend** -- Prefer the pattern in useLogs.ts where each field is individually mapped (lines 276-284) instead of a blanket `as LogItem[]` cast. The `item.type as 'info' | 'warn' | 'error'` pattern is used since Tauri returns plain strings.
3. **Generating types from Rust** -- There is no codegen. Types are manually kept in sync. Do not introduce a codegen step without team agreement.
4. **Runtime-only types** -- Do not define Zod/Yup schemas. The project has no runtime validation and no pattern for it. If validation is needed, do it in Rust (the backend commands) and return error strings.

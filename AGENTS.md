# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React renderer application entry and UI composition.
- `src/components/`: Feature UI modules (for example `ProviderConfig.tsx`, `ActiveProviderSwitcher.tsx`, `LogViewer.tsx`).
- `src/hooks/`: Shared behavior hooks (`useProxyStatus`, `useLogs`) for polling and log state.
- `src/styles/`: Global styles and renderer-level CSS.
- `src-tauri/`: Tauri main-process, Rust proxy engine, config store, and IPC commands.
- `public/`: Static assets such as `icon.png`.
- Build outputs are generated into `dist/` (Vite) and `src-tauri/target/` (Cargo).

## Build, Test, and Development Commands
- `npm install`: Install project dependencies.
- `npm run dev`: Start Tauri development mode (launches Vite + native window).
- `npm run dev:web`: Start Vite dev server only (for frontend iteration).
- `npm run build`: Build frontend and package native desktop app via `tauri build`.
- `npm run build:web`: Build the Vite frontend only.
- `npm run preview`: Preview the built renderer output.
- `npm run check:rust`: Run `cargo check` on the Tauri backend.

## Browser Tool Selection
- Default to `Playwright` when the task should become a repeatable test or scripted flow in the repo, especially for deterministic UI verification and regression checks.
- Use `chrome-devtools-mcp` when the task needs Chrome DevTools capabilities such as inspecting network requests, console errors, performance traces, screenshots tied to a real Chrome tab, or debugging an already running Chrome instance.
- Use `agent-browser` for fast one-off browser actions from the terminal, such as opening pages, clicking through flows, filling forms, taking ad hoc screenshots, or scraping page content without building a full test.
- Prefer `Playwright` over the other two when the task may need to be checked into the codebase as a maintained automation.
- Prefer `chrome-devtools-mcp` over the other two when network, console, performance, or DevTools-level debugging is the main purpose.
- Prefer `agent-browser` over the other two when speed and low setup matter more than maintainable test code.
- Do not have multiple browser tools control the same browser instance, user data directory, or tab at the same time.
- In this repo, use the isolated entrypoints from `package.json` and `docs/browser-tooling.md` so each tool keeps its own profile and does not conflict with the others.

## Coding Style & Naming Conventions
- Stack: TypeScript, React function components, Tauri v2 APIs, Rust backend.
- Use 4-space indentation and keep style consistent with surrounding code in each file.
- Components use `PascalCase` filenames (for example `StatusBar.tsx`); hooks use `useCamelCase` (for example `useProxyStatus.ts`).
- Keep comments concise and business-focused; add Chinese comments only when logic is non-obvious.
- Prefer `@/` alias imports for deep renderer paths when it improves readability.

## Testing Guidelines
- No automated test framework is configured yet.
- Minimum pre-merge checks:
  1. Run `npm run build` and ensure no build/type errors.
  2. Run `npm run dev` and manually verify proxy start/stop, provider settings, model routing, and log streaming.
- If tests are introduced, place them under `src/**/__tests__/` and use `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
- This workspace currently has no initialized Git metadata, so follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`.
- Keep commits atomic and scoped to one intent.
- PRs should include a clear summary, motivation, verification steps, and UI screenshots/GIFs for interface changes.
- Link related issue/task IDs whenever available.

## Security & Configuration Tips
- Do not commit API keys, provider secrets, or local environment overrides.
- Use the local proxy endpoint `http://127.0.0.1:5055` for integration testing.
- Persist runtime settings through the Tauri IPC command/config store flow instead of hardcoding secrets.

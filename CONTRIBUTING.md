# Contributing to Claude Proxy

Thank you for considering a contribution. This guide covers the basics.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Ensure you have **Node.js 20+** and **Rust 1.77+** installed. See [Tauri prerequisites](https://tauri.app/start/prerequisites/) for platform build tools.
4. Start the dev server:

   ```bash
   npm run dev
   ```

## Project Structure

```
src/              React frontend (TypeScript)
src-tauri/src/    Rust backend (Tauri 2, Axum proxy)
public/           Static assets
```

Backend entry points:

- `lib.rs` — app setup, IPC registration
- `proxy.rs` — Axum HTTP server and routing
- `openai.rs` — OpenAI ↔ Anthropic conversion
- `config.rs` — config store and persistence
- `commands.rs` — Tauri IPC commands

## Development Workflow

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/your-feature
   ```

2. Make your changes. Keep commits focused and small.
3. Verify:
   - `npm run build` — frontend and Tauri bundle succeed
   - `npm run check:rust` — Rust code type-checks
   - Manually test the proxy: start service, switch providers, tail logs
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):

   ```
   feat: add XYZ provider preset
   fix: handle empty streaming chunks
   refactor: simplify config merge logic
   docs: clarify build instructions
   chore: bump tauri to 2.9
   ```

5. Push and open a Pull Request against `main`.

## Code Style

- **TypeScript / React**: 4-space indent, `PascalCase` components, `useCamelCase` hooks. Use the `@/` alias for deep imports.
- **Rust**: follow `rustfmt` defaults. All `serde` types use `#[serde(rename_all = "camelCase")]` for frontend JSON compatibility.
- **Comments**: concise and business-focused. No "what" comments when naming is clear.

## Pull Request Checklist

- [ ] Branch is up to date with `main`
- [ ] `npm run build` passes
- [ ] `npm run check:rust` passes
- [ ] Manually verified affected flows
- [ ] Commit messages follow Conventional Commits
- [ ] No secrets or personal data in the diff

## Reporting Bugs

Open an issue using the **Bug report** template. Include:

- Platform and OS version
- Claude Proxy version (from the app's About section)
- Steps to reproduce
- Expected vs. actual behavior
- Relevant log output (with API keys redacted)

## Requesting Features

Open an issue using the **Feature request** template. Describe the use case, not just the solution.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

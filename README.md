# Claude Proxy

[English](./README.md) | [简体中文](./README.zh-CN.md)

A local Claude API proxy desktop app built with **Tauri 2 + Rust + React**. It intercepts Claude/Anthropic API requests on `127.0.0.1:5055` and routes them to configurable upstream providers with per-model API key and base URL overrides.

![License](https://img.shields.io/github/license/LeoKun1231/claude-proxy)
![Release](https://img.shields.io/github/v/release/LeoKun1231/claude-proxy)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

## Features

- Local HTTP proxy on `127.0.0.1:5055` that intercepts Claude API traffic
- Multi-provider routing with 7 built-in providers and custom provider support
- Per-model overrides: route each source model to a different provider, base URL, API key, or target model name
- OpenAI ↔ Anthropic format compatibility layer (including streaming SSE)
- One-click system environment variable setup for `ANTHROPIC_BASE_URL`
- Real-time request log viewer with token usage tracking
- System tray, float ball, and autostart support
- Config persistence across restarts (`DATA_DIR/config.json`)

## Installation

Download the latest installer for your platform from the [Releases page](https://github.com/LeoKun1231/claude-proxy/releases):

| Platform | Artifact |
|---|---|
| Windows | `claude-proxy_<version>_x64-setup.exe` or `.msi` |
| macOS (Apple Silicon) | `claude-proxy_<version>_aarch64.dmg` |
| macOS (Intel) | `claude-proxy_<version>_x64.dmg` |
| Linux | `claude-proxy_<version>_amd64.AppImage` or `.deb` |

> macOS binaries are **not code-signed**. On first launch, right-click the app and choose "Open" to bypass Gatekeeper. Windows builds are also unsigned — SmartScreen may prompt once.

## Quick Start

1. Launch Claude Proxy and click **Start Service**. The proxy listens on `http://127.0.0.1:5055`.
2. Click **Apply Env Vars** to export `ANTHROPIC_BASE_URL` system-wide, or set it manually:

   ```bash
   # macOS / Linux
   export ANTHROPIC_BASE_URL=http://127.0.0.1:5055

   # Windows PowerShell
   $env:ANTHROPIC_BASE_URL = "http://127.0.0.1:5055"
   ```

3. Configure providers in the **Providers** tab (name, base URL, API key, model list).
4. Add per-model routes in the **Model Routing** tab to steer specific request models to specific providers/keys.
5. Pick a default fallback in **Default Fallback** for models that don't match any route.

Your Claude CLI, SDK, or any Anthropic-compatible client will now flow through the proxy.

## Build from Source

Prerequisites: **Node.js 20+**, **Rust 1.77+**, and platform build tools ([Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
git clone https://github.com/LeoKun1231/claude-proxy.git
cd claude-proxy
npm install

# Dev mode (desktop shell + hot-reload frontend)
npm run dev

# Frontend-only
npm run dev:web

# Production build (produces platform installer in src-tauri/target/release/bundle/)
npm run build
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React UI (src/)                                │
│  - Desktop workbench, float ball, log viewer    │
└────────────────┬────────────────────────────────┘
                 │ Tauri IPC
┌────────────────▼────────────────────────────────┐
│  Rust backend (src-tauri/src/)                  │
│  - config.rs     Thread-safe config store       │
│  - proxy.rs      Axum HTTP server (:5055)       │
│  - openai.rs     OpenAI ↔ Anthropic converter   │
│  - commands.rs   24 IPC commands                │
└─────────────────────────────────────────────────┘
```

Routing resolution order:
1. Exact model route match (with wildcard support)
2. Provider inference (source model listed in an enabled provider)
3. Legacy fallback mapping

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs are welcome.

## Security

Please report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © uzhao

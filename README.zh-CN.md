# Claude Proxy

[English](./README.md) | [简体中文](./README.zh-CN.md)

基于 **Tauri 2 + Rust + React** 的本地 Claude API 代理桌面应用。在 `127.0.0.1:5055` 拦截 Claude / Anthropic API 请求，按配置路由到不同上游 Provider，支持按模型粒度覆盖 API Key 与 Base URL。

![License](https://img.shields.io/github/license/LeoKun1231/claude-proxy)
![Release](https://img.shields.io/github/v/release/LeoKun1231/claude-proxy)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

## 功能特性

- 本地 HTTP 代理，`127.0.0.1:5055` 拦截 Claude API
- 多 Provider 路由：7 个内置 Provider + 自定义 Provider
- 模型级覆盖：每个源模型可路由到不同的 Provider、Base URL、API Key、目标模型名
- OpenAI ↔ Anthropic 双向格式兼容（含流式 SSE）
- 一键写入系统环境变量 `ANTHROPIC_BASE_URL`
- 实时日志查看器，含 token 用量统计
- 系统托盘、悬浮球、开机自启动
- 配置持久化（`DATA_DIR/config.json`）

## 安装

从 [Releases 页面](https://github.com/LeoKun1231/claude-proxy/releases) 下载对应平台安装包：

| 平台 | 文件 |
|---|---|
| Windows | `claude-proxy_<version>_x64-setup.exe` 或 `.msi` |
| macOS (Apple Silicon) | `claude-proxy_<version>_aarch64.dmg` |
| macOS (Intel) | `claude-proxy_<version>_x64.dmg` |
| Linux | `claude-proxy_<version>_amd64.AppImage` 或 `.deb` |

> macOS 安装包 **未签名**。首次运行请右键点击应用选择"打开"以绕过 Gatekeeper。Windows 同样未签名，SmartScreen 可能会提示一次。

## 快速开始

1. 启动 Claude Proxy，点击 **启动服务**。代理监听 `http://127.0.0.1:5055`。
2. 点击 **一键配置代理** 写入系统环境变量，或手动设置：

   ```bash
   # macOS / Linux
   export ANTHROPIC_BASE_URL=http://127.0.0.1:5055

   # Windows PowerShell
   $env:ANTHROPIC_BASE_URL = "http://127.0.0.1:5055"
   ```

3. 在 **Provider 配置** 中维护上游服务（名称、Base URL、API Key、模型列表）。
4. 在 **模型路由** 中为具体源模型配置目标 Provider / Key / 目标模型。
5. 在 **默认回退** 中选一个兜底 Provider，未命中任何路由时使用。

配置完成后，Claude CLI、SDK 或任何兼容 Anthropic 的客户端都会走代理。

## 从源码构建

依赖：**Node.js 20+**、**Rust 1.77+**、平台构建工具链（详见 [Tauri 先决条件](https://tauri.app/start/prerequisites/)）。

```bash
git clone https://github.com/LeoKun1231/claude-proxy.git
cd claude-proxy
npm install

# 桌面开发模式（带热更新的 Vite + Tauri 壳）
npm run dev

# 仅前端
npm run dev:web

# 打包安装包，产物在 src-tauri/target/release/bundle/
npm run build
```

## 架构

```
┌─────────────────────────────────────────────────┐
│  React UI (src/)                                │
│  桌面工作台、悬浮球、日志面板                     │
└────────────────┬────────────────────────────────┘
                 │ Tauri IPC
┌────────────────▼────────────────────────────────┐
│  Rust 后端 (src-tauri/src/)                     │
│  - config.rs     线程安全配置存储                 │
│  - proxy.rs      Axum HTTP 服务器 (:5055)        │
│  - openai.rs     OpenAI ↔ Anthropic 转换         │
│  - commands.rs   24 个 IPC 命令                  │
└─────────────────────────────────────────────────┘
```

路由命中顺序：
1. 模型路由精确匹配（支持通配符）
2. Provider 推断（源模型在某启用 Provider 的模型列表内）
3. Legacy fallback 映射

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。欢迎 Issue 和 PR。

## 安全

漏洞请私下上报，详见 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE) © uzhao

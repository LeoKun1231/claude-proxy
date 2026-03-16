# Browser Tooling

这个仓库为三套浏览器工具预留了互不共享的运行空间，目的是避免它们同时控制同一个 Chrome 实例、同一个 CDP 端口或同一个用户数据目录。

## 约定

| Tool | 隔离方式 | 默认入口 |
| --- | --- | --- |
| `agent-browser` | `./.browser-tools/agent-browser-profile` | `npm run browser:agent:app` |
| `Playwright` | `./.browser-tools/playwright-profile` | `npm run browser:playwright:app` |
| `chrome-devtools-mcp` | `./.browser-tools/chrome-mcp-profile` + `127.0.0.1:9223` | `npm run browser:chrome-mcp:app` |

## 为什么这样分

- `agent-browser` 适合 AI 或终端里的临时浏览器操作，例如打开页面、点击、截图、抓数据。
- `Playwright` 适合脚本化自动化和测试，默认单独拉起自己的浏览器上下文。
- `chrome-devtools-mcp` 适合 DevTools 级别的调试，例如 network、console、performance、Lighthouse。

把三者拆到不同 profile 和端口后，可以共存，不会互相覆盖 cookie、登录态和窗口状态。

## 标准命令

先启动项目：

```bash
npm run dev
```

检查环境：

```bash
npm run browser:doctor
```

打开 `agent-browser` 的隔离实例：

```bash
npm run browser:agent:app
```

对 `agent-browser` 传自定义命令：

```bash
npm run browser:agent -- snapshot -i
npm run browser:agent -- --headed open https://example.com
npm run browser:agent -- close
```

打开 `Playwright` 的隔离实例：

```bash
npm run browser:playwright:app
```

对 `Playwright` 传自定义 URL：

```bash
npm run browser:playwright -- https://example.com
```

启动 `chrome-devtools-mcp` 对应的独立 Chrome：

```bash
npm run browser:chrome-mcp:app
```

然后让 MCP server 连到这一个独立实例：

```bash
npm run browser:chrome-mcp:server
```

## 不冲突规则

- 不要让 `agent-browser` 用 `--cdp 9223` 去连 `chrome-devtools-mcp` 的浏览器。
- 不要让 `Playwright` 复用 `chrome-devtools-mcp` 或 `agent-browser` 的 profile 目录。
- 不要让两个工具同时操作同一个 tab。
- 如果你需要长期保留登录态，只在对应工具自己的 profile 里登录。

## 可调环境变量

### agent-browser

```bash
AGENT_BROWSER_PROFILE_DIR=/custom/path npm run browser:agent -- --headed open https://example.com
```

### Playwright

```bash
PLAYWRIGHT_PROFILE_DIR=/custom/path npm run browser:playwright -- https://example.com
PLAYWRIGHT_HEADLESS=1 npm run browser:playwright -- https://example.com
PLAYWRIGHT_CHANNEL=chrome npm run browser:playwright -- https://example.com
```

### chrome-devtools-mcp

```bash
CHROME_MCP_PORT=9333 npm run browser:chrome-mcp:browser -- https://example.com
CHROME_BIN=/usr/bin/google-chrome-stable npm run browser:chrome-mcp:browser -- https://example.com
```

## 推荐分工

- 页面测试、脚本化回归：`Playwright`
- 打开页面、截图、填表、抓内容：`agent-browser`
- 看请求、console、性能、DevTools trace：`chrome-devtools-mcp`

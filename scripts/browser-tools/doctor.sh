#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_PROFILE="${AGENT_BROWSER_PROFILE_DIR:-$ROOT_DIR/.browser-tools/agent-browser-profile}"
PLAYWRIGHT_PROFILE="${PLAYWRIGHT_PROFILE_DIR:-$ROOT_DIR/.browser-tools/playwright-profile}"
CHROME_MCP_PROFILE="${CHROME_MCP_PROFILE_DIR:-$ROOT_DIR/.browser-tools/chrome-mcp-profile}"
CHROME_MCP_PORT="${CHROME_MCP_PORT:-9223}"

find_chrome() {
    command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true
}

echo "Project root: $ROOT_DIR"
echo "Chrome: $(find_chrome || true)"
echo "agent-browser: $(command -v agent-browser || echo missing)"
echo "Playwright CLI: $ROOT_DIR/node_modules/.bin/playwright"
echo "chrome-devtools-mcp CLI: $ROOT_DIR/node_modules/.bin/chrome-devtools-mcp"
echo "agent-browser profile: $AGENT_PROFILE"
echo "Playwright profile: $PLAYWRIGHT_PROFILE"
echo "chrome-devtools-mcp profile: $CHROME_MCP_PROFILE"
echo "chrome-devtools-mcp port: $CHROME_MCP_PORT"

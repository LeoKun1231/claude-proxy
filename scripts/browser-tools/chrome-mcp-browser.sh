#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_DIR="${CHROME_MCP_PROFILE_DIR:-$ROOT_DIR/.browser-tools/chrome-mcp-profile}"
PORT="${CHROME_MCP_PORT:-9223}"
URL="${1:-about:blank}"

CHROME_BIN="${CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
    CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi

if [[ -z "$CHROME_BIN" ]]; then
    echo "Chrome or Chromium executable not found." >&2
    exit 1
fi

mkdir -p "$PROFILE_DIR"

exec "$CHROME_BIN" \
    --user-data-dir="$PROFILE_DIR" \
    --remote-debugging-port="$PORT" \
    --no-first-run \
    --no-default-browser-check \
    --new-window \
    "$URL"

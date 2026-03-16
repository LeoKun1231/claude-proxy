#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_DIR="${AGENT_BROWSER_PROFILE_DIR:-$ROOT_DIR/.browser-tools/agent-browser-profile}"

mkdir -p "$PROFILE_DIR"

if ! command -v agent-browser >/dev/null 2>&1; then
    echo "agent-browser is not installed. Run: npm install -g agent-browser" >&2
    exit 1
fi

exec agent-browser --profile "$PROFILE_DIR" "$@"

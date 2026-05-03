#!/usr/bin/env bash
set -euo pipefail

: "${USER:?load-and-run: USER is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${NODE_BIN:-}" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "${DAEMON_ENTRY:-}" ]; then
  DAEMON_ENTRY="$SCRIPT_DIR/daemon.mjs"
fi

: "${NODE_BIN:?load-and-run: NODE_BIN is required or node must be on PATH}"
: "${DAEMON_ENTRY:?load-and-run: DAEMON_ENTRY is required}"

TOKEN="$(security find-generic-password -s codex-im-bridge -a "$USER" -w 2>/dev/null || true)"

if [ -z "$TOKEN" ]; then
  echo "load-and-run: IM_TELEGRAM_BOT_TOKEN not found in Keychain (-s codex-im-bridge -a $USER)" >&2
  exit 1
fi

if [ "${1:-}" = "--dry-run" ]; then
  echo "IM_TELEGRAM_BOT_TOKEN: <set from Keychain, length=${#TOKEN}>"
  echo "NODE_BIN: $NODE_BIN"
  echo "DAEMON_ENTRY: $DAEMON_ENTRY"
  exit 0
fi

export IM_TELEGRAM_BOT_TOKEN="$TOKEN"
exec "$NODE_BIN" "$DAEMON_ENTRY"

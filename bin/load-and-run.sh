#!/usr/bin/env bash
set -euo pipefail

: "${USER:?load-and-run: USER is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "${NODE_BIN:-}" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "${DAEMON_ENTRY:-}" ]; then
  DAEMON_ENTRY="$BRIDGE_DIR/app/daemon.mjs"
fi
if [ -z "${CONFIG_PATH:-}" ]; then
  CONFIG_PATH="$BRIDGE_DIR/config.toml"
fi
if [ -z "${MIGRATIONS_DIR:-}" ]; then
  MIGRATIONS_DIR="$BRIDGE_DIR/app/migrations"
fi

: "${NODE_BIN:?load-and-run: NODE_BIN is required or node must be on PATH}"
: "${DAEMON_ENTRY:?load-and-run: DAEMON_ENTRY is required}"
: "${CONFIG_PATH:?load-and-run: CONFIG_PATH is required}"
: "${MIGRATIONS_DIR:?load-and-run: MIGRATIONS_DIR is required}"

read_keychain_secret() {
  local service="$1"
  security find-generic-password -s "$service" -a "$USER" -w 2>/dev/null || true
}

describe_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "$name: <unset>"
  else
    echo "$name: <set from Keychain/env, length=${#value}>"
  fi
}

TELEGRAM_TOKEN="${IM_TELEGRAM_BOT_TOKEN:-$(read_keychain_secret codex-im-bridge)}"
LARK_APP_SECRET_VALUE="${IM_LARK_APP_SECRET:-$(read_keychain_secret codex-im-bridge-lark)}"
DINGTALK_CLIENT_SECRET_VALUE="${DINGTALK_CLIENT_SECRET:-$(read_keychain_secret codex-im-bridge-dingtalk)}"

if [ -z "$TELEGRAM_TOKEN" ]; then
  echo "load-and-run: IM_TELEGRAM_BOT_TOKEN not found in Keychain (-s codex-im-bridge -a $USER)" >&2
  exit 1
fi

if [ "${1:-}" = "--dry-run" ]; then
  describe_secret "IM_TELEGRAM_BOT_TOKEN" "$TELEGRAM_TOKEN"
  describe_secret "IM_LARK_APP_SECRET" "$LARK_APP_SECRET_VALUE"
  describe_secret "DINGTALK_CLIENT_SECRET" "$DINGTALK_CLIENT_SECRET_VALUE"
  echo "NODE_BIN: $NODE_BIN"
  echo "DAEMON_ENTRY: $DAEMON_ENTRY"
  echo "CONFIG_PATH: $CONFIG_PATH"
  echo "MIGRATIONS_DIR: $MIGRATIONS_DIR"
  exit 0
fi

export IM_TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN"
if [ -n "$LARK_APP_SECRET_VALUE" ]; then
  export IM_LARK_APP_SECRET="$LARK_APP_SECRET_VALUE"
fi
if [ -n "$DINGTALK_CLIENT_SECRET_VALUE" ]; then
  export DINGTALK_CLIENT_SECRET="$DINGTALK_CLIENT_SECRET_VALUE"
fi
exec "$NODE_BIN" "$DAEMON_ENTRY" --config "$CONFIG_PATH" --migrations-dir "$MIGRATIONS_DIR" "$@"

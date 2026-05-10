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

describe_secret_presence() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "$name: missing"
  else
    echo "$name: present"
  fi
}

# Resolve every IM secret from env (preferred) or Keychain. Missing values are
# left empty here; this wrapper does not gate on which adapter is enabled.
# The daemon validates per-adapter requirements based on config.toml.
TELEGRAM_TOKEN="${IM_TELEGRAM_BOT_TOKEN:-$(read_keychain_secret codex-im-bridge)}"
LARK_APP_SECRET_VALUE="${IM_LARK_APP_SECRET:-$(read_keychain_secret codex-im-bridge-lark)}"
DINGTALK_CLIENT_SECRET_VALUE="${DINGTALK_CLIENT_SECRET:-$(read_keychain_secret codex-im-bridge-dingtalk)}"
SLACK_BOT_TOKEN_VALUE="${SLACK_BOT_TOKEN:-$(read_keychain_secret codex-im-bridge-slack-bot)}"
SLACK_APP_TOKEN_VALUE="${SLACK_APP_TOKEN:-$(read_keychain_secret codex-im-bridge-slack-app)}"

if [ "${1:-}" = "--dry-run" ]; then
  describe_secret_presence "IM_TELEGRAM_BOT_TOKEN" "$TELEGRAM_TOKEN"
  describe_secret_presence "IM_LARK_APP_SECRET" "$LARK_APP_SECRET_VALUE"
  describe_secret_presence "DINGTALK_CLIENT_SECRET" "$DINGTALK_CLIENT_SECRET_VALUE"
  describe_secret_presence "SLACK_BOT_TOKEN" "$SLACK_BOT_TOKEN_VALUE"
  describe_secret_presence "SLACK_APP_TOKEN" "$SLACK_APP_TOKEN_VALUE"
  echo "NODE_BIN: $NODE_BIN"
  echo "DAEMON_ENTRY: $DAEMON_ENTRY"
  echo "CONFIG_PATH: $CONFIG_PATH"
  echo "MIGRATIONS_DIR: $MIGRATIONS_DIR"
  exit 0
fi

if [ -n "$TELEGRAM_TOKEN" ]; then
  export IM_TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN"
fi
if [ -n "$LARK_APP_SECRET_VALUE" ]; then
  export IM_LARK_APP_SECRET="$LARK_APP_SECRET_VALUE"
fi
if [ -n "$DINGTALK_CLIENT_SECRET_VALUE" ]; then
  export DINGTALK_CLIENT_SECRET="$DINGTALK_CLIENT_SECRET_VALUE"
fi
if [ -n "$SLACK_BOT_TOKEN_VALUE" ]; then
  export SLACK_BOT_TOKEN="$SLACK_BOT_TOKEN_VALUE"
fi
if [ -n "$SLACK_APP_TOKEN_VALUE" ]; then
  export SLACK_APP_TOKEN="$SLACK_APP_TOKEN_VALUE"
fi
exec "$NODE_BIN" "$DAEMON_ENTRY" --config "$CONFIG_PATH" --migrations-dir "$MIGRATIONS_DIR" "$@"

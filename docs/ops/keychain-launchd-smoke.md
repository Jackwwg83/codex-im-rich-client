# Keychain Launchd Smoke

This is an operator-gated live smoke. It is documentation only for Phase 3 T29b; autonomous loop agents must not run these commands.

## Gate

Run only when both gates are set in the operator shell:

```bash
export TELEGRAM_LIVE=1
export KEYCHAIN_SMOKE=1
test "$TELEGRAM_LIVE $KEYCHAIN_SMOKE" = "1 1"
```

The operator must provide the Telegram token through a local environment variable. Do not paste the token into docs, Linear, logs, shell transcripts, or committed fixtures.

```bash
test -n "${IM_TELEGRAM_BOT_TOKEN:?set locally, do not commit or paste}"
```

## Preflight

```bash
git status --short
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm lint
pnpm protocol:check
pnpm launchd:install -- --dry-run
bash bin/load-and-run.sh --dry-run
```

Expected dry-run properties:

- `bin/load-and-run.sh --dry-run` prints `IM_TELEGRAM_BOT_TOKEN: <set from Keychain, length=N>`, `NODE_BIN`, and `DAEMON_ENTRY`.
- Dry-run output never prints the token bytes.
- `~/Library/LaunchAgents/io.codex-im-bridge.plist` never contains token bytes.

## Live Install

Only after the gate and preflight pass, load the token into the operator's Keychain and install the LaunchAgent.

```bash
security add-generic-password -U -s codex-im-bridge -a "$USER" -w "$IM_TELEGRAM_BOT_TOKEN"
pnpm launchd:install
launchctl print "gui/$(id -u)/io.codex-im-bridge"
```

## Redaction Checks

Run these checks before copying any output into an issue, document, or review packet.

```bash
PLIST="$HOME/Library/LaunchAgents/io.codex-im-bridge.plist"
LOG_DIR="$HOME/.codex-im-bridge/logs"
test -f "$PLIST"
! grep -F "$IM_TELEGRAM_BOT_TOKEN" "$PLIST"
! grep -R -F "$IM_TELEGRAM_BOT_TOKEN" "$LOG_DIR" 2>/dev/null
! grep -E '[0-9]{5,}:[A-Za-z0-9_-]{20,}' "$PLIST"
! grep -R -E '[0-9]{5,}:[A-Za-z0-9_-]{20,}' "$LOG_DIR" 2>/dev/null
```

If any redaction check fails, stop the smoke, unload the LaunchAgent, remove affected local logs, and do not paste the failing output anywhere.

## Rollback

```bash
PLIST="$HOME/Library/LaunchAgents/io.codex-im-bridge.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
security delete-generic-password -s codex-im-bridge -a "$USER" 2>/dev/null || true
```

The rollback intentionally removes only the LaunchAgent plist and the `codex-im-bridge` Keychain item for the current user. It does not delete the repository, SQLite state, backups, or logs.

## Completion Note

Record only:

- gate values were set,
- dry-run passed,
- install/load succeeded or failed,
- redaction checks passed or failed,
- rollback result.

Never record token bytes.

# Production Launch Runbook

Status: JAC-170 operator launch checklist for local Mac mini production
operation.

This runbook is for launching Codex IM Rich Client as a private local daemon.
It is not a public deployment guide.

## 1. Prerequisites

Required local baseline:

- macOS user account that owns the LaunchAgent.
- Node.js 24 or newer.
- pnpm 10.x.
- Codex CLI pinned to `0.128.0`.
- `codex login` completed for the operator account.
- Repository branch/tag chosen for launch.
- Telegram bot token available only in the operator shell/Keychain.

Verify:

```bash
node --version
pnpm --version
codex --version
git status --short
pnpm check:codex-version
```

Expected:

- `codex --version` prints `codex-cli 0.128.0`.
- `git status --short` contains no tracked changes.
- Untracked local runtime/review artifacts are not copied into docs, Linear, or
  review packets.

## 2. Mandatory Non-Live Preflight

Run:

```bash
pnpm release:check
```

For an ops-only rerun after the full gates already passed:

```bash
pnpm release:check -- --skip-full-gates
```

Expected:

- all mandatory gates pass;
- launchd install dry-run renders a plist;
- Keychain wrapper dry-run succeeds through the fake shim;
- SQLite backup proof writes only to a temp directory;
- fake Telegram/Lark/DingTalk smokes pass;
- live smoke commands either default-skip or stop at explicit operator gates;
- output contains no token-shaped material.

Do not continue to install if this command fails.

## 3. Secret Handling

Never put a real token in:

- git-tracked files;
- Linear;
- GPT/Codex consultation packets;
- docs;
- fixtures;
- SQLite;
- plist;
- logs.

The Telegram token must be loaded into Keychain only at launch time:

```bash
test -n "${IM_TELEGRAM_BOT_TOKEN:?set locally, do not paste}"
security add-generic-password -U -s codex-im-bridge -a "$USER" -w "$IM_TELEGRAM_BOT_TOKEN"
```

After this command, unset the shell variable if the shell will remain open:

```bash
unset IM_TELEGRAM_BOT_TOKEN
```

## 4. Dry-Run Launchd Plan

Run:

```bash
pnpm launchd:prepare --dry-run
pnpm launchd:install --dry-run
bash bin/load-and-run.sh --dry-run
```

Expected:

- plist path is under `~/Library/LaunchAgents/io.codex-im-bridge.plist`;
- wrapper is `~/.codex-im-bridge/bin/load-and-run.sh`;
- daemon entry is `~/.codex-im-bridge/bin/daemon.mjs`;
- token output is only `<set from Keychain, length=N>`;
- no token bytes appear.

## 5. Install And Start

Only after non-live preflight and dry-run pass:

```bash
pnpm launchd:prepare
pnpm launchd:install
launchctl print "gui/$(id -u)/io.codex-im-bridge"
```

Expected:

- LaunchAgent loads under the current GUI user;
- daemon starts through `~/.codex-im-bridge/bin/load-and-run.sh`;
- token is passed only through process environment after Keychain lookup;
- plist does not contain token bytes or token-looking literals.

## 6. Status, Logs, And Backups

Status snapshot:

```bash
pnpm exec tsx packages/cli/src/index.ts daemon status
```

SQLite backup:

```bash
pnpm db:backup
```

Log and plist redaction checks:

```bash
PLIST="$HOME/Library/LaunchAgents/io.codex-im-bridge.plist"
LOG_DIR="$HOME/.codex-im-bridge/logs"
test -f "$PLIST"
! grep -E '[0-9]{5,}:[A-Za-z0-9_-]{20,}' "$PLIST"
! grep -R -E '[0-9]{5,}:[A-Za-z0-9_-]{20,}' "$LOG_DIR" 2>/dev/null
```

If redaction checks fail, treat it as a release blocker. Stop the daemon,
remove affected local logs, and do not paste failing output anywhere.

## 7. Smoke Matrix

Safe unattended checks:

```bash
pnpm release:check -- --skip-full-gates
pnpm smoke:telegram-fake
pnpm smoke:lark-fake
pnpm smoke:dingtalk-fake
pnpm smoke:lark-live
pnpm smoke:dingtalk-live
pnpm smoke:computer-use-live
```

The last three default-skip unless explicit env gates are present.

Operator-gated live checks:

```bash
TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-live
TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-real
LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 ... pnpm smoke:lark-live
DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 ... pnpm smoke:dingtalk-live
COMPUTER_USE_LIVE=1 COMPUTER_USE_PROVIDER_VERIFIED=1 COMPUTER_USE_LIVE_DRY_RUN=1 ... pnpm smoke:computer-use-live
```

Live Telegram/Codex smokes can spend quota or contact external systems. Run
only when the operator intentionally sets the gates in a local shell.

## 8. Rollback

Unload and remove the LaunchAgent:

```bash
pnpm launchd:uninstall
```

If manual cleanup is needed:

```bash
PLIST="$HOME/Library/LaunchAgents/io.codex-im-bridge.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
security delete-generic-password -s codex-im-bridge -a "$USER" 2>/dev/null || true
```

Rollback intentionally does not delete:

- repository checkout;
- SQLite state;
- backups;
- non-secret logs unless a redaction failure occurred.

## 9. What To Record In Linear

Record only:

- git branch/tag/commit;
- command names and pass/fail status;
- redacted durations/counts;
- whether rollback was needed;
- whether redaction checks passed.

Never record:

- token bytes;
- Keychain output;
- cookies;
- private URLs;
- user IDs/chat IDs unless redacted;
- screenshots with private session data.

## 10. Stop Conditions

Stop the launch and rollback if any of these occur:

- plist/log/status output contains token-shaped material;
- daemon exposes a public listener;
- approval resolution bypasses broker/policy/messageRef validation;
- live smoke starts without explicit env gates;
- Computer Use launches from a normal prompt instead of explicit `/cu`;
- launchd install targets anything outside the current user's LaunchAgents.

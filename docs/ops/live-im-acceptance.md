# Live IM Acceptance Runbook

Status: real-environment acceptance runbook for Codex IM Rich Client.

This runbook turns the release candidate into a live-validated build. It uses
real IM test credentials, but credentials must stay local to the operator
machine.

## 1. Credential Rules

Never paste tokens, secrets, cookies, user IDs, chat IDs, or OAuth codes into:

- docs;
- Linear;
- GPT/Codex/Claude prompts;
- shell history when avoidable;
- screenshots;
- review packets.

When possible, enter secrets into the local shell with leading-space history
suppression or into Keychain. Record only present/missing and pass/fail.

## 2. Baseline

Run before any live smoke:

```bash
git status --short
pnpm release:check
```

Passing criteria:

- no tracked changes unrelated to live acceptance;
- full release preflight green;
- no token-shaped output.

## 3. Telegram

Needed:

- a Telegram bot token from BotFather;
- a disposable test chat with the bot;
- Codex CLI logged in locally for the real Codex smoke.

Commands:

```bash
pnpm smoke:telegram-fake
TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-live
TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-real
```

Passing criteria:

- fake smoke passes;
- live adapter starts and stops cleanly;
- real smoke completes one harmless Codex turn;
- output does not print the bot token.

Failure localization:

- missing live flag -> operator gate is working;
- missing token -> credential setup issue;
- Telegram adapter start failure -> bot token/network/Bot API issue;
- real smoke Codex failure -> Codex login/quota/app-server issue.

## 4. Lark / Feishu

Needed:

- Lark/Feishu custom app credentials;
- app permissions sufficient to send message/card to a test chat;
- test chat ID.

Commands:

```bash
pnpm smoke:lark-fake
LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 LARK_APP_ID="$APP_ID" LARK_APP_SECRET_ENV=LARK_APP_SECRET LARK_TARGET_CHAT_ID="$CHAT_ID" pnpm smoke:lark-live
LARK_LIVE=1 LARK_APP_ID="$APP_ID" LARK_APP_SECRET_ENV=LARK_APP_SECRET LARK_TARGET_CHAT_ID="$CHAT_ID" pnpm smoke:lark-live
```

The `LARK_APP_SECRET` variable must be set locally before these commands.

Passing criteria:

- fake smoke passes;
- dry-run prints `ready_dry_run` with redacted present/missing fields;
- live send reports `sent`;
- test chat receives the smoke message/card;
- output does not print app secret, access token, chat ID, or message ID.

Failure localization:

- missing required env -> local credential setup issue;
- SDK nonzero code -> app permission/chat ID/domain issue;
- no message in test chat after `sent` -> target chat or tenant routing issue.

## 5. DingTalk

Needed:

- DingTalk Stream app client ID;
- client secret stored in local env;
- Stream mode enabled for the test robot/app.

Commands:

```bash
pnpm smoke:dingtalk-fake
DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 DINGTALK_CLIENT_ID="$CLIENT_ID" DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET pnpm smoke:dingtalk-live
DINGTALK_LIVE=1 DINGTALK_CLIENT_ID="$CLIENT_ID" DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET DINGTALK_LIVE_DURATION_MS=5000 pnpm smoke:dingtalk-live
```

The `DINGTALK_CLIENT_SECRET` variable must be set locally before these commands.

Passing criteria:

- fake smoke passes;
- dry-run prints `ready_dry_run`;
- live Stream connection reaches `connected` and exits after bounded duration;
- output does not print client ID, client secret, tokens, user IDs, chat IDs, or
  callback payloads.

Failure localization:

- missing env -> local credential setup issue;
- auth/connect failure -> DingTalk app/robot Stream configuration issue;
- timeout/no connection -> network/proxy/Stream endpoint issue.

## 6. launchd / Keychain

Needed:

- Telegram token stored in Keychain service `codex-im-bridge`;
- release branch/tag checked out;
- `pnpm release:check` green.

Commands:

```bash
security find-generic-password -s codex-im-bridge -a "$USER" >/dev/null
pnpm launchd:install --dry-run
bash bin/load-and-run.sh --dry-run
pnpm launchd:install
launchctl print "gui/$(id -u)/io.codex-im-bridge"
```

Passing criteria:

- Keychain item exists but token bytes are never printed;
- dry-run shows token as `<set from Keychain, length=N>`;
- plist path is under current user's `~/Library/LaunchAgents`;
- daemon starts through the wrapper;
- plist and logs contain no token-shaped material.

Rollback:

```bash
pnpm launchd:uninstall
```

## 7. Evidence Format

Record results as:

```text
Platform:
Command:
Status: pass/fail
Duration:
Redaction: pass/fail
Observed external result:
Notes:
```

Do not record raw credential values or private identifiers.

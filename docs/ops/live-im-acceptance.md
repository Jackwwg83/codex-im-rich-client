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
pnpm smoke:daemon-roundtrip
TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-live
TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN="$TOKEN" pnpm smoke:telegram-side-by-side
```

Passing criteria:

- fake smoke passes;
- daemon roundtrip covers IM controls plus approval callback resolution without
  live services;
- live adapter starts and stops cleanly;
- side-by-side smoke completes one harmless Codex turn while the live Telegram
  adapter starts/stops;
- output does not print the bot token.

### Telegram Web daemon acceptance

For an end-to-end user-visible acceptance pass, run the daemon from the local
Keychain wrapper, then use Telegram Web with the test bot:

```bash
bash ~/.codex-im-bridge/bin/load-and-run.sh
```

In Telegram Web:

```text
/start
/use codex-im
Reply exactly: OK
Run this shell command touch /tmp/codex-im-live-approval-test.txt
```

Required observations:

- `/use codex-im` returns `Using project codex-im`;
- `Reply exactly: OK` returns `OK`;
- a write command in read-only sandbox renders an approval card with
  `Allow once`, `Allow session`, `Decline`, and `Abort`;
- `Allow once` runs the command and edits the card to a resolved card with no
  action buttons;
- `Decline` does not run the command and records a resolved decline;
- `Abort` interrupts the turn and does not run the command;
- `Allow session` runs the approved command, and a subsequent exact same
  command can run without a new callback token;
- a different command/path may still request a new approval, which is acceptable
  conservative Codex session-grant scoping.

### Telegram scenario coverage plan

Use Telegram Web as the user-visible driver, and verify every scenario with at
least one non-UI signal: SQLite callback/binding rows, filesystem side effects,
daemon logs, or the bounded smoke command exit code. Do not rely only on what
the chat bubble appears to show.

| Area | Telegram input/action | Expected user-visible result | Non-UI assertion |
|---|---|---|---|
| Bot bootstrap | `/start` | bot remains reachable; no crash | daemon keeps polling |
| Project binding | `/use codex-im` | `Using project codex-im` | `thread_bindings` row exists for Telegram target |
| Invalid project | `/use does-not-exist` | explicit unknown-project reply | no binding overwrite |
| Basic turn | `Reply exactly: OK` | bot replies `OK` | `active_turn_id` clears after completion |
| Sequential turns | send two harmless prompts one after another | both complete in order | same target remains bound; no pending turn leak |
| Long reply/edit | ask for a 20-line numbered list | working message edits to final text | no Telegram edit error in daemon log |
| Development diagnostic | ask Codex to run `git status --short` and `git log --oneline -3` | concise repo-status reply | no file modifications; `active_turn_id` clears |
| Stale thread recovery | restart daemon/app-server, then send a prompt using the restored binding | prompt routes instead of disappearing | binding is rebound to a fresh Codex thread if old thread is rejected |
| Approval render | ask to `touch` a `/tmp/codex-im-live-*` file | approval card with four actions | four callback tokens bound to one `messageRef` |
| Allow once | tap `Allow once` | command runs; resolved card has no buttons | selected token `used`, siblings `revoked`, file exists |
| Decline | tap `Decline` | command not run; decline text rendered | selected token `used`, file absent |
| Abort | tap `Abort` | turn interrupted | selected token `used`, file absent, turn not left active |
| Allow session exact reuse | approve `printf ... >> file`, then send exact same prompt | second command runs without a new card | file grows twice; no new callback token row |
| Allow session scoped change | after session approval, send different command/path | fresh approval is requested | new `approvalId` and new callback token group |
| Duplicate click | click one approval action, then try another action on same card if still possible | second action fails closed or buttons are gone | only one token is `used`; siblings are `revoked` |
| Pending restart | create a pending card, restart daemon, then click the card | fails closed visibly; no command runs | stale active turns clear and bound callback tokens revoke on daemon startup |
| Stop idle | send `/stop` when no turn is active | `No active Codex turn.` | no active turn is created |
| Stop active | send `/stop` while a Codex turn is active | working message changes to interrupted | `turnInterrupt` is called and `active_turn_id` clears |
| Unauthorized private chat | message from non-allowlisted Telegram user | ignored or denied | no thread binding, no turn started |
| Group mention | message bot in a test group with configured allowlist | only authorized target routes | target includes expected group chat/thread metadata |
| Telegram API downtime | stop network or use invalid token in smoke | explicit smoke failure | no token bytes printed |
| Redaction | inspect plist/logs/SQLite/docs after live run | no secret material visible | grep for token-shaped material returns empty |

Suggested execution order for broad live coverage:

1. Run `pnpm release:check` to prove the non-live baseline.
2. Run `smoke:telegram-live` and `smoke:telegram-side-by-side` with the token
   loaded from Keychain.
3. Run the Telegram Web private-chat scenarios from bootstrap through approval
   actions.
4. Run resilience scenarios: duplicate click, pending restart, and exact-session
   reuse.
5. Run development-task scenarios: read-only repo diagnostics, stale-thread
   recovery after restart, and `/stop` idle/active behavior.
6. If a disposable group is available, run group and allowlist scenarios.
7. Finish with redaction checks over generated plist, daemon logs, SQLite, and
   docs before recording evidence.

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
pnpm bridge:build
pnpm bridge:install --dry-run
pnpm bridge:install
pnpm launchd:install --dry-run
~/.codex-im-bridge/bin/load-and-run.sh --dry-run
pnpm launchd:install
launchctl print "gui/$(id -u)/io.codex-im-bridge"
```

Passing criteria:

- Keychain item exists but token bytes are never printed;
- daemon app is installed under `~/.codex-im-bridge/app/` before live install;
- wrapper is installed under `~/.codex-im-bridge/bin/`;
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

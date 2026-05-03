# Live IM Acceptance Status

> Single source of truth for real Telegram/Lark/DingTalk/Codex App live
> acceptance after `production-readiness-2026-05-03-r2`.
> **Last updated:** 2026-05-03 - Telegram real bot + real Codex turn +
> approval callback acceptance + development-task control acceptance passed
> with redacted Keychain credential; Lark/DingTalk live acceptance remains
> pending.

---

## 1. Current State

- **Mode:** Live IM acceptance.
- **Branch:** `codex/live-im-acceptance`.
- **Base release candidate:** `production-readiness-2026-05-03-r2`.
- **Release candidate status:** non-live gates, fake smokes, contract tests,
  outside-voice review, and GitHub Actions CI are green.
- **Live acceptance status:** Telegram real acceptance passed; Lark/DingTalk
  live acceptance pending.
- **Credential status:** Telegram token is present only in local Keychain
  service `codex-im-bridge`; no token bytes are recorded in repo docs, logs, or
  Linear. Lark/DingTalk live credentials are not configured for this pass.

## 2. Correct Acceptance Language

Use this wording until all enabled live platform smokes pass:

```text
Release candidate complete; Telegram live acceptance passed; Lark/DingTalk live acceptance pending.
```

Do not claim that the product is actually live-validated or production accepted
until the matrix below is complete with real credentials and redacted evidence.

## 3. Live Acceptance Matrix

| Area | Required check | Status | Evidence target |
|---|---|---|---|
| Baseline | `pnpm release:check` | pass | 2026-05-03 local run, exit 0 |
| Telegram fake | `pnpm smoke:telegram-fake` | pass | covered by `pnpm release:check`, exit 0 |
| Telegram live adapter | `TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-live` | pass | real bot token from Keychain; adapter start/stop bounded; no token output |
| Telegram + real Codex | `TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-real` | pass | harmless real turn `Reply exactly: OK` completed through real bot |
| Telegram Web / daemon reply | `/use codex-im` then `Reply exactly: OK` in Telegram Web | pass | bot replied `Using project codex-im`, then `OK`; SQLite binding created and active turn cleared |
| Telegram Web / project rejection | `/use does-not-exist` in Telegram Web | pass | bot replied `Unknown project: does-not-exist`; current binding not overwritten |
| Telegram Web / sequential turns | two harmless prompts sent sequentially | pass | bot replied `FIRST-LIVE-2008` and `SECOND-LIVE-2008`; active turn cleared after both |
| Telegram Web / long reply projection | 12-line exact reply prompt | pass | final Telegram message contained `LIVE-LINE-01` through `LIVE-LINE-12` |
| Telegram Web / development diagnostic | read-only `git status --short` + `git log --oneline -3` prompt | pass | bot replied `DEV-STATUS-2034 branch dirty (7 modified files); latest commit 6c1be36...`; SQLite active turn cleared |
| Telegram Web / stale thread recovery | send prompt after daemon/app-server restart with persisted old `codex_thread_id` | pass | daemon created a fresh Codex thread and routed the turn; no silent drop |
| Telegram Web / startup stale state cleanup | restart daemon with stale active turn and bound callback tokens | pass | `thread_bindings.active_turn_id` cleared; stale bound callback tokens revoked; pending write file remained absent |
| Telegram Web / stop idle feedback | `/stop` when no active Codex turn exists | pass | bot replied `No active Codex turn.` |
| Telegram Web / approval allow once | shell command requiring approval, tap `Allow once` | pass | command ran once; callback token `allow_once=used`, sibling tokens revoked; resolved card has no buttons |
| Telegram Web / approval decline | shell command requiring approval, tap `Decline` | pass | command not run; decline response rendered; target file absent; token `decline=used` |
| Telegram Web / approval abort | shell command requiring approval, tap `Abort` | pass | Codex turn interrupted; target file absent; token `abort=used` |
| Telegram Web / approval allow session | exact same shell command sent twice, first tap `Allow session` | pass | first command approved; second exact command ran without a new callback token; output file grew from 13 to 26 bytes |
| Lark fake | `pnpm smoke:lark-fake` | pass | covered by `pnpm release:check`, exit 0 |
| Lark live dry-run | `LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 ... pnpm smoke:lark-live` | pending | `ready_dry_run`, redacted |
| Lark live send | `LARK_LIVE=1 ... pnpm smoke:lark-live` | pending | message/card sent to test chat |
| DingTalk fake | `pnpm smoke:dingtalk-fake` | pass | covered by `pnpm release:check`, exit 0 |
| DingTalk live dry-run | `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 ... pnpm smoke:dingtalk-live` | pending | `ready_dry_run`, redacted |
| DingTalk live Stream | `DINGTALK_LIVE=1 ... pnpm smoke:dingtalk-live` | pending | bounded Stream connection completes |
| bridge install preflight | `pnpm bridge:build && pnpm bridge:install -- --home <temp>` | pass | app daemon, wrapper, migrations, and native runtime deps installed; daemon preflight `ok` |
| launchd dry-run | `pnpm launchd:install --dry-run && ~/.codex-im-bridge/bin/load-and-run.sh --dry-run` | pass | covered by `pnpm release:check`, exit 0 |
| Keychain | `security find-generic-password -s codex-im-bridge -a "$USER"` | pass | presence verified; token bytes never printed |
| launchd live start | `pnpm launchd:install` + `launchctl print ...` | pending | daemon starts under user LaunchAgent |
| Redaction | plist/log grep for token-shaped output | pending | no token-shaped material |

Computer Use remains dry-run readiness only in the current release candidate;
real desktop execution is not part of live IM acceptance until a reviewed real
provider is implemented.

## 4. Passing Criteria

Live IM acceptance is complete only when:

- every enabled real platform smoke completes with real test credentials;
- the Telegram real smoke completes one harmless real Codex turn;
- live output is redacted and does not contain bot tokens, app secrets, access
  tokens, cookies, private chat IDs, or private user IDs;
- launchd/Keychain start path works without token bytes in plist/logs;
- rollback/dry-run commands are known-good;
- Linear/repo handoff records only redacted evidence.

## 5. Stop Conditions

Stop and treat as a blocker if:

- any live command prints token-shaped material;
- a live command runs without its explicit `*_LIVE=1` gate;
- Telegram real smoke cannot complete a harmless Codex turn;
- Lark/DingTalk reports live auth success but cannot perform the documented
  dry-run or live path;
- launchd writes a token into plist/logs;
- daemon exposes a public listener;
- approval/callback decisions bypass broker, policy, callback token, or
  messageRef validation.

## 6. Evidence Log

- 2026-05-03: `pnpm release:check` passed on
  `codex/live-im-acceptance` at base `production-readiness-2026-05-03-r2`.
  Covered typecheck, test, CLI smoke, lint, protocol check, fixture verify,
  launchd install dry-run, load-and-run dry-run, db backup proof,
  Telegram/Lark/DingTalk fake smokes, live default gates, and Computer Use
  default skip.
- 2026-05-03: Telegram live credential stored in local Keychain service
  `codex-im-bridge`; `bin/load-and-run.sh --dry-run` resolved `NODE_BIN`,
  `DAEMON_ENTRY`, and token presence without printing token bytes.
- 2026-05-03: `pnpm smoke:telegram-live` passed against real bot
  `@jackcodexbot`; adapter start/stop completed with live gate enabled and
  redacted output.
- 2026-05-03: `pnpm smoke:telegram-real` passed with
  `CODEX_REAL_SMOKE=1` and prompt `Reply exactly: OK`; real Telegram + real
  Codex turn returned `OK`.
- 2026-05-03: Telegram Web foreground daemon acceptance passed for project
  selection, real Codex reply, and callback approvals. Actions verified:
  `Allow once`, `Decline`, `Abort`, `Allow session` current approval, and exact
  command session reuse. Distinct shell command/path after `Allow session`
  requested a fresh approval, which matches conservative Codex session-grant
  scoping.
- 2026-05-03: `pnpm release:check` re-ran after live fixes and passed. Full
  local suite was 141 test files, 1256 passing, 1 skipped; default live gates
  remained gated/skipped.
- 2026-05-03: `smoke:telegram-live` re-ran after the grammY polling shutdown
  fix and passed with `started=true stopped=true`.
- 2026-05-03: Telegram Web real daemon resilience pass covered invalid project,
  sequential turns, 12-line long reply projection, stale persisted Codex thread
  recovery after daemon restart, startup cleanup of stale active turns and bound
  callback tokens, and read-only development diagnostic prompt
  `DEV-STATUS-2034`.
- 2026-05-03: Telegram Web `/stop` behavior clarified against real Codex App
  semantics. When a turn is active, unit coverage now asserts immediate
  interrupted output projection and active-turn cleanup. In live Telegram, a
  long shell command prompt completed as Codex output `Command started and is
  still running after 1s.` and left no active turn; a subsequent `/stop`
  correctly replied `No active Codex turn.` rather than pretending an IM-owned
  background task existed.

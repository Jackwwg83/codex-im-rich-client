# Live IM Acceptance Status

> Single source of truth for real Telegram/Lark/DingTalk/Codex App live
> acceptance after `production-readiness-2026-05-03-r2`.
> **Last updated:** 2026-05-04 - Telegram real bot + real Codex turn +
> approval callback acceptance + development-task control acceptance passed.
> Feishu/Lark now also passes launchd daemon inbound, `/status`, `/use`,
> real Codex prompt/reply, live card schema delivery, CardKit terminal-card
> refresh, and the real approval `Allow once` callback path. DingTalk production
> now has a configurable OpenAPI card client for create/update plus Stream
> action acknowledgement safety, and `smoke:dingtalk-live` now has an explicit
> redacted `DINGTALK_LIVE_CARD=1` OpenAPI send/update gate with AppKey-derived
> robot-code fallback and optional target capture from a real inbound robot
> message; DingTalk real inbound/card direct-use remains pending on a usable
> client/session and card-template configuration.

---

## 1. Current State

- **Mode:** Live IM acceptance.
- **Branch:** `codex/live-im-acceptance`.
- **Base release candidate:** `production-readiness-2026-05-03-r2`.
- **Release candidate status:** non-live gates, fake smokes, contract tests,
  outside-voice review, and GitHub Actions CI are green.
- **Live acceptance status:** Telegram real direct-use acceptance is green.
  Feishu/Lark live-smoke, direct-use prompt paths, and real `Allow once`
  approval callback are green, including terminal approval-card visual refresh
  through Feishu CardKit. DingTalk live-smoke Stream acceptance is green, and
  production card send/update is now wired behind explicit `card_template_id`
  config with optional `robot_code` override; real inbound/card direct-use still
  needs `Card.Instance.Write`, a usable DingTalk client/session, and a matching
  card template.
- **Credential status:** Telegram token is present only in local Keychain
  service `codex-im-bridge`; Feishu/Lark and DingTalk test credentials were
  used only through local environment variables / browser session state. No
  token, app secret, chat id, user id, or message id bytes are recorded in repo
  docs, logs, or Linear.

## 2. Correct Acceptance Language

Use this wording until all enabled live platform smokes pass:

```text
Release candidate complete; Telegram live acceptance passed. Feishu/Lark prompt direct-use, card-schema live acceptance, CardKit card update, and real approval Allow-once callback passed. DingTalk Stream live acceptance passed; DingTalk production card send/update is wired but direct-use inbound/card remains pending on a usable client/session and card-template configuration.
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
| Lark live dry-run | `LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 ... pnpm smoke:lark-live` | pass | `ready_dry_run`, redacted |
| Lark live send | `LARK_LIVE=1 ... pnpm smoke:lark-live` | pass | Feishu test app published, dedicated live-smoke chat created, redacted message send succeeded |
| Lark launchd inbound | Feishu Web `/status` into installed launchd daemon | pass | SQLite audit recorded `inbound.message_allowed`; bot replied status |
| Lark project binding | Feishu Web `/use codex-im` | pass | SQLite Lark `thread_bindings` row for `codex-im`; bot replied `Using project codex-im` |
| Lark real Codex prompt | Feishu Web `Reply exactly: LARK-CODEX-OK` | pass | real Codex thread created; bot replied `LARK-CODEX-OK` |
| Lark approval card schema + CardKit update | `LARK_LIVE=1 LARK_LIVE_CARD=1 LARK_LIVE_CARD_UPDATE=1 ... pnpm smoke:lark-live` | pass | Feishu accepted Card JSON 2.0 `body.elements`; CardKit `idConvert` + `update` completed with redacted message-id evidence |
| Lark approval callback | real write command requiring approval from Feishu Web, tap `Allow once` | pass | Feishu Web click reached launchd daemon; callback token `allow_once=used`, sibling tokens revoked, target `/tmp` file created, and Codex returned `Ran ...` |
| Lark terminal approval card visual refresh | resolved approval card should remove buttons / show resolved status | pass | After launchd reinstall, Feishu Web approval resolved via CardKit; reload preserved `Status: resolved` and zero visible `Allow once` buttons |
| DingTalk fake | `pnpm smoke:dingtalk-fake` | pass | covered by `pnpm release:check`, exit 0 |
| DingTalk live dry-run | `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 ... pnpm smoke:dingtalk-live` | pass | `ready_dry_run`, redacted |
| DingTalk live Stream | `DINGTALK_LIVE=1 ... pnpm smoke:dingtalk-live` | pass | bounded Stream connection completed against test app |
| DingTalk production card client | `createDingTalkOpenApiCardClient` token + `createAndDeliver` + `updateCard` tests | pass | production `daemon run` now injects a real OpenAPI card client when `card_template_id` is configured, deriving robot code from AppKey/client id unless `robot_code` overrides it; errors are sanitized |
| DingTalk live card OpenAPI gate | `DINGTALK_LIVE=1 DINGTALK_LIVE_CARD=1 ... pnpm smoke:dingtalk-live` | ready | explicit redacted live card send/update gate exists; `robot_code` can derive from AppKey/client id; target can be supplied or captured from one real inbound robot message; real pass still needs `card_template_id` |
| DingTalk real inbound/card direct-use | real user message and approval/card round-trip | pending | needs `Card.Instance.Write` opened, a matching card template, and one real inbound robot message; Stream connected but no real inbound event was produced |
| bridge install preflight | `pnpm bridge:build && pnpm bridge:install -- --home <temp>` | pass | app daemon, wrapper, migrations, and native runtime deps installed; daemon preflight `ok` |
| launchd dry-run | `pnpm launchd:install --dry-run && ~/.codex-im-bridge/bin/load-and-run.sh --dry-run` | pass | covered by `pnpm release:check`, exit 0 |
| Keychain | `security find-generic-password -s codex-im-bridge -a "$USER"` | pass | presence verified; token bytes never printed |
| launchd live start | `pnpm bridge:build && pnpm bridge:install && launchctl kickstart -k ... && pnpm launchd:status` | pass | installed daemon starts under user LaunchAgent with redacted secret presence and `pendingApprovals=0` |
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
- 2026-05-04: Feishu/Lark live acceptance passed with a test self-built app.
  App ID presence, App Secret presence, and tenant token were verified without
  recording secret bytes. Required IM permissions were opened, the app was
  published to a limited test scope, a dedicated `Codex IM Live Smoke` chat was
  created by OpenAPI when the bot had no existing chats, and
  `pnpm smoke:lark-live` passed both dry-run and real send. Output recorded only
  redacted presence/status fields.
- 2026-05-04: DingTalk live acceptance passed with the `机革小虾` test app.
  AppKey/AppSecret presence was read from the developer console without
  recording secret bytes. `pnpm smoke:dingtalk-live` passed dry-run and a
  bounded 5-second Stream connection; redacted status reported
  `connected`, `robotEvents=0`, and `cardEvents=0`.
- 2026-05-04: Multi-platform daemon entrypoint landed locally: production
  `daemon run` now instantiates Telegram, Lark, and DingTalk adapters from one
  platform-routing surface instead of hard-coding Telegram. Installed bridge
  runtime now ships external Lark/DingTalk SDK packages, and the launchd
  Keychain wrapper injects Telegram/Lark/DingTalk secrets without writing them
  to plist or logs. Local gates passed: `pnpm typecheck`, `pnpm test`,
  `pnpm lint`, and `pnpm protocol:check`. Installed bridge preflight passed,
  and launchd was kickstarted to the newly installed daemon bundle.
- 2026-05-04: Feishu/Lark event subscription was changed to long connection,
  `im.message.receive_v1` was added, and version `1.0.1` was published in the
  test app. A short local WS listener reached `ws client ready`, but Feishu Web
  automation did not yet produce an inbound bot message; Lark inbound
  direct-use remains the next live-test gap.
- 2026-05-04: Feishu/Lark direct-use advanced past the previous gap. Installed
  launchd daemon received real Feishu Web `/status`, `/use codex-im`, and a
  real Codex prompt. SQLite audit recorded `inbound.message_allowed` without
  persisting message bodies, Lark binding was written for `codex-im`, and the
  bot replied `LARK-CODEX-OK` for a real Codex turn.
- 2026-05-04: First real Lark approval attempt exposed a platform card payload
  bug: Feishu rejected root-level `elements` with `230099`. Commit `be41071`
  changed the renderer to Card JSON 2.0 `body.elements`; the later live
  callback fix changed button callback values to an exact `{ token: "v1:..." }`
  object, kept raw string callback compatibility for received events, and
  returned an immediate long-connection toast ACK for valid card actions.
  A fresh Feishu Web write approval then passed: `Allow once` reached the
  launchd daemon, SQLite recorded `allow_once=used` with sibling tokens
  `revoked`, the target `/tmp` file was created, and Codex returned `Ran ...`.
- 2026-05-04: Lark terminal approval-card refresh moved from
  `im.message.patch` to Feishu CardKit `idConvert` + full-card `update`.
  The test app opened `cardkit:card:read` and `cardkit:card:write` only for the
  redacted test app. `LARK_LIVE=1 LARK_LIVE_CARD=1 LARK_LIVE_CARD_UPDATE=1
  pnpm smoke:lark-live` passed. After rebuilding/installing the bridge and
  restarting launchd, a real Feishu Web write approval resolved through
  `Allow once`; the target `/tmp` file existed, SQLite showed the latest
  `allow_once` token as `used` with sibling tokens `revoked`, `pnpm
  launchd:status` reported `pendingApprovals=0`, and a Feishu Web reload still
  showed the terminal approval card as `Status: resolved` with no visible
  `Allow once` button.
- 2026-05-04: Lark SDK error handling was hardened after a live CardKit
  permission failure showed that raw Axios errors can include bearer headers if
  left uncaught. The Lark SDK client now uses a silent SDK logger and wraps SDK
  failures in sanitized errors before they can reach smoke or daemon output.
- 2026-05-04: DingTalk production readiness was tightened locally. `daemon run`
  now injects a real DingTalk OpenAPI card client when `card_template_id` is
  present, deriving robot code from AppKey/client id unless `robot_code`
  overrides it, using `/v1.0/oauth2/accessToken`,
  `/v1.0/card/instances/createAndDeliver`, and `/v1.0/card/instances` without
  adding an SDK dependency. Private DingTalk robot messages now use
  `senderStaffId` as the target chat id so `IM_ROBOT.<staffId>` card callbacks
  can satisfy messageRef/target validation. Local gates passed: `pnpm
  typecheck`, `pnpm lint`, `pnpm protocol:check`, `pnpm exec vitest run
  packages/im-dingtalk/test`, and `pnpm test` (148 files, 1355 passing, 1
  skipped).
- 2026-05-04: `smoke:dingtalk-live` gained an explicit
  `DINGTALK_LIVE_CARD=1` gate for redacted real OpenAPI approval-card
  send/update acceptance. The gate blocks before card network access if
  `DINGTALK_CARD_TEMPLATE_ID` is missing, or if no `DINGTALK_TARGET_CHAT_ID` is
  supplied and capture mode is disabled; it derives `DINGTALK_ROBOT_CODE` from
  `DINGTALK_CLIENT_ID` when omitted, and records only presence/status evidence.
  Local gates passed: `pnpm exec vitest run
  packages/im-dingtalk/test` (12 files, 107 passing), `pnpm typecheck`, `pnpm
  lint`, `pnpm protocol:check`, and `pnpm test` (148 files, 1356 passing, 1
  skipped).
- 2026-05-04: DingTalk card live smoke gained optional target capture. With
  `DINGTALK_LIVE_CAPTURE_TARGET=1`, the harness listens for one real inbound
  robot message during the bounded smoke window, uses that message's normalized
  target for the OpenAPI card send/update, and records only the redacted target
  source (`captured`), not the staff/group id.
- 2026-05-04: Read-only DingTalk developer-console check found the test app's
  `Card.Instance.Write` permission is still `未开通`. A redacted negative
  OpenAPI probe using live page credentials reached `accessToken` successfully
  and failed at `createAndDeliver` with HTTP 403, matching the missing card
  permission / template access blocker. No target id, app secret, or token bytes
  were recorded. Local gates passed: DingTalk targeted tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm test` (148 files, 1357 passing, 1 skipped), `pnpm
  protocol:check`, and `pnpm release:check -- --skip-full-gates`.

# Live IM Acceptance Status

> Single source of truth for real Telegram/Lark/DingTalk/Codex App live
> acceptance after `production-readiness-2026-05-03-r2`.
> **Last updated:** 2026-05-07 - Telegram real bot + real Codex turn +
> approval callback acceptance + development-task control acceptance passed.
> Feishu/Lark now also passes launchd daemon inbound, `/status`, `/use`,
> real Codex prompt/reply, live card schema delivery, CardKit terminal-card
> refresh, and the real approval `Allow once` / `Decline` / `Abort` /
> `Allow session` reuse matrix. A fresh Feishu Web regression on 2026-05-05
> also proved real prompt/reply after stale-thread recovery. DingTalk production
> now passes Stream start, OpenAPI card send/update, installed readiness, real
> desktop inbound prompt/status, approval card delivery, and the explicit
> `DINGTALK_LIVE_CARD_CALLBACK=1` live callback probe. The 2026-05-06 real
> client click sent one Stream card callback and normalized one action with
> `callbackMessageRef=present`, `callbackAction=present`, and redacted raw-shape
> evidence. The fix was to accept DingTalk's real private callback shape:
> `cardPrivateData.params.action` plus `spaceType=IM` / `userId` target fallback,
> while keeping callback-token/messageRef validation fail-closed. DingTalk text
> refs append through the session reply path instead of true in-place text
> editing, and JAC-238 now models that as explicit lifecycle semantics: daemon
> suppresses progress edits for append-only refs and sends one terminal reply
> for short output. Launchd has been restored with the rebuilt daemon and
> readiness remains green.
> Telegram/Lark outbound and inbound file/image attachment support is now
> implemented at the adapter contract layer. Inbound images are passed to Codex
> as native `UserInput.localImage`; inbound generic files are passed as local
> path context because Codex App Server has no generic `UserInput.file` shape.
> DingTalk attachments remain unsupported pending a real platform delivery path.
> Daemon terminal output can now deliver completed Codex
> `imageGeneration.savedPath` artifacts as IM files after the text summary;
> explicit live file-send gates now prove the Telegram and Feishu/Lark platform
> APIs end to end.

---

## 1. Current State

- **Mode:** Live IM acceptance.
- **Branch:** `codex/live-im-acceptance`.
- **Base release candidate:** `production-readiness-2026-05-03-r2`.
- **Release candidate status:** non-live gates, fake smokes, contract tests,
  outside-voice review, and GitHub Actions CI are green.
- **Live acceptance status:** Telegram real direct-use acceptance is green.
  Feishu/Lark live-smoke, direct-use prompt paths, and the real approval
  callback matrix are green, including terminal approval-card visual refresh
  through Feishu CardKit and `Allow session` reuse for the exact same command.
  A fresh Feishu Web prompt regression on 2026-05-05 returned exactly
  `FEISHU-CODEX-REGRESSION-1207` after the daemon recovered from an old
  missing Codex thread by rebinding a fresh thread.
  DingTalk live-smoke Stream acceptance is green, and the OpenAPI card
  send/update gate is now green with explicit `card_template_id` config,
  optional `robot_code` override, IM_ROBOT `userId` delivery, redacted
  contact-discovered target, published-template parameter alignment, and
  fail-closed delivery-result diagnostics; real installed config/readiness is
  now green. Real DingTalk desktop inbound now passes prompt/reply and
  `/status`; approval card delivery creates bound callback tokens. The explicit
  `DINGTALK_LIVE_CARD_CALLBACK=1` live gate now also passes with one real
  DingTalk Desktop click: `rawCardCallbacks=1`, `normalizedCardActions=1`,
  `cardEvents=1`, `callbackMessageRef=present`, and `callbackAction=present`.
- **Credential status:** Telegram token is present only in local Keychain
  service `codex-im-bridge`; Feishu/Lark and DingTalk test credentials were
  used only through local environment variables / browser session state. No
  token, app secret, chat id, user id, or message id bytes are recorded in repo
  docs, logs, or Linear.

## 2. Correct Acceptance Language

Use this wording until all enabled live platform smokes pass:

```text
Release candidate complete; Telegram live acceptance passed. Feishu/Lark prompt direct-use, card-schema live acceptance, CardKit card update, and real approval Allow-once/Decline/Abort/Allow-session matrix passed; a 2026-05-05 Feishu Web regression also returned an exact Codex reply after stale-thread recovery. DingTalk Stream live acceptance passed, Card.Instance.Write is open, redacted OpenAPI card send/update now passes with a contact-discovered enterprise userid and the published-template parameter shape, installed DingTalk readiness is green, real DingTalk desktop inbound passes prompt/reply plus /status, and the explicit live CardKit callback probe now passes after one real desktop approval click. DingTalk callback acceptance remains fail-closed through callback-token/messageRef validation; DingTalk text output is append-style for text refs by explicit lifecycle contract, with daemon progress edits suppressed for append-only refs.
Telegram/Lark outbound file/image attachment support is implemented and live-smoked for harmless file sends. Telegram/Lark inbound upload support is implemented locally: images become Codex `localImage` input, generic files become explicit local-path prompt context.
Daemon-side delivery of completed `imageGeneration.savedPath` artifacts is implemented locally; the adapter-level live file APIs it uses are now proven for Telegram and Feishu/Lark.
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
| Lark approval allow once | real write command requiring approval from Feishu Web, tap `Allow once` | pass | Feishu Web click reached launchd daemon; callback token `allow_once=used`, sibling tokens revoked, target `/tmp` file created, and Codex returned `Ran ...` |
| Lark approval decline | real write command requiring approval from Feishu Web, tap `Decline` | pass | target file remained absent; callback token `decline=used`, sibling tokens revoked; terminal card rendered `Decision recorded: decline` with `Status: resolved` |
| Lark approval abort | real write command requiring approval from Feishu Web, tap `Abort` | pass | target file remained absent; callback token `abort=used`, sibling tokens revoked; Codex turn returned interrupted/declined output and pending approvals returned to zero |
| Lark approval allow session | exact same shell command sent twice, first tap `Allow session` | pass | first command wrote 13 bytes; second identical prompt ran without a new Lark callback token and the file grew to 26 bytes; `approval-2 allow_session=used`, siblings revoked |
| Lark terminal approval card visual refresh | resolved approval card should remove buttons / show resolved status | pass | After launchd reinstall, Feishu Web approval resolved via CardKit; reload preserved `Status: resolved` and zero visible `Allow once` buttons |
| Telegram/Lark inbound image/file upload | platform file resources materialize locally, then route to Codex turn input | local pass | Telegram `photo` / `document` and Feishu/Lark `image` / `file` unit coverage proves adapter download + daemon routing; images map to Codex `localImage`, generic files map to local-path text context |
| Common Codex-native IM control commands | `/model`, `/compact`, `/usage`, `/diagnostics`, `/tools`, `/skills`, `/plugins`, `/apps`, `/mcp` through daemon common command routing | local pass | Runtime wrappers keep App Server method literals centralized in `CodexRuntime`; daemon output is redacted and shared by Telegram/Lark/DingTalk adapters through the common control plane |
| DingTalk fake | `pnpm smoke:dingtalk-fake` | pass | covered by `pnpm release:check`, exit 0 |
| DingTalk live dry-run | `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 ... pnpm smoke:dingtalk-live` | pass | `ready_dry_run`, redacted |
| DingTalk live Stream | `DINGTALK_LIVE=1 ... pnpm smoke:dingtalk-live` | pass | bounded Stream connection completed against test app |
| DingTalk production card client | `createDingTalkOpenApiCardClient` token + `createAndDeliver` + `updateCard` tests | pass | production `daemon run` now injects a real OpenAPI card client when `card_template_id` is configured, deriving robot code from AppKey/client id unless `robot_code` overrides it; create/deliver includes DingTalk `userIdType=1` and top-level IM_ROBOT `userId`; HTTP/code/success=false/deliverResults failures all fail closed with redacted diagnostics |
| DingTalk live card OpenAPI gate | `DINGTALK_LIVE=1 DINGTALK_LIVE_CARD=1 DINGTALK_LIVE_DISCOVER_USER=1 ... pnpm smoke:dingtalk-live` | pass | `Card.Instance.Write` is open; contact-discovered enterprise `userid` plus an OpenAPI-usable card template produced redacted `card_updated` with message id presence only; re-run on 2026-05-05 after published-template parameter alignment remained green |
| DingTalk installed readiness | `pnpm dingtalk:readiness` + launchd restart | pass | installed config now has DingTalk enabled with present client id, Keychain secret, card template id, and global/project allowlist entries; readiness output explicitly marks approval callback round-trip as info-only / not checked; latest daemon bundle restarted under launchd with `pendingApprovals=0` and redaction scan passed |
| DingTalk real inbound prompt/status | real DingTalk desktop prompt and `/status` through installed launchd daemon | pass | desktop prompt returned exactly `DINGTALK-FRESH-1557`; `/status` returned `target: dingtalk chat`, `binding: bound`, `project: codex-im`, and `pending approvals: 0`; DingTalk text-output refs are append-only by lifecycle contract, so daemon suppresses progress edits and sends a terminal reply instead of CardKit text edit |
| DingTalk approval card delivery | real write prompt renders card and binds callback tokens | pass | real write prompt rendered the published-template approval card and SQLite bound callback tokens to the DingTalk card `messageRef`; direct callback acceptance is covered by the live callback probe below |
| DingTalk live callback probe | `DINGTALK_LIVE=1 DINGTALK_LIVE_CARD=1 DINGTALK_LIVE_CARD_CALLBACK=1 ... pnpm smoke:dingtalk-live` | pass | 2026-05-06 real DingTalk Desktop click produced `card_callback_seen` with redacted `messageId=present`, `targetSource=env`, `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`, `callbackMessageRef=present`, `callbackAction=present`, `callbackRaw=present`, and no secret bytes |
| DingTalk failed send/bind token cleanup | restart daemon after issued-only callback token residue | pass | startup now revokes both `issued` and `bound` callback tokens before adapter input; this covers the invalid local `callback_route_key` experiment that left unbound issued tokens after no card delivery |
| DingTalk real callback click | real user/client approval-card click reaches adapter callback flow | pass | adapter accepts `cardPrivateData.params.token = v1:<opaque>` plus the official public-template `cardPrivateData.params.action = accept/reject`; real private callbacks with `spaceType=IM` map target/messageRef through the sender `userId`; daemon lookup stays scoped by token or `messageRef + action` |
| bridge install preflight | `pnpm bridge:build && pnpm bridge:install -- --home <temp>` | pass | app daemon, wrapper, migrations, and native runtime deps installed; daemon preflight `ok` |
| launchd dry-run | `pnpm launchd:install --dry-run && ~/.codex-im-bridge/bin/load-and-run.sh --dry-run` | pass | covered by `pnpm release:check`, exit 0 |
| Keychain | `security find-generic-password -s codex-im-bridge -a "$USER"` | pass | presence verified; token bytes never printed |
| launchd live start | `pnpm bridge:build && pnpm bridge:install && launchctl kickstart -k ... && pnpm launchd:status` | pass | installed daemon starts under user LaunchAgent with redacted secret presence and `pendingApprovals=0` |
| Redaction | installed bridge plist/app/config/log scan for token-shaped output | pass | `BRIDGE_HOME=$HOME ... node scripts/bridge-redaction-scan.mjs` returned `redaction scan ok`; launchd plist lint also passed |

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
- 2026-05-04: DingTalk OpenAPI card client was aligned with DingTalk's advanced
  interactive-card request shape by including `userIdType=1`, while preserving
  `supportForward=false` for approval cards. OpenAPI error handling now reports
  redacted DingTalk `code` fields for non-2xx responses, which turns
  template-lifecycle failures into actionable `param.templateNotExist` /
  `param.empty` evidence without logging client id, secret, token, template id,
  target id, or callback payloads. Targeted tests passed: `pnpm vitest run
  --config vitest.config.ts --project unit packages/im-dingtalk/test` (12 files,
  109 passing), plus `pnpm lint`.
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
- 2026-05-04: `DINGTALK_LIVE=1 pnpm smoke:dingtalk-live` re-ran with live page
  credentials held only in process environment. Stream connected successfully
  for a bounded 5 seconds, reported `robotEvents=0`, `cardEvents=0`, and printed
  only redacted presence/status fields.
- 2026-05-04: Redacted DingTalk live card probes reached OpenAPI with
  `Card.Instance.Write` open, app auth present, and target/template presence.
  The org card-builder saved template id failed with `param.templateNotExist`,
  the personal `.schema` template failed with `param.empty`, and an official
  preset `.schema` id failed with `param.templateNotExist`. Browser-side card
  platform checks showed the personal templates remain `new` / unpublished and
  lack `templateSchema`; attempted `personalTemplate/build/publish` and
  `commTemplate/build/prePublish/publish` calls returned platform-side invalid
  parameter / scene-config errors. This keeps DingTalk direct-use blocked on a
  published OpenAPI-deliverable app template plus a usable DingTalk
  client/session for one real inbound robot message.
- 2026-05-04: DingTalk IM_ROBOT card delivery was tightened again to include
  top-level `userId` derived from the same private-target staff id used in
  `dtv1.card//IM_ROBOT.<id>`, while keeping group delivery unchanged. Targeted
  package coverage now asserts the emitted OpenAPI body has `userIdType=1`,
  `userId`, and the matching IM_ROBOT open space without exposing real ids.
  A redacted personal-template live probe still failed with `param.empty`, so
  the remaining blocker is still template/target lifecycle rather than local
  request-body omission.
- 2026-05-04: DingTalk card delivery false positives were closed. The OpenAPI
  client no longer treats HTTP 200 as enough: `success=false` and failed
  `deliverResults[]` entries now throw sanitized errors, so the live card smoke
  cannot pass unless DingTalk actually accepts and delivers the card instance.
- 2026-05-04: DingTalk app-bound template probing advanced. The card platform
  accepted creation of an app-bound template for the test robot app, proving
  the app can be targeted by card-template management. The same platform still
  rejected the follow-up content save / build path with redacted platform
  validation errors, and the created template stayed `new` with no
  `templateSchema`. A redacted OpenAPI probe with the robot page's template
  field still returned `param.templateNotExist`. DingTalk therefore remains
  unaligned with Telegram/Feishu until one app-bound template reaches published
  OpenAPI-deliverable state.
- 2026-05-04: DingTalk card OpenAPI smoke advanced from blocked to green by
  discovering a real enterprise `userid` through DingTalk contact APIs without
  printing it. The public OpenAPI-usable card template probe then completed
  `createAndDeliver` plus `updateCard` and printed redacted `card_updated`
  evidence with `targetSource=discovered`. This validates app auth,
  `Card.Instance.Write`, target semantics, create/update API shape, and
  fail-closed `deliverResults[]` handling. It does not yet prove installed
  direct-use inbound routing or real card callback clicks.
- 2026-05-04: Installed DingTalk readiness turned green. The local installed
  config now has DingTalk enabled with present client id, Keychain-backed secret,
  card template id, and DingTalk entries in both global and project allowlists.
  The latest bridge bundle was rebuilt, installed, and restarted through
  launchd; `pnpm launchd:status` reported the new daemon pid with
  `pendingApprovals=0`, and installed bridge redaction scan passed.
- 2026-05-04: Installed bridge redaction scan passed against the current local
  app bundle, wrapper, config, launchd plist rendering, and daemon logs.
  `pnpm launchd:status` also remained green with `pendingApprovals=0`.
- 2026-05-05: Feishu Web regression sent a real prompt through the installed
  launchd daemon. The first prompt exposed an old missing Codex thread and the
  daemon rebound a fresh thread; the next visible Feishu Web reply returned
  exactly `FEISHU-CODEX-REGRESSION-1207`.
- 2026-05-05: DingTalk OpenAPI card send/update re-ran with live credentials
  kept in local process environment, contact-discovered target, and the
  configured published template. Output was redacted and returned
  `card_updated`. `pnpm smoke:dingtalk-fake` passed immediately afterward.
- 2026-05-05: DingTalk desktop direct-use inbound passed through the installed
  launchd daemon. A real DingTalk prompt returned exactly
  `DINGTALK-FRESH-1557`, and a real `/status` command returned the expected
  bound `codex-im` state with `pending approvals: 0`. A real write-command
  prompt rendered the published-template approval card and bound four callback
  tokens to its DingTalk card `messageRef`. Synthetic macOS/Computer Use clicks
  on the visible `同意` button did not emit a Stream card callback; the adapter
  now accepts the official public-template callback shape where
  `cardPrivateData.params.action` carries `accept` / `reject`, and daemon lookup
  for that fallback is scoped by `messageRef + action`. The remaining DingTalk
  gap is a real user/client CardKit click, not Stream/OpenAPI/template/readiness
  or inbound-routing readiness.
- 2026-05-05: A follow-up real DingTalk write prompt again rendered the
  approval card and bound callback tokens; synthetic macOS/Computer Use clicks
  still did not emit a Stream callback. A temporary local
  `callback_route_key = "codex_im"` experiment was rolled back because the
  current DingTalk app did not deliver a new card and left `issued` / unbound
  callback tokens. The daemon now revokes both `issued` and `bound` callback
  tokens on startup before adapter input. Targeted callback-token and daemon
  tests passed, followed by `pnpm test`, `pnpm lint`, `pnpm protocol:check`,
  and sequential `pnpm typecheck`. The patched bundle was rebuilt/installed and
  launchd pid `21702` revoked the live issued/unbound DingTalk residue on
  startup.
- 2026-05-05: DingTalk callback evidence was converted into an explicit live
  gate. `DINGTALK_LIVE_CARD_CALLBACK=1` sends a real card, keeps Stream
  connected, and only passes after a card callback event arrives; the first
  redacted run sent the card but timed out with `cardEvents=0` after synthetic
  desktop click attempts. GPT Pro review and DingTalk's public Stream callback
  docs both point to the remaining blocker being callback-capable template /
  real-client click evidence, not ApprovalBroker, SecurityPolicy, callback-token
  storage, or messageRef validation. The adapter now also accepts exact
  `cardPrivateData.params.token = "v1:<opaque>"` callbacks and rejects token
  callbacks that carry companion approval/action metadata.
- 2026-05-05: DingTalk text terminal output was fixed after live daemon audit
  showed `param.cardNotExist` for CardKit `editText` against text replies.
  `sendText` now returns explicit `dingtalk-text:*` refs, and `editText` for
  those refs appends via the DingTalk session reply path while approval-card
  `updateCard` remains on CardKit. This is append semantics rather than true
  in-place editing, so long DingTalk streaming turns may produce multiple chat
  messages. Targeted DingTalk/daemon tests and `pnpm typecheck` passed; the
  rebuilt bridge bundle is installed under launchd pid `44722`.
- 2026-05-05 21:00 SGT heartbeat: `git status --short --branch` was clean at
  `4432414` and synced to `origin/codex/live-im-acceptance`. `pnpm
  launchd:status` reported launchd pid `44722`, started at
  `2026-05-05T11:59:46.040Z`, with `pendingApprovals=0`; `pnpm
  dingtalk:readiness` remained `ready` and still labels the approval callback
  round-trip as info-only. Current-pid daemon stdout only showed redacted
  secret resolution, DingTalk Stream `connect success`, and daemon startup;
  stderr only showed Node/SDK deprecation warnings. SQLite recorded zero
  callback audit rows after the current pid startup, and the latest DingTalk
  callback tokens were expired or previously revoked, not `used`. DingTalk
  Desktop could start a process but exposed zero windows, the screen was empty,
  DingTalk Web was still on the maintenance page, and the card editor tab was
  not a chat client; no real client click path was available, so JAC-225
  remains open.
- 2026-05-06 14:15 SGT heartbeat: `git status --short --branch` remained clean
  and synced at `49a63f5`. `pnpm launchd:status` still reported launchd pid
  `44722`, started at `2026-05-05T11:59:46.040Z`, with `pendingApprovals=0`;
  `pnpm dingtalk:readiness` remained `ready` and still labels the approval
  callback round-trip as info-only. Current-pid daemon stdout still had no
  entries beyond redacted secret resolution, DingTalk Stream `connect success`,
  and daemon startup; stderr still had only Node/SDK deprecation warnings.
  SQLite recorded zero callback audit rows after the current pid startup, and
  the latest DingTalk callback tokens remained expired or revoked, not `used`.
  GUI inspection showed DingTalk Desktop running with zero windows; Chrome still
  only exposed the DingTalk card editor and DingTalk Web maintenance page. No
  real client click path was available, so JAC-225 remains open.
- 2026-05-06 19:05 SGT callback follow-up: launchd had restarted after a real
  DingTalk SDK ping crash from `WebSocket.ping()` while the socket was still
  `CONNECTING`. The production daemon now passes `keepAlive: false` to the
  DingTalk Stream client, matching the already-green live-smoke path and
  avoiding that SDK ping timer. Targeted validation passed:
  `pnpm exec vitest run packages/cli/test/daemon-run.test.ts
  packages/im-dingtalk/test/contract.test.ts
  packages/im-dingtalk/test/reconnect.test.ts --config vitest.config.ts
  --project unit --project contract`, `pnpm --filter @codex-im/cli typecheck`,
  `pnpm --filter @codex-im/im-dingtalk typecheck`, `pnpm bridge:build`,
  `pnpm bridge:install`, `launchctl kickstart -k gui/501/io.codex-im-bridge`,
  `pnpm launchd:status`, and `pnpm dingtalk:readiness`. The installed daemon is
  running under pid `34173`, with no new ping crash after restart. A fresh
  explicit `DINGTALK_LIVE_CARD_CALLBACK=1` probe sent a real card and DingTalk
  Desktop showed a new `codex` card-list item, but the conversation remained in
  a loading state and the probe still ended with redacted `messageId=present`,
  `targetSource=env`, and `cardEvents=0`. SQLite callback-token counts were
  unchanged after the attempted click path (`used` did not increase), so the
  remaining blocker is still a real DingTalk client path that opens the card and
  emits `/v1.0/card/instances/callback`; do not mark DingTalk callback green.
- 2026-05-06 21:50 SGT callback acceptance: DingTalk real CardKit callback
  acceptance passed after comparing the local callback parser with
  DingTalk/OpenClaw callback behavior. The first rerun used a stale configured
  target and timed out without a visible new card; the passing rerun used the
  current DingTalk `thread_bindings` target, delivered a fresh card in DingTalk
  Desktop, and a real `同意` click produced redacted `card_callback_seen`
  evidence: `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`,
  `callbackMessageRef=present`, and `callbackAction=present`. The observed raw
  shape had `content.cardPrivateData.params.action` plus private
  `spaceType=IM` / `userId` target fields; no tokens, secrets, user ids, chat
  ids, or message ids were recorded. Launchd was restored afterward and
  `pnpm dingtalk:readiness` remained ready.
- 2026-05-06 22:25 SGT message lifecycle contract: JAC-238 made `MessageRef`
  lifecycle metadata explicit across fake, Telegram, Lark, and DingTalk
  adapters. DingTalk bot-owned text refs are append-only, while Telegram/Lark
  text refs and approval-card refs remain edit-capable. Daemon now suppresses
  progress edits for append-only refs and sends one terminal reply for short
  output; `pnpm im:doctor` reports the DingTalk text/card edit split as
  informational instead of an unresolved warning. Full gates passed, then
  `pnpm bridge:build`, `pnpm bridge:install`, and launchd kickstart installed
  the rebuilt daemon under launchd pid `15268` with `pendingApprovals=0`.
- 2026-05-07 SGT outbound attachment loop: Telegram and Feishu/Lark
  adapter-level file/image send support landed locally. Telegram routes common
  image MIME payloads to `sendPhoto` and generic artifacts to `sendDocument`;
  Feishu/Lark uploads message images/files via SDK resource APIs and then sends
  `image` / `file` messages. Full gates passed; the rebuilt bridge was
  installed and kickstarted under launchd pid `80748` with
  `pendingApprovals=0`. DingTalk remains unsupported for attachments until a
  real delivery path is proven.
- 2026-05-07 SGT daemon artifact loop: Daemon terminal turn output now maps
  completed Codex `imageGeneration.savedPath` items to bounded local artifact
  sends through adapter `sendFile` after publishing the terminal text summary.
  Unsupported adapters skip with audit instead of inventing a fallback
  attachment concept.
- 2026-05-07 SGT live attachment gates: Temporarily stopped launchd to avoid
  Telegram polling contention, then ran explicit Telegram and Feishu/Lark file
  gates. Telegram `TELEGRAM_LIVE_FILE=1` sent a harmless
  `codex-im-live-attachment.txt`; Feishu/Lark `LARK_LIVE_FILE=1` returned
  redacted `messageId=present`. Launchd was bootstrapped/kickstarted back to
  pid `94243`, `pendingApprovals=0`, and `pnpm im:doctor` is ready.
- 2026-05-07 SGT Codex-native control loop: The common IM command plane now
  exposes Codex App Server-native surfaces for model listing, thread
  compaction, usage/rate-limit status, diagnostics, tool/MCP capabilities,
  skills, plugins, apps/connectors, and MCP server status. This is implemented
  once in daemon routing and reaches Telegram/Lark/DingTalk uniformly.
  `CodexRuntime` owns the new App Server wrappers so downstream code does not
  scatter ClientRequest method literals. Computer Use dynamic tool calls are
  projected as Codex-native GUI activity in terminal IM summaries. Full local
  gates passed: `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test` (150
  files, 1401 pass, 1 skipped), and `pnpm lint`.
- 2026-05-04: The latest bridge bundle was rebuilt, installed, and restarted
  through `launchctl kickstart -k gui/501/io.codex-im-bridge`. `pnpm
  launchd:status` reported pid `62312`, `pendingApprovals=0`, and the installed
  daemon hash matched `dist/codex-im-daemon.mjs` (`0c3304e77d52`). Installed
  bridge redaction scan passed, and `pnpm release:check -- --skip-full-gates`
  stayed green.
- 2026-05-04: `pnpm dingtalk:readiness` was added as a no-network, no-secret
  local diagnostic for installed DingTalk direct-use readiness. Current local
  output is expected blocked: DingTalk adapter disabled, client id missing, card
  template missing, and no DingTalk entries in global/project allowlists; the
  Keychain secret source is present. Browser-derived AppKey plus Keychain-backed
  secret still passed `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 pnpm
  smoke:dingtalk-live`, and the bounded Stream live smoke connected with
  `robotEvents=0` / `cardEvents=0`.

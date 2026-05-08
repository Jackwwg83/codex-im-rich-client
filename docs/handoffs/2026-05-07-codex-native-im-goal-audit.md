# Codex-Native IM Goal Audit

Generated: 2026-05-08 SGT

This audit checks the active goal:

> Bring the supported IM platforms close to native Codex App usability:
> text, cwd/thread, model, tools, skills, plugins, MCP, usage,
> diagnostics, attachments, approvals, and Computer Use output should align
> across Telegram, Feishu/Lark, DingTalk, and bounded Slack workspace use, with
> Linear and repo handoffs recording real progress.

## 1. Current Repo State

Fresh local evidence:

```text
branch: codex/live-im-acceptance
last committed baseline before this hardening: cf009cb fix(im): close slack exact-output and live readiness
change scope: GPT Pro follow-up hardening patch
launchd: running pid=98631, codexThreads=0, pendingApprovals=0
pnpm im:doctor: ready for Telegram / Lark / DingTalk / Slack
pnpm dingtalk:readiness: ready
targeted RED/GREEN: Slack exact-output suppression; Slack send-card/action-id, message-envelope ack, slash ack, action/client suites; JAC-279 provider tests; inbound attachment cap/permission coverage for Telegram/Lark/DingTalk/Slack plus daemon fail-closed routing
full gates after GPT Pro hardening:
  pnpm typecheck -> green
  pnpm typecheck:tests -> green
  pnpm lint -> green
  pnpm test -> 161 files, 1509 pass, 1 skip
  pnpm protocol:check -> green, 234 schema files canonical
  pnpm release:check -- --skip-full-gates -> green, includes Slack default-skip
  pnpm release:check -> green
installed bridge after closeout:
  pnpm bridge:build -> green
  pnpm bridge:install -> green, preflight ok
  launchctl kickstart -k gui/501/io.codex-im-bridge -> green
  pnpm launchd:status -> green, pid 98631, pendingApprovals=0
  pnpm im:doctor -> ready, Telegram/Lark/DingTalk/Slack ready
  installed bridge redaction scan -> green
```

Fresh gate/blocker checks:

```text
Slack live workspace acceptance
-> local OpenClaw removed; launchd/global package/state absent
-> Slack bot/app tokens present through dedicated Keychain services
-> pnpm im:doctor reports Slack ready
-> /codex status returned immediate ephemeral ack plus daemon status
-> DM prompt/reply reached a real Codex turn
-> outbound text/file live gates passed with redacted evidence
-> real Block Kit Allow once click produced allow_once=used, sibling tokens revoked, active turn cleared, and harmless target file present
-> Slack exact-output regression now suppresses auxiliary Codex status/item sections for explicit Reply exactly / Respond exactly turns

DingTalk outbound file/image gates
-> DINGTALK_LIVE_FILE=1 file gate returned redacted status=file_sent
-> DINGTALK_LIVE_FILE=1 DINGTALK_LIVE_FILE_KIND=image returned redacted status=file_sent
-> launchd remains running with pendingApprovals=0 after installing the proactive bundle

DingTalk inbound user-upload gate
-> DINGTALK_LIVE_INBOUND_ATTACHMENT=1 image gate passed with redacted status=inbound_attachment_received
-> rawStreamEvents=1, rawRobotCallbacks=1, robotEvents=1, attachmentEvents=1
-> attachmentDownloadAttempts=1, attachmentDownloadSuccesses=1, attachmentDownloadFailures=0
-> DINGTALK_LIVE_INBOUND_ATTACHMENT_KIND=file gate passed on 2026-05-08 with the same redacted counters and robot `msgtype=file` / `content.downloadCode` shape
-> launchd restored afterward at pid=91940, pendingApprovals=0; im:doctor ready

pnpm smoke:computer-use-live
-> status=skip, gate=disabled

COMPUTER_USE_LIVE=1 COMPUTER_USE_PROVIDER_VERIFIED=1 \
COMPUTER_USE_LIVE_DRY_RUN=1 \
COMPUTER_USE_LIVE_APP="Google Chrome" \
COMPUTER_USE_LIVE_TASK="summarize the visible local test page" \
pnpm smoke:computer-use-live
-> status=ready_dry_run

COMPUTER_USE_LIVE=1 COMPUTER_USE_PROVIDER_VERIFIED=1 \
COMPUTER_USE_LIVE_PROVIDER=mac-chrome \
COMPUTER_USE_LIVE_APP="Google Chrome" \
COMPUTER_USE_LIVE_TASK="summarize the visible local test page" \
pnpm smoke:computer-use-live
-> status=executed
```

## 2. Prompt-To-Artifact Checklist

| Requirement | Current evidence | Status |
|---|---|---|
| Ordinary IM text enters current Codex thread/turn | Live acceptance status records Telegram real Codex prompt/reply, Feishu/Lark prompt/reply after stale-thread recovery, and DingTalk desktop prompt/reply. Daemon common routing uses `SessionRouter` and `CodexRuntime.turnStart` / `turnSteer`. | Green for enabled platforms |
| Cwd/thread controls: `/cwds`, `/projects`, `/use`, `/threads`, `/switch`, `/new`, `/fork`, `/stop` | Current hardening aligns IM entry with native Codex semantics: `/cwds` lists known local cwd entries, `/projects` is compatibility-only, `/use` and `/new` select known cwd entries by number or alias and reject raw paths, and `/threads` / `/switch` use App Server `thread/list` / `thread/resume` when available so IM can take over existing Codex App or CLI threads. | Green |
| Codex-native controls: `/model`, `/compact`, `/usage`, `/diagnostics`, `/tools`, `/skills`, `/plugins`, `/apps`, `/mcp` | JAC-236 / JAC-264 are complete. `packages/core/src/command-router.ts` lists these commands; `packages/daemon/src/daemon.ts` calls `CodexRuntime` wrappers for model, compaction, usage, capabilities, skills, apps, MCP login, and MCP reload. | Local green, shared across enabled adapters |
| `/mcp login <server>` and `/mcp reload` | `docs/handoffs/direct-use-live-status.md` records JAC-264; runtime wrappers keep method literals centralized. | Local green |
| `/cu status` | JAC-267 complete. IM output reports enabled state, provider readiness, allowed/denied apps, sensitive keywords, and live-smoke gate without desktop action. | Local green |
| Explicit `/cu <task>` | Phase 6 explicit `/cu` prompt wrapper, policy, session registry, audit, dynamic-tool gate, and App Server dynamic-tool registration contract are implemented for Telegram, Feishu/Lark, and DingTalk when a provider is configured. Normal prompts do not create CU sessions. | Safe control path and provider contract green; live desktop execution still tracked by JAC-274 |
| `/approvals` and `/approve <id> <action>` fallback | Direct-use status records approval fallback loop. It uses bound server-side callback token state and `ApprovalBroker.resolve()`; IM text never carries raw callback tokens/message refs. | Local green |
| Streaming text / terminal output | Telegram and Lark edit in place; DingTalk text refs are append-style by explicit lifecycle contract. JAC-238 models edit vs append semantics. | Green, platform-specific lifecycle documented |
| `commandExecution` output | JAC-261/JAC-265 record short output inline and long completed/failed output as redacted `.log` attachments. This refresh also projects `riskLevel` / `risk` when App Server includes it. | Local green |
| `fileChange` / diff output | JAC-261 records redacted `.patch` attachments for file-change diffs through common `sendFile`. | Local green |
| MCP/plugin/skill/tool status output | JAC-263/JAC-269/JAC-271/JAC-272 record low-noise redacted Codex status projection for lifecycle, MCP progress, terminal interaction, guardian/deprecation/hook, and auto-approval-review events. | Local green |
| Approval request cards and callbacks | Telegram and Feishu/Lark live approval matrices passed. DingTalk live CardKit callback probe passed with callback token/messageRef validation fail-closed. Slack live Block Kit `Allow once` click now also passed after unique action ids and message-envelope acking. | Green for enabled platforms plus bounded Slack |
| Outbound images/files/artifacts | Telegram and Feishu/Lark live file gates passed. DingTalk `sendFile` is implemented locally through media upload plus session webhook when a fresh inbound robot message exists, and through proactive robot group/user media delivery when `DINGTALK_TARGET_CHAT_ID` is configured. DingTalk live file and image gates now both return redacted `status=file_sent`. | Telegram/Lark/DingTalk live green |
| Inbound images/files | Telegram Web and Feishu Web inbound image/file live gates pass with local path/filename/size presence only. DingTalk inbound image and generic-file uploads now both pass real live gates: image uses live `content.downloadCode` / `content.pictureDownloadCode`, file uses live `msgtype=file` plus `content.downloadCode` / `content.fileName`, and both download through `/v1.0/robot/messageFiles/download` with redacted `rawStreamEvents=1`, `rawRobotCallbacks=1`, `robotEvents=1`, `attachmentEvents=1`, and local path/filename/size presence only. | Telegram/Lark/DingTalk live green |
| Inbound attachment hardening | GPT Pro follow-up adds a shared daemon-configurable cap (`daemon.max_inbound_attachment_bytes`, default 25 MiB), adapter-level pre/post size checks, `0700` local attachment directories, `0600` local files, and fail-closed oversized-upload response before a Codex turn starts. | Local green |
| Computer Use output/artifacts | Dynamic-tool / Computer Use `inputImage` artifacts are projected through `sendFile`; summaries hide raw tool args. This refresh also projects app, step/action, policy decision, blocked reason, and approval-required state when those summary fields are present. | Output projection local green |
| Real desktop Computer Use execution | JAC-274 implements the daemon-facing contract, and JAC-279 adds a bounded macOS Chrome provider. The non-dry-run smoke now routes local `navigate` + `observe` through `ComputerUseSessionRegistry`, `ComputerUsePolicy`, `ComputerUseToolGate`, and `MacChromeComputerUseProvider` and returns `status=executed`. | Bounded provider smoke green; arbitrary desktop/sensitive actions still out of scope |
| Identity and group safety | JAC-240 and JAC-241 complete. `/whoami` is redacted; access groups and mention-required group policy are implemented. | Local green |
| Slack live workspace acceptance | JAC-248 is now green for the bounded live workspace scope: Socket Mode readiness, `/codex status`, DM prompt/reply, outbound text/file gates, and one real approval click. Slack exact-output regression coverage now prevents auxiliary Codex status/item sections from appearing in explicit `Reply exactly` / `Respond exactly` turns. | Live green |
| Linear progress tracking | JAC-235 is the parent; JAC-236/237/238/239/240/241/263/264/265/266/267/268/269/271/272/273 are Done. JAC-275 tracks the command-risk / Computer Use detail refresh. JAC-277 is green for DingTalk inbound image and generic-file uploads after the 2026-05-08 file gate. JAC-274 remains the Computer Use parent, now split into JAC-278 official provider-contract evidence and JAC-279 local experimental provider POC. JAC-248 is green for bounded Slack live workspace acceptance. | Green tracking, with follow-up tracks explicit |
| Repo handoff tracking | `docs/handoffs/direct-use-live-status.md`, `docs/handoffs/live-im-acceptance-status.md`, and `docs/phase-6/computer-use-capability-evidence.md` record current state and blockers. | Green |

## 3. Future Expansion Tracks

These are outside the active supported-platform completion claim and are not
current launch blockers:

1. **Broader Computer Use provider scope.**
   The IM `/cu` control, output surfaces, daemon-facing App Server
   dynamic-tool contract, and local macOS Chrome provider smoke are green.
   The accepted provider scope is intentionally bounded to local Chrome
   observe/navigate/click/type operations through the existing session, policy,
   audit, allowed-tool, and provider gates. It does not claim arbitrary desktop
   automation, secret entry, external website control, arbitrary website
   operation, or unattended sensitive actions.

2. **Launch UX polish.**
   GPT Pro product/architecture review recommends keeping the launch product
   boundary narrow: Codex remote-control bridge first, platform count and
   platform-specific polish second. The current launch scope is recorded in
   `docs/ops/launch-scope.md`.

## 4. Completion Verdict

The active goal is **complete for the named supported IM platforms except for
the explicitly listed live follow-up tracks**:
Telegram, Feishu/Lark, and DingTalk now align on the requested Codex-native
command/control, approval, outbound attachment, lifecycle/status, artifact, and
Computer Use output model through the shared daemon and adapter contract.
DingTalk outbound file/image live attachment acceptance is green through the
proactive robot media path; DingTalk inbound image live acceptance is green
through the robot file download path. DingTalk inbound generic-file live
acceptance is also green after the 2026-05-08 real Desktop file-upload gate.

This verdict now includes bounded Slack live workspace acceptance and the
Slack exact-output closeout. It does **not** claim arbitrary desktop Computer
Use beyond the bounded local Chrome provider smoke. Future expansion track:

- Broader IM-triggered Computer Use scenarios beyond the bounded local Chrome
  provider smoke, if desired.
- Richer launch UX polish such as `/artifacts`, better `/status`, task
  presets, and per-chat noise level, without expanding platform count.

## 5. Blocker Unblock Packet

This packet is the handoff-safe way to resume the open tracks and reproduce
DingTalk attachment evidence without reconstructing context. Keep all output
redacted: no IM tokens, Keychain values, private IDs, raw callback payloads,
private file URLs, cookies, or desktop screenshots containing secrets should be
copied into docs or Linear.

### JAC-273 - DingTalk live attachment acceptance

Accepted condition:

- `DINGTALK_TARGET_CHAT_ID` is configured to a DingTalk robot group/private
  target usable by the proactive media API.
- Both live gates reach redacted `status=file_sent`: one generic file and one
  image.

Preflight checks:

```bash
pnpm dingtalk:readiness
pnpm launchd:status
osascript -e 'tell application "System Events" to if exists process "DingTalk" then get {frontmost of process "DingTalk", count of windows of process "DingTalk", name of windows of process "DingTalk"} else get "not-running"'
sqlite3 "$HOME/.codex-im-bridge/state.db" "select created_at, action, result from audit_log where action like 'inbound.%' and target_key like 'dingtalk:%' order by created_at desc limit 3;"
```

Live file/image gates:

```bash
DINGTALK_LIVE=1 \
DINGTALK_LIVE_FILE=1 \
DINGTALK_CLIENT_ID="$CLIENT_ID" \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_TARGET_CHAT_ID="$REDACTED_TARGET" \
DINGTALK_LIVE_DURATION_MS=120000 \
pnpm smoke:dingtalk-live

DINGTALK_LIVE=1 \
DINGTALK_LIVE_FILE=1 \
DINGTALK_LIVE_FILE_KIND=image \
DINGTALK_CLIENT_ID="$CLIENT_ID" \
DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET \
DINGTALK_TARGET_CHAT_ID="$REDACTED_TARGET" \
DINGTALK_LIVE_DURATION_MS=120000 \
pnpm smoke:dingtalk-live
```

Acceptance evidence:

- The smoke reached redacted `status=file_sent` for a file and an image on
  2026-05-07 SGT with `targetSource=env` and `messageId=present`.
- No client secret, user id, chat id, message id, session webhook, or
  `downloadCode` is printed.
- `pnpm launchd:status` still reports the daemon running with
  `pendingApprovals=0`.
- JAC-273 can be closed once Linear is updated with the commit SHA and redacted
  command results.

### DingTalk live inbound generic-file upload acceptance - complete 2026-05-08

Accepted condition:

- One real DingTalk robot `file` message reached the Stream client
  while `DINGTALK_LIVE_INBOUND_ATTACHMENT=1` is running.
- The live smoke exits with redacted `status=inbound_attachment_received`,
  `rawRobotCallbacks>=1`, `robotEvents>=1`, `attachmentEvents>=1`,
  `inboundAttachmentLocalPath=present`, and no `downloadCode`, download URL,
  local path, user id, chat id, or token bytes in output.

Current image-path evidence:

```text
DINGTALK_LIVE=1 DINGTALK_LIVE_INBOUND_ATTACHMENT=1 \
DINGTALK_LIVE_INBOUND_ATTACHMENT_KIND=image pnpm smoke:dingtalk-live
-> status=inbound_attachment_received
-> rawStreamEvents=1, rawRobotCallbacks=1, robotEvents=1, attachmentEvents=1
-> attachmentDownloadAttempts=1, attachmentDownloadSuccesses=1,
   attachmentDownloadFailures=0

launchd restored afterward:
pnpm launchd:status -> running pid=91940, pendingApprovals=0
pnpm im:doctor -> ready for Telegram/Lark/DingTalk, Slack disabled
```

Next diagnosis:

- Re-run the explicit inbound gate and send a fresh image/file only after the
  smoke prints `INBOUND_ATTACHMENT_WAITING`.
- DingTalk generic file upload acceptance is complete as of 2026-05-08; keep
  the gate available for regression checks.

### JAC-248 - Slack real workspace acceptance

Acceptance condition now satisfied for bounded live workspace use:

- A test Slack app is installed with Socket Mode, `/codex`, interactivity,
  `message.im`, and `app_mention` enabled.
- Bot and app tokens are present through Keychain or local env, not docs.
- Slack is enabled in `~/.codex-im-bridge/config.toml` with redacted
  allowlisted test user/channel entries.
- Local OpenClaw is absent so it cannot compete for the same Socket Mode app
  token.
- Slack Block Kit buttons use unique `action_id`s and opaque token-only values.
- Normal message/app_mention Socket Mode envelopes are acked to prevent retries.

Secret-presence checks that do not print token bytes:

```bash
security find-generic-password -s codex-im-bridge-slack-bot -a "$USER" >/dev/null
security find-generic-password -s codex-im-bridge-slack-app -a "$USER" >/dev/null
pnpm im:doctor
```

If config or wrapper inputs changed, reinstall the daemon bundle:

```bash
pnpm bridge:build
pnpm bridge:install
launchctl kickstart -k gui/501/io.codex-im-bridge
pnpm launchd:status
```

Live gates:

```bash
SLACK_LIVE=1 SLACK_LIVE_DRY_RUN=1 pnpm smoke:slack-live
SLACK_LIVE=1 pnpm smoke:slack-live
SLACK_LIVE=1 SLACK_LIVE_TEXT=1 SLACK_TARGET_CHANNEL_ID=C_TEST pnpm smoke:slack-live
SLACK_LIVE=1 SLACK_LIVE_FILE=1 SLACK_TARGET_CHANNEL_ID=C_TEST pnpm smoke:slack-live
```

Client acceptance replay checklist:

- DM the bot or mention the app in the allowed test channel.
- Run `/codex status`, `/codex projects`, and `/codex use codex-im`.
- Send one harmless prompt and verify a Codex reply returns in Slack.
- Upload one harmless image/file and verify the daemon materializes it without
  leaking Slack private file URLs or token bytes.
- Trigger one harmless approval card and click it in Slack; latest acceptance
  validated callback token plus `messageRef`, marked `allow_once=used`, revoked
  sibling tokens, cleared active turn, and created the harmless `/tmp` target
  file.

Acceptance evidence:

- Record command names, pass/fail, redacted token presence, message-id
  presence, launchd pid, `pendingApprovals`, JAC-248, and commit SHA.
- Do not record raw workspace IDs, channel IDs, user IDs, timestamps, token
  bytes, or raw Socket Mode payloads.

### JAC-274 / JAC-279 - Real Computer Use provider execution

Accepted condition:

- The provider contract is now implemented through App Server experimental
  `dynamicTools` and `item/tool/call`: initialize with
  `capabilities.experimentalApi`, register `codex_im.computer_use` / `operate`
  on explicit `/cu` new threads when a provider is configured, and pass all
  calls through the `/cu` session, policy, audit, allowed-tool, and provider
  gates.
- The local macOS provider must prove a bounded non-dry-run Chrome smoke. It
  may only target local file/localhost pages and must not use the current Codex
  session's Computer Use MCP tools as a production backend.

Evidence scan:

```bash
rg -n "computer|Computer|dynamicToolCall|item/tool/call|provider|Tool" \
  packages/codex-protocol/src/generated \
  packages/codex-protocol/schema \
  docs/phase-6/computer-use-capability-evidence.md
pnpm smoke:computer-use-live
COMPUTER_USE_LIVE=1 \
COMPUTER_USE_PROVIDER_VERIFIED=1 \
COMPUTER_USE_LIVE_DRY_RUN=1 \
COMPUTER_USE_LIVE_APP="Google Chrome" \
COMPUTER_USE_LIVE_TASK="summarize the visible local test page" \
pnpm smoke:computer-use-live
```

Non-dry-run gate:

```bash
COMPUTER_USE_LIVE=1 \
COMPUTER_USE_PROVIDER_VERIFIED=1 \
COMPUTER_USE_LIVE_PROVIDER=mac-chrome \
COMPUTER_USE_LIVE_APP="Google Chrome" \
COMPUTER_USE_LIVE_TASK="summarize the visible local test page" \
pnpm smoke:computer-use-live
```

Acceptance evidence:

- The non-dry-run gate returns `status=executed` through the reviewed provider
  boundary.
- The IM output shows app, step/status, policy decision, screenshots/artifacts
  where appropriate, and any approval request through the existing card path.
- Normal prompts still do not trigger Computer Use.
- Unknown, denied, stale, or security-uncertain desktop actions fail closed.

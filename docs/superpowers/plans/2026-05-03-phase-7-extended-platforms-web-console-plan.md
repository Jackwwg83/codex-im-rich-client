# Phase 7 Plan - Extended Platforms And Web Console

Status: reviewed v1.1 - Codex closure review `GO_WITH_LOW_NITS`
Generated: 2026-05-03
Base tag: `phase-6-computer-use-complete`
Branch: `codex/phase-7-planning`
Linear parent: JAC-12
Current gate: JAC-164 plan review gate complete; next issue JAC-104

## 1. Mission

Phase 7 turns the first six phases into an extensible product surface without
weakening the native Codex App Server boundary.

The phase has three goals:

1. Produce a capability matrix for native and future channels.
2. Decide whether Satori/Koishi and Vercel Chat SDK can be adapter layers
   without replacing the Codex App Server rich-client core.
3. Design safe lower-capability rendering, local web-console status, explicit
   approval UI boundaries, multi-channel handoff, and team/operator policy.

Phase 7 is not a generic chat-bot rewrite and not a public web service launch.

## 2. Source Of Truth

- Phase 6 live status: `docs/handoffs/phase6-live-status.md`
- Phase 6 -> Phase 7 handoff: `docs/handoffs/2026-05-03-phase6-to-phase7.md`
- Current Phase 7 live status: `docs/handoffs/phase7-live-status.md`
- Adapter design: `06-IM-ADAPTERS.md`
- Security / Computer Use: `07-SECURITY-AND-COMPUTER-USE.md`
- Architecture: `03-ARCHITECTURE.md`
- Data model: `08-DATA-MODEL.md`
- Testing: `11-TESTING-AND-QA.md`
- Ops: `12-OPERATIONS.md`
- Loop runbook: `docs/automation/codex-app-autonomous-loop-runbook.md`
- Linear: JAC-12 parent, JAC-164 plan gate, JAC-102 through JAC-109 current
  execution children.

External references checked during planning:

- Satori introduction: `https://satori.chat/en-US/introduction.html`
- Satori protocol overview: `https://satori.chat/en-US/protocol/`
- Koishi adapter guide: `https://koishi.chat/en-US/guide/adapter/adapter`
- Chat SDK adapters: `https://chat-sdk.dev/docs/adapters`
- Vercel Chat SDK guide: `https://vercel.com/kb/guide/the-complete-guide-to-chat-sdk`

## 3. Hard Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing as product protocol.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public Codex App Server listener.
- No public web-console listener by default.
- No approval bypass or first-actor-wins permission model.
- No raw callback token persistence or display.
- No platform adapter importing broker/runtime/client/storage/daemon/render or
  generated protocol directly; adapters consume `ChannelAdapter` only.
- No real external platform calls in plan/spike tasks.
- No real Computer Use provider work in Phase 7.
- Any unknown, lower-capability, ambiguous, unauthorized, or security-uncertain
  path fails closed or degrades to non-actionable plain text.

## 4. Current External Findings

Satori is a universal chat protocol that aims to bridge multiple chat platforms
and lists official adapters across DingTalk, Discord, Lark, Matrix, QQ,
Telegram, WeCom, WhatsApp, Zulip, and others. Its protocol uses HTTP APIs for
sending/invoking functionality and WebSocket or WebHook event services for
receiving events. Satori also documents that many protocol fields are optional,
which makes it a compatibility layer candidate, not a high-fidelity native
adapter replacement.

Koishi's adapter guide highlights one-to-one vs reusable adapter instances,
multiple transport modes, and dynamic bot creation. It warns that unlimited bot
connections can be abused unless the service runs in a trusted network or adds
authentication. That maps directly to the project's no-public-listener redline.

Chat SDK provides platform-specific adapters for Slack, Teams, Google Chat,
Discord, Telegram, GitHub, Linear, WhatsApp, and related surfaces. Its adapter
docs show feature variation across cards, buttons, threads, streaming,
ephemeral messages, and file uploads. The SDK guide frames Chat SDK as a
unified bot layer with its own `Chat`, adapter, and state concepts. Therefore it
may be useful as an outer adapter layer, but cannot become the Codex core.

## 5. Phase 7 Decisions

### D1 - Capability Matrix First

Before writing fallback renderer or adapter code, Phase 7 must define the
capability vocabulary across existing native adapters and future adapter
families.

The matrix must include at least:

- message receive
- reply/send/edit
- card/rich content
- buttons/callbacks
- thread/topic identity
- messageRef availability
- streaming strategy
- file upload/download
- ephemeral/private response
- live/network requirement
- secret/config surface
- approval safety degradation
- Computer Use support level

### D2 - Satori/Koishi Is A Compatibility Layer

Satori/Koishi may be explored as `im-satori` or an adapter bridge only after a
feasibility spike proves target/message/messageRef/action mapping can remain
inside `ChannelAdapter`.

It must not replace Telegram/Lark/DingTalk native adapters, broker policy, or
runtime semantics.

### D3 - Chat SDK Is Adapter-Layer Only

Vercel Chat SDK may be explored for Slack/Discord/Teams/Google Chat/GitHub/
Linear/WhatsApp-style surfaces only as a channel adapter bridge. Its `Chat`
state/thread model must not become Codex thread/turn state.

### D4 - Fallback Renderer Must Be Non-Actionable By Default

For channels without safe buttons/callbacks, approval fallback must render
context and operator instructions, but it must not expose raw approval ids,
callback tokens, or resolve decisions without a reviewed secure command path.

### D5 - Web Console Starts Local Read-Only

Any web console work starts as loopback-only read-only status. Approval UI,
mutation, public access, remote access, auth, and live deployment require
separate review tasks.

### D6 - Multi-Channel Handoff Is Policy-Bound

A session may move across channels only through an explicit policy-bound target
transition. No first-actor-wins, no implicit same-user merge by display name, and
no approval permission inheritance without policy proof.

### D7 - Team/Operator Model Precedes Shared Approval UI

Before a web approval UI or multi-user channel bridge can resolve approvals, the
team/operator permission model must define at least viewer, operator, admin, and
auditor roles and their access to projects, targets, approvals, and audit logs.
Therefore JAC-109 must complete before JAC-107 or JAC-108 can implement any
resolution or target-transition behavior.

## 6. Task Plan

### T0 - JAC-164 Plan Review Gate

- Create this plan and Phase 7 live status.
- Run Codex outside-voice review.
- Patch P0/P1 findings before implementation.
- Record the post-fix review result before starting the first child issue.

Exit:

- Plan review returns GO/GO_WITH_LOW_NITS, or P0/P1 findings are closed and the
  closure review/result is recorded in `docs/phase-7/`.

### T1 - JAC-104 Capability Matrix

- Create `docs/phase-7/capability-matrix.md`.
- Fill rows for Telegram, Lark, DingTalk, Satori/Koishi, Chat SDK family, and
  local web console.
- Mark unsupported/unknown cells explicitly; no runtime changes.
- Include a `Phase 7 verdict` column with exactly one of `implementable`,
  `spike-only`, `docs-only`, or `blocked`.

First review target:

- Matrix identifies which Phase 7 children are safe to implement and which must
  remain spikes.

### T2 - JAC-102 Satori/Koishi Feasibility Spike

- Create `docs/phase-7/satori-koishi-feasibility.md`.
- Decide whether an `im-satori` adapter can preserve target/messageRef/action
  and callback semantics.
- Record required auth/topology if Koishi server-satori or Satori WebSocket is
  used.
- Use docs, static analysis, and mocked fixtures only.

Forbidden:

- No production adapter package.
- No live Koishi/Satori server.
- No public listener.
- No credential or environment auto-detection.
- No adapter, WebSocket, HTTP client, bot, or network listener instantiation.

### T3 - JAC-103 Chat SDK Feasibility Spike

- Create `docs/phase-7/chat-sdk-feasibility.md`.
- Decide if Chat SDK can sit outside `ChannelAdapter` without becoming Codex
  core.
- Map feature gaps for Slack/Discord/Teams/Google Chat/GitHub/Linear/WhatsApp.
- Use docs, static analysis, and mocked fixtures only.

Forbidden:

- No production Chat SDK adapter package.
- No webhook endpoint.
- No generic chat state substitution.
- No credential or environment auto-detection.
- No Chat SDK adapter, webhook handler, bot, or network listener instantiation.

### T4 - JAC-105 Fallback Renderer

- Implement or document a lower-capability rendering path only after T1-T3
  define the matrix.
- If implementation proceeds, start with tests in render/channel-core surfaces.

First failing test:

- A no-button/no-card channel receives a safe non-actionable approval fallback
  without raw callback tokens, raw approval ids, actionable `/approve <id>` style
  commands, or raw method literals.

### T5 - JAC-106 Web Console Read-Only Status

- Plan or implement loopback-only read-only status after D5 is confirmed.
- No approval resolution UI in this task.

First failing test if implemented:

- Read-only status output excludes secrets and has no mutation controls.
- Default bind is loopback-only and the implementation rejects `0.0.0.0`, `::`,
  LAN, or other public listener defaults unless a later operator-gated plan
  explicitly approves it.

### T6 - JAC-109 Team/Operator Model

- Define roles and policy checks for viewer/operator/admin/auditor.
- Scope access to projects, targets, approvals, Computer Use status, and audit.
- This must land before JAC-107 or JAC-108 implements approval resolution or
  target transition.

First failing test:

- Unauthorized operator cannot view or resolve a restricted approval/task.

### T7 - JAC-107 Web Console Approval UI

- Requires T5 and T6.
- Any approval resolution must route through existing broker/daemon policy and
  messageRef/target validation. No direct storage mutation.

First failing test if implemented:

- Approval UI decision cannot resolve without policy-bound actor/target proof
  from the completed team/operator model.

### T8 - JAC-108 Multi-Channel Session Handoff

- Define and implement explicit policy-bound target transition only after the
  team/operator model is complete.

First failing test:

- Handoff between two targets fails unless a configured policy permits it.

### T9 - Phase 7 Review / Handoff / Tag

- Run final outside-voice review.
- Update README, TODOS, live status, and Phase 7 -> next handoff.
- Bump root version to `0.1.0-phase7` at tag gate only.
- Tag `phase-7-extended-platforms-web-console-complete` only if review and gates
  are green.

## 7. Gate Plan

Per executable issue:

- targeted test first when code changes
- `pnpm typecheck`
- `pnpm typecheck:tests`
- `pnpm test`
- `pnpm lint`
- `pnpm protocol:check` at completion

Docs-only spikes must run at least:

- `pnpm lint`
- `git diff --check`

Phase close must run:

- `pnpm typecheck`
- `pnpm typecheck:tests`
- `pnpm test`
- `pnpm lint`
- `pnpm protocol:check`
- relevant default-skip smoke harnesses

## 8. Review Questions For JAC-164

1. Should Phase 7 remain primarily a planning/spike phase, or may fallback
   renderer and local read-only web status ship in this phase?
2. Is Satori/Koishi safe as a compatibility layer under the current adapter
   boundary?
3. Is Chat SDK safe as an adapter-layer bridge without threatening the Codex
   core?
4. What is the minimum safe web-console boundary: docs only, loopback read-only,
   or authenticated local status?
5. Should team/operator policy land before fallback renderer, before web
   console, or only before approval UI?

## 9. Phase Exit Criteria

- Capability matrix exists and is reviewed.
- Satori/Koishi and Chat SDK recommendations are recorded.
- Any implemented fallback/web/handoff/operator surfaces have targeted tests and
  preserve approval/security redlines.
- No public listener or live external platform action is introduced by default.
- Final review returns GO or P0/P1 findings are closed.

# Phase 5 Live Status

> Single source of truth for Phase 5 while DingTalk adapter work is active.
> **Last updated:** 2026-05-02 - JAC-88 fake DingTalk smoke green.

---

## 1. Current phase / task

- **Phase:** Phase 5 - DingTalk adapter.
- **Plan:** `docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`.
- **Parent Linear issue:** JAC-10 - Phase 5 backlog / DingTalk adapter.
- **Current Linear issue:** JAC-88 - fake DingTalk smoke.
- **Branch:** `codex/phase-5-dingtalk`.
- **Base:** `phase-4-lark-adapter-complete` (`7281e28`).
- **Version:** `0.1.0-phase4`; do not bump until Phase 5 tag gate.
- **Next exact action:** update Linear for JAC-88, then start JAC-89
  env-gated live DingTalk smoke harness.

## 2. Current decision state

- DingTalk default transport is Stream mode, not public webhook.
- Default package target is `dingtalk-stream@^2.1.5` stable.
- Use `@alicloud/dingtalk` only behind an injectable card/OpenAPI client if
  required for card create/deliver/update.
- Advanced card callbacks must use Stream callback delivery when the selected
  card API path supports `callbackType: "STREAM"`.
- Card callback `messageRef` availability is review-sensitive and must be
  pinned by sanitized fixtures before any `InboundAction` emission or broker
  resolution path.
- Live DingTalk smoke is `OPERATOR_GATE + env-gated`; default runs skip without
  network and the unattended loop must not set `DINGTALK_LIVE=1` itself.
- `@codex-im/im-dingtalk` uses `dingtalk-stream@^2.1.5` through an injected
  `DingTalkStreamClientLike` wrapper; tests pin callback registration before
  inbound resume and no public listener/webhook surface.
- Robot message receive now normalizes sanitized private/group Stream fixtures
  into `InboundMessage`, emits only after lifecycle unpauses inbound, preserves
  sanitized debug raw fields, and pins idempotency as `robot:<msgId>` while
  retaining Stream `headers.messageId` for diagnostics.
- Card send/update uses an injected `DingTalkCardClientLike`, renders only
  opaque `v1:` `wirePayload` values into DingTalk actions, sets
  `callbackType: "STREAM"`, and surfaces send/update/edit failures without
  optimistic `MessageRef` success.
- Callback codec/parser accepts only exact `v1:[A-Z2-7]{16}` strings, rejects
  raw approval/action/tuple/object shapes, redacts invalid/valid values for
  future logs, and intentionally does not emit `InboundAction` before JAC-84
  proves original-card `messageRef`.
- Card action mapping now emits `InboundAction` only after Stream card callback
  `outTrackId`, `spaceId`, single `actionId`, exact `v1:` payload, and operator
  `userId` are all present and unambiguous. Missing/unsafe fields fail closed.
- Adapter fake round-trip now covers card send, validated callback action,
  card update, and `answerAction` through injected fake clients; ack payloads do
  not include raw callback tokens.
- Stream reconnect now uses lifecycle generation guards so stale callback
  registrations after stop/start cannot duplicate message/action emissions.
  Duplicate Stream deliveries carry stable robot/card idempotency keys.
- Adapter contract coverage now pins the `ChannelAdapter` public surface, fake
  message/card/action/ack round-trip, unsupported attachment fail-closed path,
  no public listener/logging sink, fixture secret-key guard, and DingTalk raw
  wire details confined to `@codex-im/im-dingtalk`.
- `pnpm smoke:dingtalk-fake` now drives a fake DingTalk Stream robot message
  through daemon prompt routing, then drives stale and successful card callback
  actions through daemon callback-token/messageRef validation and platform ack.
  It uses only fake clients and no network or credentials.
- Current DingTalk capabilities are intentionally conservative:
  `supportsButtons=true`, `canEditMessage=true`, `supportsAttachments=false`,
  `maxCallbackDataBytes=64`.

## 3. Active redlines carried forward

- No public Codex App Server listener.
- No public DingTalk webhook by default.
- No OpenClaw plugin path.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No Computer Use production flow.
- `@codex-im/im-dingtalk` may import `@codex-im/channel-core` only among Codex
  packages.
- DingTalk adapter must never call `ApprovalBroker`, `CodexRuntime`,
  `AppServerClient`, storage, daemon, render, protocol, or generated protocol
  types directly.
- DingTalk callback payload must carry only the Phase 3 opaque `wirePayload`
  (`v1:` + raw token); no raw approval id / actor / target / action tuple.
- DingTalk secrets and token-shaped values must not enter docs, fixtures, logs,
  SQLite, Linear, plist, or commits.
- All malformed/stale/wrong-target/wrong-actor/expired/unauthorized/replayed
  action paths fail closed before `ApprovalBroker.resolve()`.
- Stream ack means platform receipt only, never approval acceptance.

## 4. Review status

| Review | Status |
|---|---|
| Phase 5 plan v1 Codex review | APPROVE_WITH_CHANGES: 1 P1 + 3 P2; fixes absorbed in plan/live-status/target verification |
| Phase 5 plan v1.1 Codex re-review | GO; no remaining findings; JAC-79 may start |
| Phase 5 implementation review | pending after fake smoke |
| Phase 5 tag-gate review | pending |

## 5. Linear execution queue

| Issue | Scope | Status / gate |
|---|---|---|
| JAC-78 | T0 plan review gate | done |
| JAC-79 | T1 im-dingtalk skeleton + boundary tests | done |
| JAC-80 | T2 Stream lifecycle fake test | done |
| JAC-81 | T3 message receive fixtures | done |
| JAC-82 | T4 card send/update | done |
| JAC-83 | T5 callback codec/parser only; no `InboundAction` before JAC-84 | done |
| JAC-84 | T6 messageRef validation + action emission gate | done |
| JAC-85 | T7 approval round-trip fake test | done |
| JAC-86 | T8 reconnect behavior | done |
| JAC-87 | T9 adapter contract suite | done |
| JAC-88 | T10 fake DingTalk smoke | green; Linear update pending |
| JAC-89 | T11 env-gated live DingTalk smoke | next / OPERATOR_GATE + env-gated |
| JAC-90 | T12 review/handoff/tag | blocked |

## 6. Gate status

Latest JAC-88 verification:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm smoke:dingtalk-fake` | green: 1 file, 1 passing |
| `pnpm test` | green: 124 files, 1182 passing, 1 skipped |
| `pnpm lint` | green: 285 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |

`protocol:check` must run serially because it regenerates protocol files before
diffing.

## 7. Compact / resume

If resuming during Phase 5:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`.
3. Read `docs/phase-5/dingtalk-target-verification.md`.
4. Read `AGENTS.md` and `docs/automation/codex-app-autonomous-loop-runbook.md`.
5. Run `git status --short` and `git log --oneline -8`.
6. Continue from the current Linear issue when the recovered state is clearly
   safe; use GPT Pro/Codex outside-voice for technical ambiguity.

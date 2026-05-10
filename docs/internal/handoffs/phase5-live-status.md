# Phase 5 Live Status

> Single source of truth for Phase 5. This file is now frozen at the Phase 5 tag gate.
> **Last updated:** 2026-05-02 - JAC-90 review/handoff/tag gate complete.
> **Handoff status:** Phase 5 is complete and ready to tag as `phase-5-dingtalk-adapter-complete`. Continue with Phase 6 Computer Use planning.

---

## 1. Current phase / task

- **Phase:** Phase 5 - DingTalk adapter.
- **Plan:** `docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`.
- **Parent Linear issue:** JAC-10 - Phase 5 backlog / DingTalk adapter.
- **Final Linear issue:** JAC-90 - T12 review/handoff/tag.
- **Branch:** `codex/phase-5-dingtalk`.
- **Base:** `phase-4-lark-adapter-complete` (`7281e28`).
- **Version:** `0.1.0-phase5`.
- **Next exact action:** tag Phase 5, mark Linear JAC-90 done, then start Phase 6 Computer Use plan review gate.

## 2. Completed decision state

- DingTalk default transport is Stream mode, not public webhook.
- Default package target is `dingtalk-stream@^2.1.5` stable.
- `@codex-im/im-dingtalk` imports only `@codex-im/channel-core` among Codex packages.
- `createDingTalkStreamClient()` wraps real `dingtalk-stream` `DWClient`.
- Adapter-level Stream callback ack uses `EventAck.SUCCESS` as platform receipt only; it never means approval acceptance.
- Robot message receive normalizes sanitized private/group Stream fixtures into `InboundMessage`.
- Duplicate robot Stream deliveries are acked but emitted once through a bounded adapter-local seen-key set.
- Card send/update uses an injected `DingTalkCardClientLike`, renders only opaque `v1:` `wirePayload` values, sets `callbackType: "STREAM"`, and surfaces send/update/edit failures without optimistic `MessageRef` success.
- Card action mapping emits `InboundAction` only after Stream card callback `outTrackId`, `spaceId`, single `actionId`, exact `v1:` payload, and operator `userId` are all present and unambiguous.
- Duplicate/replayed card callbacks are not adapter-local approval state; daemon callback-token CAS plus messageRef validation remains the security boundary.
- Adapter `raw` fields redact platform ids; real ids flow only through typed routing/security fields (`target`, `messageRef`, `sender`, idempotency key).
- `pnpm smoke:dingtalk-fake` drives a fake DingTalk Stream robot message through daemon prompt routing, then drives stale and successful card callback actions through daemon callback-token/messageRef validation and platform ack.
- `pnpm smoke:dingtalk-live` defaults to a redacted skip, supports `DINGTALK_LIVE_DRY_RUN=1`, and only opens a bounded DingTalk Stream connection when `DINGTALK_LIVE=1` plus client-id and secret-env indirection are explicitly present.
- Current DingTalk capabilities are intentionally conservative: `supportsButtons=true`, `canEditMessage=true`, `supportsAttachments=false`, `maxCallbackDataBytes=64`.

## 3. Active redlines carried forward

- No public Codex App Server listener.
- No public DingTalk webhook by default.
- No OpenClaw plugin path.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No Computer Use production flow before Phase 6 plan approval.
- DingTalk adapter must never call `ApprovalBroker`, `CodexRuntime`, `AppServerClient`, storage, daemon, render, protocol, or generated protocol types directly.
- DingTalk callback payload must carry only the Phase 3 opaque `wirePayload` (`v1:` + raw token); no raw approval id / actor / target / action tuple.
- DingTalk secrets and token-shaped values must not enter docs, fixtures, logs, SQLite, Linear, plist, or commits.
- All malformed/stale/wrong-target/wrong-actor/expired/unauthorized/replayed action paths fail closed before `ApprovalBroker.resolve()`.

## 4. Review status

| Review | Status |
|---|---|
| Phase 5 plan v1 Codex review | APPROVE_WITH_CHANGES: 1 P1 + 3 P2; fixes absorbed in plan/live-status/target verification |
| Phase 5 plan v1.1 Codex re-review | GO; no remaining findings; JAC-79 allowed to start |
| Phase 5 final implementation review | APPROVE_WITH_CHANGES at `9b3f395`; 2 P1 + 2 P2 recorded in `docs/phase-5/impl-final-codex-review.md` |
| Phase 5 final review fixes | `4a308d2` closed real Stream wrapper/ack, duplicate robot suppression, target evidence, and raw redaction blockers |
| Phase 5 final re-review | GO; no P0/P1/P2 findings; report in `docs/phase-5/impl-final-codex-rereview.md` |

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
| JAC-88 | T10 fake DingTalk smoke | done |
| JAC-89 | T11 env-gated live DingTalk smoke | done; not default CI |
| JAC-90 | T12 review/handoff/tag | done after tag-gate commit |

## 6. Gate status

Latest Phase 5 tag-gate verification:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 126 files, 1186 passing, 1 skipped |
| `pnpm lint` | green: 288 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |
| `pnpm smoke:dingtalk-fake` | green: 1 file, 1 passing |
| `pnpm smoke:dingtalk-live` | green default skip: no network without `DINGTALK_LIVE=1` |

`protocol:check` must run serially because it regenerates protocol files before diffing.

## 7. Compact / resume

If resuming after Phase 5:

1. Treat this file as frozen Phase 5 closeout evidence.
2. Read `docs/handoffs/2026-05-02-phase5-to-phase6.md`.
3. Create or read the Phase 6 Computer Use plan once available.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from Phase 6 planning/Linear issue queue; do not reopen Phase 5 unless a regression appears.

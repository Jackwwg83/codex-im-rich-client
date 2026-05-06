# Phase 7 Capability Matrix

Generated: 2026-05-03
Linear issue: JAC-104
Branch: `codex/phase-7-planning`
Plan: `docs/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`

This matrix gates Phase 7 work. It does not change runtime behavior and does
not authorize any live external platform call, credential probing, listener
startup, or adapter instantiation.

## Verdict Vocabulary

| Verdict | Meaning |
|---|---|
| `implementable` | Safe to implement in Phase 7 when the issue scope and tests enforce the listed guardrails. |
| `spike-only` | Only docs, static analysis, type sketches, or mocked fixtures are allowed in Phase 7. No production package or live network. |
| `docs-only` | Record product/architecture decisions, but do not ship runtime behavior in Phase 7. |
| `blocked` | Must not start until the named prerequisite issue/review closes. |

## Current And Candidate Surfaces

| Surface | Message Receive | Reply / Send / Edit | Card / Buttons / Callbacks | Thread / Topic / MessageRef | Streaming Strategy | Files | Ephemeral / Private | Computer Use | Live / Network / Secrets | Approval Safety Degradation | Phase 7 verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Telegram native adapter | Implemented. Normalizes private, group, and forum-topic `message:text` updates into `InboundMessage`. | Implemented `sendCard`, `updateCard`, `editText`, `answerAction`, `sendFile`; image MIME payloads route to `sendPhoto`, generic artifacts to `sendDocument`. | Implemented inline keyboard actions with verbatim `v1:` `wirePayload`; callback codec rejects legacy/raw shapes. | Strong. Uses chat id, optional topic id, Telegram message id, and callback messageRef; daemon validates before `broker.resolve`. | Edit existing message/card, bounded by platform/API behavior. | `supportsAttachments=true` for outbound file/image sends; live file gate still pending. | Private/group available through Telegram target; no adapter-level ephemeral support. | Only through daemon explicit `/cu` flow; adapter cannot trigger Computer Use directly. | Real bot token remains env-gated; no public listener. | Fail closed on malformed/stale callback and missing/deleted callback message; no raw approval id. | `implementable` baseline already shipped; no Phase 7 runtime work unless a later issue explicitly extends capabilities. |
| Lark native adapter | Implemented through long-connection receive fixtures; no default public webhook. | Implemented text/card send, card/status update paths, and outbound `sendFile` via SDK image/file upload plus message send. | Implemented interactive card action transport with opaque `v1:` payload only. | Strong enough for Phase 4: open chat/message ids are mapped into `Target`/`MessageRef`; action transport chosen to preserve target validation. | Card status area full update; no append-style streaming assumption. | `supportsAttachments=true` for outbound file/image sends; live file gate still pending. | Private/group depends on Lark event target; no adapter-level ephemeral guarantee. | Only through daemon explicit `/cu` flow; Lark card may display risk but does not invoke provider. | App secret and verification inputs stay env-indirected; long connection avoids public listener by default. | Reject legacy/raw callback shapes; no raw approval id / actor / target tuple in payload. | `implementable` baseline already shipped; no Phase 7 runtime work unless capability matrix creates a reviewed extension. |
| DingTalk native adapter | Implemented through Stream mode receive and fake smoke. | Implemented text/card send and card update through injected client surfaces. | Implemented Stream card callback mapping with opaque `v1:` payload and platform ack separated from approval decision. | Strong enough for Phase 5: `outTrackId`/messageRef, target, and sender must be present and unambiguous before `InboundAction`. | Full card update every few seconds; no append-style streaming assumption. | `supportsAttachments=false`; no Phase 7 file implementation. | Private/group depends on DingTalk robot context; no adapter-level ephemeral guarantee. | Only through daemon explicit `/cu` flow. | Client id/secret env indirection; Stream connection only in gated smoke/runtime. | Duplicate/replayed callbacks rely on daemon token CAS + messageRef validation; no adapter-local approval state. | `implementable` baseline already shipped; no Phase 7 runtime work unless capability matrix creates a reviewed extension. |
| Satori/Koishi compatibility layer | Candidate. Satori event services can receive via WebSocket/WebHook, but fields are optional and platform coverage varies by Koishi adapter. | Candidate. HTTP API may send messages; edit/reply fidelity is platform dependent. | Candidate. Buttons/callbacks are not uniformly safe across target platforms. | Unknown. `messageRef` and topic/thread mapping must be proven per platform and transport. | Unknown. Must be mapped per platform; no high-fidelity assumption. | Unknown. Varies by platform. | Unknown. Varies by platform. | Not allowed to invoke Computer Use; only daemon may process explicit `/cu` text after normal policy. | Koishi server topology can introduce trusted-network/auth requirements; no live server or credential detection in Phase 7 spike. | Without safe callback + messageRef proof, approvals must render non-actionable text. | `spike-only` for JAC-102. No `im-satori` package until a later reviewed plan approves exact platform/transport constraints. |
| Vercel Chat SDK adapter family | Candidate. Supports multiple platform adapters, but event/thread semantics vary and the SDK has its own bot abstractions. | Candidate. Send/edit/reply support varies by platform adapter. | Candidate. Cards/buttons vary across Slack, Discord, Teams, Google Chat, GitHub, Linear, WhatsApp, and others. | Unknown. Must not substitute SDK conversation state for Codex App Server thread/turn/item state. | Unknown. Some platforms support streaming-like updates, others do not. | Unknown. File upload/download varies by platform. | Unknown. Ephemeral/private response support varies by platform. | Not allowed to invoke Computer Use; only daemon explicit `/cu` path may start CU. | Some adapters/webhooks may auto-detect credentials or require handlers; Phase 7 permits docs/static analysis/mocked fixtures only. | Without callback/messageRef/actor proof, approvals must render non-actionable text. | `spike-only` for JAC-103. Adapter-layer bridge only; never Codex core. |
| Local web console read-only status | Not an IM receive surface. | Read-only status can render daemon/project/session state. | No buttons or approval mutation in JAC-106. | No IM messageRef; status rows may reference stored session/thread ids read-only. | Poll or local refresh only after loopback-only binding is proven. | No upload/download in JAC-106. | Local operator view only; no public access. | May show redacted Computer Use status from existing state; no provider execution. | Must bind loopback only and reject `0.0.0.0`, `::`, LAN, or public listener defaults. | No approval resolution UI; no mutation controls. | `implementable` for JAC-106 after docs-only planning, with loopback/public-bind tests. |
| Local web console approval UI | Not an IM receive surface. | Can be considered only after read-only status and team/operator policy exist. | Approval buttons would be mutation controls and must route through existing broker/daemon policy. | Must prove policy-bound actor/target/messageRef before any `broker.resolve`. | UI status updates only; no direct storage mutation. | No file mutation unless later reviewed. | Requires role-aware local operator model. | Must not bypass `/cu` policy or scoped dynamic tool gate. | Public listener remains forbidden by default. | Must fail closed for unknown/unauthorized/stale/expired/security-uncertain actions. | `blocked` until JAC-109 completes; then JAC-107 may be re-evaluated as `implementable`. |
| Multi-channel session handoff | Cross-channel routing surface, not a platform adapter. | Sends follow-up messages only through existing adapters. | Action continuity must not carry approval permission implicitly. | Requires explicit target transition proof; no display-name merge or first-actor-wins. | Depends on source and destination adapter capabilities. | No file migration unless later reviewed. | Depends on target policy and channel privacy. | Must not move active CU authority across targets without explicit policy. | No new listener or external platform side effect beyond configured adapters. | Handoff must fail unless policy permits the exact transition. | `blocked` until JAC-109 completes; then JAC-108 may be re-evaluated as `implementable`. |

## Phase 7 Child Issue Verdicts

| Issue | Scope | Verdict | Required guardrails before work |
|---|---|---|---|
| JAC-104 | Capability matrix | `implementable` | Docs-only. No runtime changes. This document is the gate output. |
| JAC-102 | Satori/Koishi feasibility | `spike-only` | Docs/static analysis/mocked fixtures only. No live server, credentials, adapter package, network client, webhook, or listener. |
| JAC-103 | Chat SDK feasibility | `spike-only` | Docs/static analysis/mocked fixtures only. No SDK adapter instantiation, credential auto-detection, webhook handler, listener, or generic chat-core substitution. |
| JAC-105 | Fallback renderer | `implementable` | Restriction: only non-actionable approval fallback is implementable. Must not expose raw approval ids, raw callback tokens, actionable text commands, or method literals. Prefer render/channel-core tests first. |
| JAC-106 | Web console read-only status | `implementable` | Restriction: must prove loopback-only default and rejection of public listener defaults. No mutation controls and no secret display. |
| JAC-109 | Team/operator model | `implementable` | Must define viewer/operator/admin/auditor roles and policy checks before shared approval UI or handoff. |
| JAC-107 | Web console approval UI | `blocked` | Requires JAC-109 and JAC-106. Must route through existing broker/daemon policy and messageRef/target validation. |
| JAC-108 | Multi-channel session handoff | `blocked` | Requires JAC-109. Must implement explicit policy-bound target transition; no permission inheritance. |

## Decisions For The Loop

- Continue next with JAC-102, because it is `spike-only` and unblocks the
  candidate adapter branch without runtime risk.
- Do not start JAC-105 until JAC-102 and JAC-103 record whether lower-capability
  platforms need only generic non-actionable fallback or platform-specific docs.
- Do not start JAC-107 or JAC-108 before JAC-109.
- Treat all live platform smokes, public listeners, credential probing, and
  Computer Use provider actions as outside this matrix.

## Sources

- Current adapter interface and capability type:
  `packages/channel-core/src/adapter.ts`, `packages/channel-core/src/types.ts`,
  `packages/channel-core/src/capabilities.ts`.
- Shipped native adapters: `packages/im-telegram/src/capabilities.ts`,
  `packages/im-lark/src/capabilities.ts`,
  `packages/im-dingtalk/src/capabilities.ts`.
- Phase closeout anchors: `docs/handoffs/phase3-live-status.md`,
  `docs/handoffs/phase4-live-status.md`,
  `docs/handoffs/phase5-live-status.md`,
  `docs/handoffs/phase6-live-status.md`.
- External references recorded in the Phase 7 plan: Satori introduction,
  Satori protocol overview, Koishi adapter guide, Chat SDK adapters, and Vercel
  Chat SDK guide.

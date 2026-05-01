# Phase 2 — Approval & IM Surface Implementation Plan (v2.2 — POST-FIX-ARC + ROUND-2 POLISH)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **REVISED v2.2** — plan v1 was REJECTED by combined review (Codex P0×7, P1×7); plan v2 (v1.5) applied the full fix arc and was re-reviewed → **APPROVE_WITH_CHANGES, 0 P0 blockers, T2 authorized after polish per Codex round-2 explicit "yes after P1 edits"**. This revision (v2.2) applies all 14 round-2 polish items (3 tension resolutions + 3 Codex P1 + 4 gstack P1 + 7 P2). **No round-3 review required**; T2 may begin after the post-polish docs-only gates pass and this plan is committed. See §10C for the polish manifest, §10D for the round-2 review verdicts verbatim.

**Mission:** Land the approval public-resolution surface, the platform-agnostic approval rendering model, and a fake end-to-end approval flow on top of the Phase 1 runtime kernel — without coupling any of it to a real IM platform. The plan now isolates protocol-method classification inside core, keeps the renderer method-string-free, binds approvals to actor + target + callback nonce at the broker level, makes expiry fail-closed inside `resolve()`, preserves B-clean `settleOnce` byte-for-byte, and uses real generated wire decision values.

**Architecture:** Three new packages — `@codex-im/render` (RichBlock + ApprovalCard + ApprovalUiAction + redact-aware projection), `@codex-im/channel-core` (`ChannelAdapter` interface + types + `TelegramShapeFakeChannelAdapter`), and (conditional, T20a–c only) `@codex-im/im-telegram`. Phase 1 packages extend at exactly two seams: `@codex-im/core` adds (a) `classifyApprovalRequest` + `ApprovalRequestKind`, (b) `enablePendingMode<M>(method)`, (c) `resolve` / `listPending` / `getPending` / `bindActorPolicy` / lifecycle emitters, (d) `actionToDecision` + per-method wire mapper, (e) `audit` + `redact` (relocated from render), all routed through a private `#settleEntry` helper that calls untouched `settleOnce`. `@codex-im/codex-runtime` is unchanged in surface.

**Tech Stack:** TypeScript 5.9 strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess; Vitest 4 (`test.projects` for unit/contract); Biome 1.9; pnpm workspace; Node 24+. Optional Telegram dependency: `grammY` (only if D17 is changed to Option B).

**Phase 1 contracts (do not modify):** `AppServerClient` (ONE-SHOT, JSDoc-locked), `StdioTransport`, `JsonlDecoder`, `EventNormalizer` (B-clean lifecycle plus single-FIFO walk-and-drop), `ApprovalBroker` internal `PendingEntry.settleOnce` machinery (Phase 2 wraps via `#settleEntry`, never touches `settleOnce` body), `Supervisor` quartet ownership, `CodexRuntime` `REQUEST_METHODS` table.

**Protocol evidence pinned (2026-05-01):**

| Method | Wire response shape | Wire decision values |
|---|---|---|
| `item/commandExecution/requestApproval` | `{decision: CommandExecutionApprovalDecision}` | `"accept"` / `"acceptForSession"` / `"decline"` / `"cancel"` (+ `acceptWithExecpolicyAmendment{}` / `applyNetworkPolicyAmendment{}` — Phase 2 does NOT expose policy-amendment variants) |
| `item/fileChange/requestApproval` | `{decision: FileChangeApprovalDecision}` | `"accept"` / `"acceptForSession"` / `"decline"` / `"cancel"` |
| `item/permissions/requestApproval` | `{permissions: GrantedPermissionProfile, scope: "turn"\|"session", strictAutoReview?: boolean}` | NOT a decision string — needs original-params context to fill. Phase 2 supports `decline` only (returns `{permissions: {}, scope: "turn"}`) |
| `item/tool/requestUserInput` | `{answers: {[key: string]?: ToolRequestUserInputAnswer}}` | NOT a decision — typed answers per question. Phase 2 supports `decline` only (`{answers: {}}`) |
| `item/tool/call` (Computer Use) | `{contentItems: [], success: boolean}` | NOT a decision. Phase 2: decline-only (`{contentItems: [], success: false}`) |
| `mcpServer/elicitation/request` | `{action: "accept"\|"decline"\|"cancel", content: JsonValue\|null, _meta: JsonValue\|null}` | `"decline"` / `"cancel"` only in Phase 2 (accept needs content payload) |
| `applyPatchApproval` (legacy) | `{decision: ReviewDecision}` | `"approved"` / `"approved_for_session"` / `"denied"` / `"abort"` |
| `execCommandApproval` (legacy) | `{decision: ReviewDecision}` | Same legacy ReviewDecision values |
| `account/chatgptAuthTokens/refresh` | `{accessToken: string, chatgptAccountId: string, chatgptPlanType: string\|null}` | NOT representable from IM — Phase 2 throws `JsonRpcResponseError(-32601)` (Phase 1 default-reject preserved) |

**Wire vocabulary is not uniform.** v2 methods use `accept`/`acceptForSession`/`decline`/`cancel`. Legacy methods use `approved`/`approved_for_session`/`denied`/`abort`. Permissions/tool-input/tool-call/elicitation/auth-refresh have non-decision shapes. The mapper in §1 D11 below speaks all five families.

---

## 0. Scope

### 0.1 In scope

| ID | Item | Source |
|---|---|---|
| **P2.1** | `ApprovalRequestKind` + `classifyApprovalRequest(method)` in core (the only place protocol method literals appear in Phase 2's new code below the broker boundary) | Codex P0-1 / F1; D18 |
| **P2.2** | `ApprovalBroker.enablePendingMode<M>(method)` — the IM-driven pending bootstrap that creates `PendingEntry` and awaits external `resolve()` instead of running a handler IIFE | Codex P0-2 / F2; D18 |
| **P2.3** | `ApprovalBroker.resolve(input) / listPending() / getPending(id)` public surface, with internal `#pendingById` terminal lookup, in-resolve expiry check, per-card actor binding validation, and routing through `#settleEntry` | Codex P0-3, P0-4, P0-5, P0-6 / F3, F4, F5, F6; D19, D20, D21 |
| **P2.4** | Per-method wire decision mapper (`mapDecisionForPending(record, decision)`) using real generated values; UI-action → decision translator (`actionToDecision`); fail-closed for unsupported decisions | Codex P0-1 + P1-1 / F8, F11; D11 |
| **P2.5** | `AuditEmitter` with **12 event kinds**, redact-applied at emit, in-memory ring + structured pino-compatible sink (duck-typed `AuditLogger`), `_auditRingForTest()` test escape hatch | Codex P0-7 + P1-2 + gstack Q4 / F7, F9; round-2 deep-review P1-3 (count fix), P2-7b (logger doc) |
| **P2.6** | `redact.ts` relocated to `@codex-im/core`; expanded coverage (env-var values, PEM/TLS certs, Slack/OpenAI tokens, contextual long base64) per Codex Q5; truncate utility | gstack A4 + Codex Q5 / F10 |
| **P2.7** | `@codex-im/render` package: `RichBlock` discriminated union (text/approval/unknown, Phase 2 minimum), `ApprovalCard`, `ApprovalUiAction`, `project-approval.ts` switching on `ApprovalRequestKind` (zero protocol method literals), plain-text capability fallback | F12 + F1 boundary preservation |
| **P2.8** | `@codex-im/channel-core`: `ChannelAdapter` interface (closed for Phase 2 with reviewer-amendment escape clause), `Target` / `Sender` / `MessageRef` / `InboundMessage` / `InboundAction`, `ChannelCapabilities`, `TelegramShapeFakeChannelAdapter` with cited Telegram Bot API source | gstack A7 + Codex P2 + F13 |
| **P2.9** | Method-literal grep guard scope extension to `packages/render/src/**`, `packages/channel-core/src/**`, conditional `packages/im-telegram/src/**`, with explicit allow-list entry for `packages/core/src/approval-request-kind.ts` (the single classifier file) | gstack A3 + F1 |
| **P2.10** | Fake end-to-end approval flow with all 9 paths PLUS the codex-required missing tests: pending-handler-bootstrap, resolve-terminal-lookup, in-resolve expiry, wrong-actor-before-first-decision, secondary-index drift, audit-redaction-per-failure-branch, RichBlock projection | F1 through F14; gstack T-G1/T-G2/T-G3; Codex missing-tests |
| **P2.11** | `runtime-send` vs `Supervisor` integration — runtime-send stays direct; Supervisor end-to-end test adds a runtime invariant check at `#spawnFresh` head asserting broker is pre-attached | gstack A8 + D16 |
| **P2.12** | `D17 Option C` — `TelegramShapeFakeChannelAdapter` (renamed per Codex P2). Real Telegram is Phase 3 unless plan-eng-review + Codex re-review explicitly approve Option B | D17 |
| **P2.13** | Documentation — Phase 2 close-out: 06-IM-ADAPTERS validation, handoff `2026-05-XX-phase2-to-phase3.md`, README package count + test count refresh, TODOS.md backlog update, CLAUDE.md "Method literal policy" section updated for new packages, README + handoff + T19 test names emphasizing "production = Supervisor; runtime-send = dev/operator only" | gstack Q2 + Codex Q6 |

### 0.2 Non-goals (reject if asked)

- ❌ Feishu/Lark adapter (= Phase 4)
- ❌ DingTalk adapter (= Phase 5)
- ❌ Computer Use production flow / `/cu` command implementation (= Phase 6)
- ❌ Public WebSocket / public HTTP listener (= Phase 8)
- ❌ Rewriting any Phase 0/1 module — extend only at the two documented seams (`@codex-im/core` adds public surface; `@codex-im/codex-runtime` unchanged)
- ❌ **Modifying `ApprovalBroker.PendingEntry.settleOnce` body** — Phase 2 wraps via `#settleEntry` helper; the existing settleOnce winner-takes-all semantics stay byte-for-byte unchanged
- ❌ SQLite storage / `@codex-im/storage-sqlite` package (defer to Phase 3 ops hardening; Phase 2 uses in-memory ring + structured pino emit with redact)
- ❌ `launchd` plist / install scripts (Phase 3)
- ❌ `SecurityPolicy` full implementation (Phase 3) — Phase 2 ships `bindActorPolicy` per-card binding, NOT a global ACL/whitelist
- ❌ `SessionRouter` / `CommandRouter` full implementation (Phase 3+) — Phase 2 stubs the *minimum* they need (project-less single-target routing) and explicitly defers full implementation
- ❌ Codex CLI/TUI wrapper or terminal-output parsing (Phase 0/1 redline, forever non-goal)
- ❌ Auto-approve, fail-open, or implicit approvals (Phase 0/1 redline)
- ❌ Hardcoding ClientRequest or ServerRequest method literals outside the three approved homes (`packages/codex-runtime/src/runtime.ts` `REQUEST_METHODS`, `packages/core/src/approval-broker.ts` `DispatchTable`, `packages/core/src/approval-request-kind.ts` (the only Phase 2 classifier — see §0.4 redline; `decision-mapper.ts` is NOT exempt and MUST be method-string-free, switching only on `ApprovalRequestKind`))
- ❌ `ChannelAdapter` calling `AppServerClient` / `CodexRuntime` directly — must route through Core orchestration
- ❌ `ChannelAdapter` consuming raw `JsonRpcNotification` / `JsonRpcRequest` — only the normalized `RichBlock` / `ApprovalCard`
- ❌ Renderer (`@codex-im/render`) switching on protocol method strings — must switch on `ApprovalRequestKind` only
- ❌ "First actor wins" approval semantics — replaced by `bindActorPolicy` per-card binding; first unauthorized click MUST NOT capture or approve
- ❌ Relying on `expirePending()` sweep for resolve-time safety — `resolve()` checks expiry internally
- ❌ Using `"approve"` as a Codex wire decision (it's not a real value; v2 = `"accept"`, legacy = `"approved"`)
- ❌ Default `pnpm test` running Telegram adapter against real Telegram API — adapter tests use fake transport / mocked HTTP
- ❌ Bot tokens in repo, in commits, or in any logged structure
- ❌ Computer Use prompt-keyword detection or sensitive-action heuristics (Phase 6 scope; Phase 2 must NOT implement)
- ❌ Implementation code (T2 onward) starting before this revised plan passes both re-reviews

### 0.3 Phase 0/1 redlines (still in force)

Carried verbatim from CLAUDE.md / handoff §"Phase 1 红线复核". Any Phase 2 task that would violate one of these is **rejected at review**:

- No Codex CLI/TUI wrapper; no terminal output parsing.
- `AppServerClient` is ONE-SHOT; supervisor swaps the quartet on every recovery.
- Method-name string literals confined to the approved homes (see §0.4 below for Phase 2 additions).
- `ApprovalBroker` is the sole owner of `client.setServerRequestHandler`. `_attachedClients` WeakSet enforces D7.
- B-clean: `PendingEntry.settleOnce` is the only path to a wire response. **Phase 2 routes through `#settleEntry` helper; settleOnce body stays byte-for-byte unchanged.**
- Unknown ServerRequest methods → -32601 fail-closed. Unknown ServerNotification arms → `{ type: "unknown", method, params }` event.
- Approvals never auto-approve; default-deny is the broker's invariant.
- Computer Use needs explicit `/cu` (Phase 6); no implicit triggers.
- Logs redact secrets.
- Each task only touches files in its plan-listed Files block.

### 0.4 New redlines added by Phase 2 (combining v1 + Codex P0/P1 fixes)

- ❌ Wrong-actor / wrong-target / stale-callback approval decisions MUST fail closed via `broker.resolve` returning `{kind:"error", error: ...}` AND emitting an audit event. The first unauthorized click MUST NOT bind or approve.
- ❌ Duplicate-click approval decisions (same approvalId, after first decision settled) MUST fail closed via `already_resolved` and route through `#settleEntry` (which audits the losing settle).
- ❌ Expired approvals MUST fail closed inside `resolve()` itself, regardless of whether `expirePending()` has run. `expirePending` is a memory-hygiene sweeper, NOT a safety mechanism.
- ❌ `ChannelAdapter.answerAction` MUST acknowledge the IM platform's callback within the platform's deadline (Telegram: ≤10s practical, 60s absolute drop — see T14 cited Telegram Bot API). The broker decision evaluation may take longer; the two operations are decoupled.
- ❌ Rendering layer MUST consume `ApprovalCard` projections via `ApprovalRequestKind`, NEVER raw `ApprovalRecord.params` or raw protocol method strings.
- ❌ Renderer MUST consume `ApprovalRequestKind` from the core classifier; the renderer file `project-approval.ts` MUST NOT contain any of the 9 ServerRequest method literals. (This is enforced by the grep guard scope extension in P2.9.)
- ❌ `TelegramShapeFakeChannelAdapter` is the canonical Phase 2 reference. Telegram-specific concerns (callback_data byte limits, parse_mode quirks, callback_query deadlines) live in the adapter only. Phase 4/5 platforms (when they ship) MUST conform to `ChannelAdapter` without interface change OR explicitly amend the interface via a reviewed plan amendment.
- ❌ Wire-unknown ServerRequest method gets `-32601` fail-closed in broker `#handle` AND an `approval.unsupported_method` audit event with NO PendingEntry created. Renderer-defensive unknown-snapshot (e.g. when a `PendingApprovalSnapshot` somehow reaches the renderer with `classifyApprovalRequest(method) === "unknown"` despite the broker's `#handle` fail-closed) renders a **decline-only `ApprovalCard`** with safe fallback text — no allow/accept actions, no abort. Risk level "critical". These are TWO different code paths — broker boundary vs. render boundary — and must be tested separately.
- ❌ Unsupported (decision, method) pairs in the wire mapper MUST throw `JsonRpcResponseError(-32601)` (or return a structured `unsupported_decision` error, depending on the call path) — never coerce to a "nearest" decision. The renderer MUST only surface ApprovalActions whose mapping is supported for the request's kind.
- ❌ Telegram bot token (P2.12 Option B only, default not shipped) MUST come from env or macOS Keychain; CLI / config files store env-var name, never the value.
- ❌ Implementation code MUST NOT start until this revised plan passes gstack `/plan-eng-review` re-review AND Codex outside-voice re-review.
- ❌ `runtime-send` is dev/operator tooling only. **Production flows go through `Supervisor`.** This MUST be stated in `runtime-send.ts` JSDoc, README, the Phase 2→Phase 3 handoff, the T19 Supervisor integration test names (e.g. `supervisor-end-to-end-pre-attached-broker.test.ts`), and in CLAUDE.md "Compact / Resume Instructions" / project redlines.

### 0.5 Prerequisites

None. Phase 1 tag is at HEAD (`phase-1-runtime-complete` = `23cbca7`). Pre-2 facade already exposes every protocol type Phase 2 imports. The following protocol-evidence inspection has been completed (logged in plan v2 header table) and feeds D11 + the wire mapper:

- `packages/codex-protocol/src/generated/v2/CommandExecutionApprovalDecision.ts:7`
- `packages/codex-protocol/src/generated/v2/FileChangeApprovalDecision.ts:5`
- `packages/codex-protocol/src/generated/v2/PermissionsRequestApprovalResponse.ts:7`
- `packages/codex-protocol/src/generated/v2/ToolRequestUserInputResponse.ts:9`
- `packages/codex-protocol/src/generated/v2/DynamicToolCallResponse.ts:6`
- `packages/codex-protocol/src/generated/v2/McpServerElicitationAction.ts:5`
- `packages/codex-protocol/src/generated/v2/McpServerElicitationRequestResponse.ts:7`
- `packages/codex-protocol/src/generated/ApplyPatchApprovalResponse.ts:6`
- `packages/codex-protocol/src/generated/ExecCommandApprovalResponse.ts:6`
- `packages/codex-protocol/src/generated/ReviewDecision.ts:10`
- `packages/codex-protocol/src/generated/v2/ChatgptAuthTokensRefreshResponse.ts:5`
- `packages/codex-protocol/src/generated/v2/PermissionGrantScope.ts:5`

---

## 1. Decision Log (Phase 2)

> Decisions D5–D10 carry forward from Phase 1 unchanged. Phase 2 v2 adds D11–D21. **Decisions revised in v2 (post-fix-arc) are marked `[REVISED v2]`. New decisions added by the fix arc are marked `[NEW v2]`.**

### D11 [REVISED v2] — Per-method wire mapping uses real generated values; mapper takes pending record (not just method)

**Context (revised):** v2 approval response shapes differ per method (05-PROTOCOL §4.1 + protocol evidence in plan header). My v1 example wrongly used `"approve"`. Generated wire values are: v2 = `"accept"` / `"acceptForSession"` / `"decline"` / `"cancel"`; legacy = `"approved"` / `"approved_for_session"` / `"denied"` / `"abort"`; permissions/tool-input/tool-call/elicitation/auth-refresh have non-decision shapes. Codex P0-1 + P1-1 caught this.

**Decision (revised):** A per-`ApprovalRequestKind` mapper, NOT per-method-string. Signature takes the pending record (gives mapper access to original params, needed e.g. for permissions response shape).

```ts
// packages/core/src/decision-mapper.ts
export type ApprovalUiAction =
  | { kind: "allow_once" }
  | { kind: "allow_session" }
  | { kind: "decline" }
  | { kind: "abort" };

export type WireDecisionResult =
  | { kind: "ok"; value: unknown }                                   // pass to settleOnce({type:"resolve", value})
  | { kind: "error"; error: JsonRpcResponseError }                   // pass to settleOnce({type:"reject", error}); routes via Pre-3 catch arm
  | { kind: "unsupported"; reason: string };                         // resolve() returns ResolveError without settling wire

export function mapDecisionForPending(
  record: ApprovalRecord,
  uiAction: ApprovalUiAction,
): WireDecisionResult;
```

Per-`ApprovalRequestKind` mapping table (Phase 2 supports the **bold** subset; the rest return `{kind:"unsupported"}`):

| Kind | allow_once | allow_session | decline | abort |
|---|---|---|---|---|
| `command_execution` | **`{decision:"accept"}`** | **`{decision:"acceptForSession"}`** | **`{decision:"decline"}`** | **`{decision:"cancel"}`** |
| `file_change` | **`{decision:"accept"}`** | **`{decision:"acceptForSession"}`** | **`{decision:"decline"}`** | **`{decision:"cancel"}`** |
| `permissions` | unsupported (needs params context Phase 2 doesn't model) | unsupported | **`{permissions:{},scope:"turn"}`** | unsupported |
| `tool_user_input` | unsupported (needs typed answers) | unsupported | **`{answers:{}}`** | unsupported |
| `tool_call` (Computer Use) | unsupported (Phase 6 scope) | unsupported | **`{contentItems:[],success:false}`** | unsupported |
| `mcp_elicitation` | unsupported (needs accept content) | unsupported | **`{action:"decline",content:null,_meta:null}`** | **`{action:"cancel",content:null,_meta:null}`** |
| `legacy_apply_patch` | **`{decision:"approved"}`** | **`{decision:"approved_for_session"}`** | **`{decision:"denied"}`** | **`{decision:"abort"}`** |
| `legacy_exec_command` | **`{decision:"approved"}`** | **`{decision:"approved_for_session"}`** | **`{decision:"denied"}`** | **`{decision:"abort"}`** |
| `auth_token_refresh` | error JsonRpcResponseError(-32601) | error -32601 | error -32601 | error -32601 |
| `unknown` | unsupported (broker level handled at #handle; renderer level renders decline-only) | unsupported | unsupported | unsupported |

Type-only validation tests (`packages/core/test/decision-mapper-shapes.test.ts`) declare `_v2_*` constants per supported (kind, action) pair to assert against generated TS. Build fails if codex 0.126 widens or narrows a response shape.

**Rejected:**
- ❌ `mapDecisionForMethod(method, decision)` (v1) — couples mapper to protocol method strings (boundary violation per Codex P0-1) AND lacks params context permissions needs.
- ❌ Coercing unsupported decisions to nearest representable (e.g. `allow_session` → `accept`) — breaks Codex Q4 fail-closed posture.
- ❌ Letting the IM adapter return raw response shapes — couples adapter to protocol; loses platform-agnostic rendering invariant.

### D12 [REVISED v2] — Read-only snapshot API + internal terminal lookup; emitters at `#settleEntry` boundary

**Context (revised):** Codex P0-3 caught that `resolve()` using public `getPending()` (status-filtered) makes terminal-state errors unreachable. The fix: public-surface APIs filter by status; internal lookup (used by `resolve()`, expirePending, failPendingAsTransportLost) goes through `#pendingById` and sees terminal records.

**Decision (revised):**

Public read API (status-filtered, defensive copies):
```ts
broker.listPending(): readonly PendingApprovalSnapshot[]   // status === "pending" only
broker.getPending(approvalId): PendingApprovalSnapshot | null   // returns null for terminal records
```

Internal lookup (broker-private, used by resolve / expire / transport-lost):
```ts
this.#pendingById: Map<string, PendingEntry>   // keyed by ApprovalRecord.id; terminal records retained for audit
```

Resolve path (D20-aware, expiry checked internally):
```ts
broker.resolve(input: ResolveApprovalInput): Promise<ResolveApprovalResult>
// 1. Internal #pendingById lookup → null → unknown_approval_id
// 2. If entry.record.status === "resolved" → already_resolved (with priorDecision)
// 3. If entry.record.status === "expired" → expired
// 4. If entry.record.status === "transport_lost" → transport_lost
// 5. If Date.now() >= entry.record.expiresAt.getTime() (D20):
//      flip status to "expired"; settleOnce via #settleEntry with kind-specific defaultReject; return expired
// 6. Validate against bindActorPolicy (D19): wrong actor / target / nonce → audit + return wrong_actor / wrong_target / stale_callback
// 7. mapDecisionForPending(record, uiAction) → unsupported → audit + return unsupported_decision
// 8. settleOnce via #settleEntry with mapped wire value → audit "approval.resolved" → return ok
```

Lifecycle emitters (Codex P0-6 / F6 — at `#settleEntry`, NOT `settleOnce`):
```ts
broker.onPendingCreated(handler: (snap: PendingApprovalSnapshot) => void): () => void
broker.onPendingResolved(handler: (snap: PendingApprovalSnapshot, outcome: ResolvedOutcome) => void): () => void

// Internally, broker exposes a single private helper. ALL settle call sites in the broker route
// through this helper; settleOnce body is BYTE-FOR-BYTE unchanged (see D21). Audit semantics
// match D21 (winning settle → original kind; losing settle → "approval.duplicate_attempt"):
#settleEntry(entry: PendingEntry, outcome: WireOutcome, audit: AuditEventInput): { won: boolean } {
  const won = entry.settleOnce(outcome);
  if (won) {
    this.#audit.emit(audit);                                    // original semantic kind on win
    this.#emitPendingResolved(entry.record);                    // observer fires only on win
  } else {
    this.#audit.emit({                                          // distinct kind on loss for filterability
      ...audit,
      kind: "approval.duplicate_attempt",
      outcome: "lost-race",
    });
  }
  return { won };
}
```

**Rejected:**
- ❌ Returning the live `#pending` Map publicly — leaks B-clean internals.
- ❌ Public `getPending` returning terminal records — confusing API; resolve() uses internal map for terminal lookup.
- ❌ Wrapping or replacing `settleOnce` itself — Codex P0-6; preserves B-clean.

### D13 [REVISED v2] — In-memory ring + structured pino + redact-applied; 12 event kinds enumerated; constructor-configurable with hard MAX 100_000

**Context (revised):** Codex P0-7 + P1-2 + Q5: audit event kinds must be enumerated and tested per-call-site; redact must be applied INSIDE `audit.emit` (not in render); ring buffer should be constructor-configurable. gstack Q4: test escape hatch via `_auditRingForTest()`.

**Decision (revised):**

```ts
// packages/core/src/audit.ts
export type AuditEventKind =
  | "approval.created"
  | "approval.resolved"
  | "approval.expired"
  | "approval.transport_lost"
  | "approval.duplicate_attempt"             // late settle that lost the race; audit visibility for B-clean
  | "approval.wrong_actor"                    // bindActorPolicy validation failure
  | "approval.wrong_target"                   // bindActorPolicy target mismatch
  | "approval.stale_callback"                 // bindActorPolicy nonce mismatch
  | "approval.binding_required"               // resolve() called before bindActorPolicy (operator/daemon-wireup bug; D19)
  | "approval.unknown_approval_id"            // resolve() called with id not in #pendingById (e.g. typo or completely fabricated id)
  | "approval.unsupported_method"             // wire-level unknown method (#handle path; -32601 sent; no PendingEntry created)
  | "approval.unsupported_decision";          // mapper rejected (decision, kind) pair

export type AuditEvent = {
  readonly id: string;                         // ulid or uuid
  readonly kind: AuditEventKind;
  readonly approvalId?: string;
  readonly appServerRequestId?: string | number;
  readonly actor?: ApprovalActor;
  readonly target?: Target;                    // captured from bindActorPolicy when relevant
  readonly metadata?: Readonly<Record<string, unknown>>;   // method-specific extras (REDACTED before storage)
  readonly createdAt: Date;
};

/**
 * Minimal duck-typed logger sink (round-2 deep-review P2-7b / approved T3
 * decision): `pino.Logger.info(obj)` and any structured-log shim with the
 * same single-object shape satisfy this. `@codex-im/core` does NOT take a
 * runtime dependency on pino — daemon wire-up passes a real pino logger,
 * tests pass `vi.fn()` mocks. Behaviorally identical to D13's intent;
 * keeps core logger-implementation-agnostic.
 */
export interface AuditLogger {
  info(payload: object): void;
}

export class AuditEmitter {
  constructor(opts?: { ringSize?: number; logger?: AuditLogger; redact?: typeof defaultRedact });
  // Hard MAX (D13 round-2 fix per Codex Q4): if `opts.ringSize > 100_000`, throw on construction.
  // Default 1000. Anything reasonable up to 100_000 is allowed; above that is a config bug.
  emit(event: AuditEventInput): void;          // applies redact to event.metadata BEFORE pino emit AND ring storage
  recent(filter?: { limit?: number; kind?: AuditEventKind }): readonly AuditEvent[];
  _auditRingForTest(): readonly AuditEvent[];  // Phase 1 _pendingRecordsForTest pattern
}

const AUDIT_RING_HARD_MAX = 100_000;            // throw on opts.ringSize > this
```

Default ring size 1000; FIFO drop oldest when full; tested at boundary; constructor throws if `ringSize > AUDIT_RING_HARD_MAX`. Phase 3 SQLite migration replaces the ring with a repository, leaving `emit` API stable.

**Rejected:**
- ❌ Storing audit in SQLite during Phase 2 — drags `@codex-im/storage-sqlite` into scope.
- ❌ Pino-only with no in-memory store — Phase 2 tests need to assert audit emission shape.
- ❌ Render-side redaction only — Codex P1-3: pino lines emitted from core would bypass it.

### D14 [REVISED v2] — `ChannelAdapter` is closed for Phase 2; future amendment via reviewed plan amendment

**Context (revised):** Codex P2: my v1 over-promised that Phase 4/5 will never need changes. The honest version: closed for Phase 2, and any future change is a plan amendment not a Phase 2 retrofit.

**Decision (revised):** `ChannelAdapter` interface is closed for Phase 2 implementations. `TelegramShapeFakeChannelAdapter` is the canonical reference. Phase 4 / Phase 5 / future adapter additions MUST conform without interface change OR submit a plan amendment that goes through plan-eng-review + Codex outside-voice. Capability matrix (`ChannelCapabilities`) is the only escape hatch for adapter divergence within the closed interface.

**Rejected:** v1's "Phase 4/5 adapters MUST conform without interface changes" — too strong; replaced.

### D15 [REVISED v2] — Stable id `approval-${appServerRequestId}` with secondary index invariant tests

**Context (revised):** Codex D15 verdict: APPROVE_WITH_CHANGES — add secondary-index drift tests + callback hash/collision tests for Option B/C.

**Decision (revised):** All Phase 2 surface APIs use `ApprovalRecord.id` (= `approval-${appServerRequestId}`). The broker maintains:
- `#pending: Map<string|number, PendingEntry>` keyed by wire id (Phase 1 contract; unchanged).
- `#pendingById: Map<string, PendingEntry>` keyed by stable id (NEW in Phase 2).

**Invariants enforced by tests** (T-G-codex from §10):
1. Both maps insert in lock-step inside `#handle` lines 463–465.
2. Both maps' delete paths (the `#handle` finally conditional delete) fire in lock-step on terminal status flip skip.
3. After `expirePending` / `failPendingAsTransportLost` / `resolve`, the entry status is terminal AND the entry remains in BOTH maps (Phase 1 D6 audit invariant; not deleted until prune sweep).
4. `listPending()` filters by `status === "pending"` over `#pending.values()`.
5. `getPending(approvalId)` looks up `#pendingById` and filters by `status === "pending"`.
6. `resolve()` looks up `#pendingById` WITHOUT status filter — sees terminal records and returns matching ResolveError kind.

For Option B/C `TelegramShapeFakeChannelAdapter`, callback codec round-trip tests verify max-length approvalId encodes within Telegram's 64-byte callback_data limit.

### D16 [APPROVED — both reviewers] — `runtime-send` stays direct; T19 adds Supervisor integration test with runtime invariant assertion

**Decision (unchanged from v1, with gstack A8 fix):** `runtime-send` (T10 of Phase 1) does NOT route through Supervisor. T19 of Phase 2 adds `packages/daemon/test/supervisor-end-to-end-pre-attached-broker.test.ts` exercising the full quartet through `Supervisor.start()` + `FakeAppServer`-backed transport, plus a runtime invariant check at `Supervisor.#spawnFresh` head:

```ts
// packages/daemon/src/supervisor.ts (added by T19):
async #spawnFresh(): Promise<void> {
  // ... existing setup ...
  if (!this.#opts.broker.isAttached()) {
    throw new Error(
      "Supervisor.#spawnFresh: broker MUST be pre-attached via attach() before clientFactory; " +
        "production flows route through Supervisor; runtime-send is dev/operator tooling only."
    );
  }
  // ... rest of spawn ...
}

// packages/core/src/approval-broker.ts (added by Phase 2):
isAttached(): boolean { return this.#attached; }
```

T19 test names use the load-bearing wording so future maintainers can't miss it: `supervisor-end-to-end-pre-attached-broker.test.ts`, `pre-attached-contract-runtime-invariant.test.ts`. README + handoff + CLAUDE.md restate "production = Supervisor; runtime-send = dev/operator tooling only" prominently.

**Rejected:**
- ❌ Routing `runtime-send` through Supervisor — adds startup latency and lifecycle complexity to a dev tool.
- ❌ Defer-with-stronger-documentation only — Codex Q6: not loud enough.

### D17 [CONFIRMED — both reviewers] — Telegram MVP: Option C (`TelegramShapeFakeChannelAdapter`)

**Decision (unchanged):** Phase 2 ships Option C: `@codex-im/channel-core/src/fake.ts` exports `TelegramShapeFakeChannelAdapter` (renamed per Codex P2) that simulates Telegram's hardest constraints — callback_data ≤ 62 bytes (below the Bot API's 64-byte limit per [Telegram Bot API docs §inline keyboards](https://core.telegram.org/bots/api#inlinekeyboardbutton)), parse_mode unsupported in fake, callback_query answer deadline 60s absolute (per [Telegram Bot API §answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery); practical user-visible deadline ~10s before Telegram drops the loading state).

Real Telegram (Option B `@codex-im/im-telegram` package) is **Phase 3**, unless the v2 plan re-reviews explicitly approve elevating to Option B. Default: Option B is OUT of Phase 2.

**Rejected:** Option A (defer entirely without a Telegram-shape fake) — leaves Phase 4 to discover Telegram's constraints during implementation; Option C catches them at design time.

### D18 [NEW v2] — Pending-mode broker API: `enablePendingMode<M>(method)` (codifies F1 + F2)

**Context:** The Phase 1 broker creates a `PendingEntry` only when `registerHandler<M>(method, handler)` installs a non-null handler. With handler null, `#handle` synchronously calls `defaultReject()` — there is NO pending state, NO chance for IM resolution. Codex P0-2 caught that v1 T8/T19 tried to test the IM flow this way, and it would have been a fake-pass.

**Decision:** Add a third dispatch mode "pending":

```ts
type DispatcherSpec<P, R> = {
  mode: "default-reject" | "handler" | "pending";
  handler: ((req: ...) => Promise<R>) | null;
  defaultReject: () => R;
};

broker.enablePendingMode<M extends keyof DispatchTable>(method: M): void;
// Sets dispatch[method].mode = "pending"; the per-method spec stays in the same DispatchTable.
// In #handle: when mode === "pending", create PendingEntry, NO handler IIFE; await entry.completion forever.
//   The completion is settled ONLY by external resolve / expirePending / failPendingAsTransportLost.

broker.disablePendingMode<M>(method: M): void;   // returns to default-reject; mainly for tests
```

Phase 2 daemon wire-up calls `enablePendingMode("item/commandExecution/requestApproval")` etc. for the methods the IM layer should handle. Methods NOT in pending-mode default-reject (Phase 1 invariant preserved).

The `#handle` body changes are minimal and explicitly preserve B-clean:

```ts
async #handle(req: JsonRpcRequest): Promise<unknown> {
  const m = req.method as keyof DispatchTable;
  if (!Object.hasOwn(this.#table, m)) {
    this.#audit.emit({ kind: "approval.unsupported_method", appServerRequestId: req.id, ... });   // NEW
    throw new JsonRpcResponseError({ code: -32601, message: `unsupported method ${req.method}` });
  }
  const spec = this.#table[m];
  if (spec.mode === "default-reject") {
    return spec.defaultReject();   // Phase 1 path, unchanged
  }
  // mode === "handler" || "pending"
  const record: ApprovalRecord = { ... expiresAt: new Date(Date.now() + this.#ttlMs) };
  const entry = createPendingEntry(record, spec);
  this.#pending.set(req.id, entry);
  this.#pendingById.set(record.id, entry);   // NEW secondary index
  this.#emitPendingCreated(record);          // NEW emit at create boundary
  this.#audit.emit({ kind: "approval.created", approvalId: record.id, ... });   // NEW

  if (spec.mode === "handler") {
    void (async () => {
      try {
        const result = await (spec.handler!)(req);
        this.#settleEntry(entry, { type: "resolve", value: result }, { kind: "approval.resolved", actor: { kind: "system", reason: "handler" } });
      } catch (err) {
        this.#settleEntry(entry, { type: "reject", error: err }, { kind: "approval.resolved", actor: { kind: "system", reason: "handler-error" } });
      }
    })();
  }
  // If spec.mode === "pending": no IIFE; settled only by resolve/expirePending/failPendingAsTransportLost.

  try {
    return await entry.completion;
  } finally {
    if (entry.record.status === "pending") {
      this.#pending.delete(req.id);
      this.#pendingById.delete(record.id);
    }
  }
}
```

**`createPendingEntry()` body and `entry.settleOnce` body are byte-for-byte unchanged** (Codex P0-6).

**Rejected:**
- ❌ A "do-nothing" dummy handler that never resolves — confusing intent; pending-mode is the right semantic.
- ❌ Per-broker `Set<string>` of pending-mode methods stored separately from the dispatch table — drift risk.

### D19 [NEW v2] — Per-card actor binding: `bindActorPolicy(approvalId, policy)` (codifies F4/F5)

**Context:** Codex P0-5 elevated my v1 "first actor wins" semantics to a P0 redline violation. The card targets one or more allowed actors at send time; mismatching actors fail closed.

**Decision:** Add `broker.bindActorPolicy` called BY the IM-rendering wiring (typically the daemon's wire-up subscriber to `onPendingCreated`) once before the card lands in front of users:

```ts
export type ActorPolicy = {
  readonly allowedActors: readonly ApprovalActor[];   // Phase 2 typically singletons; Phase 3 ACL widens
  readonly target: Target;                              // platform + chatId + topicId
  readonly callbackNonce: string;                      // 16+ random bytes; bound to the rendered card
};

broker.bindActorPolicy(approvalId: string, policy: ActorPolicy): BindResult;
// BindResult = { kind: "ok" } | { kind: "error", error: BindError };
// Idempotent on same policy (same actors+target+nonce); rejects re-bind with different policy.
//
// REQUIRED CALLING DISCIPLINE (R6 round-2 fix): bindActorPolicy MUST be called SYNCHRONOUSLY inside the
// `onPendingCreated` callback, BEFORE the daemon wire-up invokes adapter.sendCard. The adapter must
// receive a card whose binding is already established. Rationale: the moment the card lands in front
// of users, a callback can arrive; if binding wasn't installed first, resolve() fires with kind:
// "binding_required" and the user sees a confusing "not authorized" message for a card that the system
// just generated.
//
// If sendCard fails (network error etc.), the binding stays in place; daemon wire-up is responsible for
// audit-emitting a follow-up event AND/OR calling expirePending later. The binding being present without
// a sent card is a stuck-pending bug surface, but it is NOT a safety violation — no actor can resolve
// without a callbackNonce that came from a sent card.
//
// If resolve() fires before bindActorPolicy, resolve() fails closed with kind:"binding_required"
// (operator/daemon-wireup bug; named as a precondition violation rather than a state per Codex round-2).

broker.resolve(input: ResolveApprovalInput): ResolveApprovalResult;
// Validates against ActorPolicy:
//   - input.actor not in policy.allowedActors → wrong_actor (audit emit, return error)
//   - input.target ≠ policy.target            → wrong_target (audit emit, return error)
//   - input.callbackNonce ≠ policy.nonce      → stale_callback (audit emit, return error)
//   - any of above: NO settleOnce fires; original pending stays pending; no wire response sent.
//     Adapter receives { kind: "error", ... } and acknowledges the click as "not authorized".
```

`ResolveApprovalInput` extends to require target+callbackNonce:

```ts
export type ResolveApprovalInput = {
  readonly approvalId: string;
  readonly decision: ApprovalUiAction;
  readonly actor: NonNullable<ApprovalActor>;
  readonly target: Target;
  readonly callbackNonce: string;
};
```

**Test coverage** (T18 path 5 + new tests per Codex missing-tests):
- Actor A allowed, actor B clicks first → B sees `wrong_actor`; pending stays open; A can still decide.
- Actor A clicks twice → first decides, second sees `already_resolved`.
- Actor A clicks with stale nonce (e.g. card was edited and re-sent) → `stale_callback`.
- Wrong target (different chat) → `wrong_target`.
- Resolve before bindActorPolicy → `binding_required` (operator/daemon-wireup bug; named as a precondition violation rather than a state).

**Rejected:**
- ❌ "First actor wins" (v1 default) — Codex P0-5: not safe for approvals.
- ❌ Global ACL/whitelist — Phase 3 SecurityPolicy work; Phase 2 ships per-card binding only.
- ❌ Binding inferred from PendingEntry creation — at creation time, the broker doesn't know which actors the rendering layer will permit; must be explicit `bindActorPolicy` after card is sent.

### D20 [NEW v2] — Expiry checked inside `resolve()` (codifies F3)

**Context:** Codex P0-4: v1 `expirePending()` was the only enforcement; T19 hid this with a manual `expirePending()` call before `resolve()`. Real test: an expired approval gets approved if nobody swept first.

**Decision:** `ApprovalRecord` adds `expiresAt: Date`, set at `#handle` create-time as `createdAt + ttlMs` (default 30 min, broker-constructor-configurable). `resolve()` checks `Date.now() >= expiresAt.getTime()` BEFORE actor validation:

```ts
broker.resolve(input): ResolveApprovalResult {
  const entry = this.#pendingById.get(input.approvalId);
  if (!entry) { audit.emit({kind:"approval.unknown_approval_id"...}); return {kind:"error", error:{kind:"unknown_approval_id"}}; }
  // (round-2 deep-review P1-4: emit `approval.unknown_approval_id`, NOT
  // `approval.unsupported_method` — the latter is for wire-level unknown methods
  // arriving at #handle, which never produce a PendingEntry. resolve()'s
  // unknown-id branch is a separate code path and gets its own audit kind per D13.)
  if (entry.record.status === "resolved") { audit.emit("approval.duplicate_attempt"); return {kind:"error", error:{kind:"already_resolved", priorDecision: entry.record.decision!}}; }
  if (entry.record.status === "expired") { audit.emit("approval.duplicate_attempt"); return {kind:"error", error:{kind:"expired", ...}}; }
  if (entry.record.status === "transport_lost") { audit.emit("approval.duplicate_attempt"); return {kind:"error", error:{kind:"transport_lost", ...}}; }
  if (Date.now() >= entry.record.expiresAt.getTime()) {
    // Lazy expire — flip status, settle via #settleEntry with kind-specific defaultReject, return expired.
    // Note: `entry.spec` (PendingEntry stores its DispatcherSpec at creation time per Phase 1) — NOT a
    // free-standing `spec` lookup. R5 round-2 fix.
    entry.record.status = "expired";
    entry.record.actor = { kind: "system", reason: "expired" };
    entry.record.decidedAt = new Date();
    this.#settleEntry(entry, { type: "resolve", value: entry.spec.defaultReject() }, { kind: "approval.expired", approvalId: entry.record.id });
    return { kind: "error", error: { kind: "expired", createdAt: entry.record.createdAt, expiredAt: entry.record.expiresAt } };
  }
  // 6. ActorPolicy validation (D19): if not bound → "approval.binding_required" audit, return binding_required.
  //    If actor not in allowedActors / target ≠ policy.target / nonce ≠ policy.callbackNonce →
  //    "approval.wrong_actor"/"approval.wrong_target"/"approval.stale_callback" audit, return matching error.
  //    NO settleEntry fires; pending stays open.
  // 7. mapDecisionForPending(record, input.decision):
  //    - { kind: "ok", value }       → settleEntry({ type: "resolve", value }, { kind: "approval.resolved" }) → return ok.
  //    - { kind: "error", error }    → settleEntry({ type: "reject", error }, { kind: "approval.unsupported_decision" }) → return unsupported_decision.
  //    - { kind: "unsupported", reason } → audit "approval.unsupported_decision"; do NOT settle wire (renderer should
  //      not have surfaced this action; this is defense-in-depth); return unsupported_decision error.
}
```

`expirePending(maxAgeMs)` retains its Phase 1 behavior — sweep + settle terminal records — but is now memory hygiene only, not safety. Test coverage: an in-resolve expiry test that does NOT call expirePending() first.

**Rejected:**
- ❌ Eager expiry via `setTimeout` in `#handle` — adds timer leak risk; lazy in-resolve check is sufficient.
- ❌ Combining expiry check with sweeper — Codex P0-4: sweeper is best-effort, not safety-bearing.

### D21 [NEW v2] — `#settleEntry` helper preserves `settleOnce` byte-for-byte (codifies F6)

**Context:** Codex P0-6: v1 T5 wrote "wrap settleOnce" — that risks B-clean preservation.

**Decision:** Add a private broker helper `#settleEntry(entry, outcome, audit)` that calls untouched `settleOnce`. ALL settle call sites (`resolve`, `expirePending`, `failPendingAsTransportLost`, the handler IIFE in `#handle`) route through `#settleEntry`. The `createPendingEntry` factory and `entry.settleOnce` body remain byte-for-byte unchanged from Phase 1.

```ts
#settleEntry(entry: PendingEntry, outcome: WireOutcome, audit: AuditEventInput): { won: boolean } {
  const won = entry.settleOnce(outcome);   // Phase 1 settleOnce body — NEVER modified
  if (won) {
    this.#emitPendingResolved(entry.record);
    this.#audit.emit(audit);
  } else {
    // Late settler — entry was already settled by another path (resolve raced expirePending, etc.).
    // We still emit a `duplicate_attempt` audit event for visibility (Codex P0-7-adjacent).
    // No wire frame is sent because settleOnce returned false. B-clean is preserved.
    this.#audit.emit({ ...audit, kind: "approval.duplicate_attempt", outcome: "lost-race" });
  }
  return { won };
}
```

**Test coverage** (extends Phase 1 T9b duplicate-response tests):
- Late `resolve()` after `expirePending()` already settled: `won: false`, audit "approval.duplicate_attempt" with outcome "lost-race", no second wire frame.
- Late `failPendingAsTransportLost()` after `resolve()` already settled: same.
- All Phase 1 T9b duplicate-response tests must remain green (regression guard).

**Rejected:**
- ❌ Wrapping/replacing `settleOnce` itself — Codex P0-6.
- ❌ Skipping audit on losing settles — loses visibility into B-clean races.

---

## 2. File Structure

### 2.1 Modified packages

```
packages/core/src/
  approval-broker.ts          # MODIFIED: add enablePendingMode, resolve, listPending, getPending,
                              #          bindActorPolicy, isAttached, onPendingCreated/Resolved,
                              #          #settleEntry helper, #pendingById secondary index.
                              #          PendingEntry/createPendingEntry/settleOnce body UNCHANGED.
                              #          Method literals: still confined to DispatchTable keys (Phase 1).
  approval-request-kind.ts    # NEW: ApprovalRequestKind type + classifyApprovalRequest(method) function.
                              #      THIS IS THE ONLY new file in core/src/** allowed to contain ServerRequest
                              #      method string literals (the 9 dispatch keys) — added to grep-guard
                              #      exemption list per P2.9.
  decision-mapper.ts          # NEW: mapDecisionForPending(record, uiAction) per-kind table; per-kind
                              #      fail-closed for unsupported (decision, kind) pairs.
  action-to-decision.ts       # NEW: actionToDecision(uiAction) — pure UI→decision-kind translator
                              #      (no method awareness; method awareness lives in decision-mapper).
  audit.ts                    # NEW: AuditEvent + AuditEmitter; emits 12 event kinds (round-2
                              #      deep-review P1-3); redact applied at emit AND ring storage
                              #      (T5 owns the redact wire-up; T3 ships skeleton). Logger
                              #      surface is duck-typed AuditLogger (round-2 deep-review P2-7b /
                              #      approved T3 decision); core has no pino runtime dep.
  redact.ts                   # NEW (relocated from render — Codex P1-3 fix F10): tokens, paths, SSH keys,
                              #      env-var values, PEM/TLS certs, Slack/OpenAI tokens, contextual long
                              #      base64 (per Codex Q5 expanded coverage).
  types.ts                    # MODIFIED: add PendingApprovalSnapshot, ResolveApprovalInput,
                              #          ResolveApprovalResult, ResolveError (9 kinds — see D12),
                              #          ActorPolicy, BindResult, BindError. ApprovalRecord adds expiresAt.
  index.ts                    # MODIFIED: export the new public surface.

packages/core/test/
  approval-broker.test.ts                      # extended; existing 320 stay green
  approval-broker-pending-mode.test.ts         # NEW: enablePendingMode bootstrap tests (Codex missing #2)
  approval-broker-resolve.test.ts              # NEW: resolve happy path + 8 error branches
  approval-broker-resolve-internal-lookup.test.ts  # NEW: resolve via #pendingById not getPending (Codex missing #3)
  approval-broker-expiry-in-resolve.test.ts    # NEW: in-resolve expiry without expirePending sweep (Codex missing #4)
  approval-broker-actor-binding.test.ts        # NEW: bindActorPolicy + wrong actor BEFORE first decision (Codex missing #5)
  approval-broker-listpending.test.ts          # NEW: snapshot semantics + filtering
  approval-broker-events.test.ts               # NEW: emitters fire at #settleEntry boundary (incl. losing settle)
  approval-broker-secondary-index.test.ts      # NEW: #pendingById drift/prune invariants (Codex missing #6)
  approval-broker-settle-entry.test.ts         # NEW: #settleEntry preserves settleOnce; late-settle audit visibility
  approval-request-kind.test.ts                # NEW: classifier covers all 9 ServerRequest methods + unknown
  decision-mapper.test.ts                      # NEW: per-kind × per-action table; fail-closed for unsupported
  decision-mapper-shapes.test.ts               # NEW: _v2_* type-only assertions vs generated wire shapes
  action-to-decision.test.ts                   # NEW: pure translator
  audit.test.ts                                # NEW: 12 event kinds + ring + redact + _auditRingForTest
  audit-redaction.test.ts                      # NEW: every failure-branch fixture verified redacted (Codex missing #7)
  redact.test.ts                               # NEW: expanded coverage per Codex Q5
  no-method-literals.test.ts                   # MODIFIED: extend scope; exempt approval-request-kind.ts ONLY.
                                               #          decision-mapper.ts is NOT exempt — it switches on
                                               #          ApprovalRequestKind and must remain method-string-free.

packages/codex-runtime/                        # UNCHANGED in surface (Phase 1 contract).
packages/codex-runtime/test/no-raw-client-request.test.ts   # MODIFIED: extend scope to render/, channel-core/, im-telegram/
packages/app-server-client/                    # UNCHANGED. Phase 0 contract.
packages/codex-protocol/                       # UNCHANGED. Pre-2 facade already covers Phase 2.
packages/testkit/                              # UNCHANGED interface; existing FakeAppServer.emitServerRequest
                                               # is sufficient for the fake e2e flow.
packages/cli/                                  # UNCHANGED in surface. runtime-send stays direct (D16).
                                               # JSDoc updated in T22 to emphasize "dev/operator only".
packages/daemon/src/supervisor.ts              # MODIFIED: add isAttached() runtime invariant assertion at
                                               # #spawnFresh head (D16 fix). No other surface change.
packages/daemon/test/                          # NEW test files (T19):
  supervisor-end-to-end-pre-attached-broker.test.ts
  pre-attached-contract-runtime-invariant.test.ts
```

### 2.2 New packages

```
packages/render/
  src/
    rich-block.ts             # RichBlock discriminated union (Phase 2 minimum: text / approval / unknown).
    approval-card.ts          # ApprovalCard + ApprovalAction + ApprovalStatus + ApprovalTarget +
                              # ApprovalUiAction (the UI-side enum; core's actionToDecision consumes it).
    project-approval.ts       # PendingApprovalSnapshot → ApprovalCard projection. Switches on
                              # ApprovalRequestKind from core.classifyApprovalRequest. NO protocol
                              # method literals. Imports redact + truncate from core.
    plain-text.ts             # plain-text capability fallback (English by default; localization is adapter scope)
    truncate.ts               # pure utility; ≤64 byte truncation marker
    index.ts
  test/
    rich-block.test.ts
    project-approval-command-execution.test.ts
    project-approval-file-change.test.ts
    project-approval-permissions.test.ts
    project-approval-tool-user-input.test.ts
    project-approval-tool-call.test.ts
    project-approval-mcp-elicitation.test.ts
    project-approval-legacy.test.ts
    project-approval-unknown-defensive.test.ts
    project-approval-redact-applied.test.ts   # gstack T-G1: every text field of every kind redacted
    plain-text-capability-matrix.test.ts
    truncate.test.ts
    no-protocol-import.test.ts                # boundary test: render imports no AppServerClient/JsonRpcRequest
  package.json                                 # deps: @codex-im/core (type-only), @codex-im/protocol (type-only)
  tsconfig.json

packages/channel-core/
  src/
    types.ts                  # Target, Sender, MessageRef, OutboundFile, InboundMessage, InboundAction.
                              # InboundAction includes uiAction (ApprovalUiAction), callbackNonce, target.
    capabilities.ts           # ChannelCapabilities + requireCapability helper
    adapter.ts                # ChannelAdapter interface (closed; D14)
    fake.ts                   # TelegramShapeFakeChannelAdapter (renamed per Codex P2)
    index.ts
  test/
    types.test.ts
    capabilities.test.ts
    fake-adapter-roundtrip.test.ts
    fake-adapter-callback-bounds.test.ts       # 62-byte callback_data limit; max-length approvalId fits
    fake-adapter-callback-deadline.test.ts     # 60s answer-callback-query absolute deadline
    no-broker-import.test.ts                   # boundary test: channel-core does NOT runtime-depend on @codex-im/core
    no-protocol-import.test.ts                 # boundary test: channel-core imports no AppServerClient
  package.json                                 # deps: @codex-im/render (type-only). NO runtime dep on @codex-im/core.
  tsconfig.json

packages/im-telegram/                          # CONDITIONAL — only if D17 changes to Option B (default: NOT shipped).
  ...
```

### 2.3 Workspace / root

```
package.json                                  # version → 0.1.0-phase2-draft → 0.1.0-phase2 at tag
README.md                                     # package count update (7 → 9 default; 7 → 10 if Option B);
                                              # test count refresh; Phase 2 quickstart;
                                              # explicit "production = Supervisor; runtime-send = dev only" line
TODOS.md                                       # P2.x items moved to Done; Phase 3 backlog appended
docs/handoffs/2026-05-XX-phase2-to-phase3.md  # NEW
docs/handoffs/phase2-live-status.md           # NEW: Phase 2 live status (mirrors phase1-live-status format)
docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md  # THIS DOC (revised v2)
docs/phase-2/                                  # NEW: Codex outside-voice review reports per task
09-ROADMAP.md                                  # Phase 2 sub-section snapshot at tag
CLAUDE.md                                      # MODIFIED at T22: "Method literal policy" extended to
                                              # cover render/, channel-core/, approval-request-kind.ts,
                                              # the new boundary. decision-mapper.ts is NOT a method-literal home.
```

### 2.4 Files explicitly NOT touched in Phase 2

- `packages/codex-runtime/src/runtime.ts` — Phase 1 contract.
- `packages/codex-runtime/src/event-normalizer.ts` — Phase 1 contract.
- `packages/app-server-client/src/client.ts` — Phase 0 contract; ONE-SHOT lifecycle locked.
- `packages/codex-protocol/src/index.ts` (facade) — Pre-2 already covers Phase 2.
- `packages/codex-protocol/src/generated/**` and `schema/**` — generated.
- `packages/core/src/approval-broker.ts` lines 154–220 (PendingEntry creation + settleOnce body) — **byte-for-byte unchanged**.
- `scripts/canonicalize-schema.mjs`, `scripts/check-codex-version.mjs`, `scripts/verify-phase1-fixtures.mts`, `scripts/ci-check.sh` — gate scripts.

---

## 3. Module Boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│ IM platform (Telegram, Lark, …) — out of scope except D17 Opt B  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ raw platform events
┌────────────────────────▼─────────────────────────────────────────┐
│ ChannelAdapter (channel-core / im-telegram)                       │
│   onMessage / onAction / sendCard / editText / answerAction       │
│   Translates platform events ↔ InboundMessage / InboundAction.    │
│   InboundAction carries: { approvalId, uiAction (ApprovalUiAction),│
│                             target, sender, callbackNonce }      │
│   ZERO knowledge of broker / AppServerClient / protocol methods. │
└────────────────────────┬─────────────────────────────────────────┘
                         │ InboundAction
┌────────────────────────▼─────────────────────────────────────────┐
│ Daemon wire-up (Phase 3 will own this fully; Phase 2 stubs minimum)│
│   subscribes broker.onPendingCreated → projects card → adapter.sendCard│
│   subscribes adapter.onAction → broker.resolve(...)              │
│   calls broker.bindActorPolicy(approvalId, {allowedActors,target,nonce})│
└────────────────────────┬─────────────────────────────────────────┘
                         │ ResolveApprovalInput (decision = actionToDecision(uiAction))
┌────────────────────────▼─────────────────────────────────────────┐
│ Core (core)                                                        │
│   classifyApprovalRequest(method) → ApprovalRequestKind            │
│   ApprovalBroker.resolve / listPending / getPending / bindActorPolicy│
│   actionToDecision / mapDecisionForPending(record, uiAction)        │
│   AuditEmitter.emit(event) — applies redact before structured-log + ring│
│     (logger sink is duck-typed AuditLogger; core has NO pino runtime dep)│
│   #settleEntry(entry, outcome, audit) — calls settleOnce; emits   │
│   onPendingCreated / onPendingResolved (at #settleEntry boundary) │
└────────────────────────┬─────────────────────────────────────────┘
                         │ PendingApprovalSnapshot (for renderer)
┌────────────────────────▼─────────────────────────────────────────┐
│ Renderer (render)                                                  │
│   project(snapshot, kind) → ApprovalCard (per-kind, redact+truncate)│
│   plainTextFallback(card, capabilities)                           │
│   redact / truncate (re-exported from core)                        │
│   ZERO protocol method literals. Switches on ApprovalRequestKind. │
└────────────────────────┬─────────────────────────────────────────┘
                         │ ApprovalCard / RichBlock
┌────────────────────────▼─────────────────────────────────────────┐
│ Phase 1 kernel (core/codex-runtime/daemon/app-server-client)      │
│   ApprovalBroker (B-clean settleOnce UNCHANGED) │ CodexRuntime    │
│   Supervisor (#spawnFresh head: assert broker.isAttached()) │ Client│
└──────────────────────────────────────────────────────────────────┘
```

**Boundary invariants** (each enforced by build-time grep guard or type guard or test):

0. **`@codex-im/core` is logger-implementation-agnostic** (round-2 deep-review P2-7b / approved T3 decision). The audit emitter takes a duck-typed `AuditLogger` (`info(payload: object): void`); `pino.Logger` naturally satisfies it; daemon wire-up passes a real pino logger. Core's `package.json` has NO runtime dep on pino — same architectural posture as F13's "channel-core has no @codex-im/core runtime dep". This boundary is preserved by NOT adding pino to core's deps; verified by `grep "pino"` returning empty in `packages/core/package.json`.

1. `ChannelAdapter` MUST NOT runtime-import from `@codex-im/codex-runtime`, `@codex-im/app-server-client`, or `@codex-im/core`. Test: `packages/channel-core/test/no-broker-import.test.ts` + `no-protocol-import.test.ts` grep guards.
2. `Renderer` MUST NOT import `AppServerClient`, `JsonRpcRequest`, `JsonRpcNotification`. It consumes only `PendingApprovalSnapshot`, `ApprovalRequestKind`, redact/truncate from core. Test: `packages/render/test/no-protocol-import.test.ts`.
3. **`@codex-im/render/src/project-approval.ts` MUST NOT contain any of the 9 ServerRequest method strings.** It consumes `ApprovalRequestKind` from core. Enforced by P2.9 grep guard scope extension.
4. Method-literal boundary (extended scope per F1 + P2.9):
   - **Existing approved homes:** `packages/codex-runtime/src/runtime.ts` `REQUEST_METHODS`, `packages/core/src/approval-broker.ts` `DispatchTable`.
   - **New approved home (Phase 2):** `packages/core/src/approval-request-kind.ts` ONLY (the classifier — needs the 9 strings to map method → kind). `decision-mapper.ts` is NOT an approved home: it switches on `ApprovalRequestKind` and MUST be method-string-free. The grep guard's exemption list contains `approval-request-kind.ts` only; if an implementation finds it needs to add a method literal anywhere else (including the mapper), that's a plan amendment requiring fresh review — not a quiet code change.
   - **Disallowed:** `packages/render/src/**`, `packages/channel-core/src/**`, `packages/im-telegram/src/**` (if shipped), and all of `packages/{app-server-client,codex-runtime,daemon,cli}/src/**` (unchanged from Phase 1).
   - Grep guard scope is updated by T16; tests verify each new package directory is clean.
5. Raw `client.request("...")` boundary: existing T8 grep guard (`packages/codex-runtime/test/no-raw-client-request.test.ts`) extended in scope by T16.

**Trust boundaries:**

- IM platform → ChannelAdapter: untrusted input. Adapter validates payload shape, drops malformed events.
- ChannelAdapter → Daemon wire-up: typed `InboundAction`; actor identity is platform-asserted (Phase 2 trusts platform-asserted user_id; Phase 3 SecurityPolicy can re-validate at the wire-up boundary).
- Daemon wire-up → Core: `ResolveApprovalInput` carries actor + target + callbackNonce. Core's `bindActorPolicy` + `resolve` are the trust boundary; mismatches fail closed.
- Core → Wire: `#settleEntry` → `settleOnce` (UNCHANGED) → `#handle` await chain → AppServerClient.respond. Single wire frame guaranteed by B-clean.

---

## 4. Task Order & Dependencies

The fix arc reorders tasks per user directive (smaller granularity, TDD-first, classifier before broker surface, broker surface before renderer, all of core before render+channel-core, etc.).

### Dependency graph

```
T1   Protocol evidence inspection (DONE during fix arc; documented in plan header; no commit needed)
T2   approval-request-kind.ts (NEW core file): ApprovalRequestKind + classifyApprovalRequest + tests
T3   audit.ts (skeleton): AuditEvent kinds + AuditEmitter + ring + _auditRingForTest + tests
T4   redact.ts (relocated to core; expanded patterns) + tests
T5   audit.ts (wired): emit applies redact; tests with redacted fixtures
T6   ApprovalRecord.expiresAt + types extension (PendingApprovalSnapshot, ResolveApprovalInput,
     ResolveApprovalResult, ResolveError 9 kinds, ActorPolicy, BindResult)
T7   broker.#pendingById secondary index + listPending + getPending + onPendingCreated/Resolved emitters
     wired at NEW private #settleEntry helper. settleOnce body UNCHANGED.
T8   broker.enablePendingMode<M> + #handle pending-mode arm. Pending-mode bootstrap tests prove
     server-request → PendingEntry without default-reject (Codex missing #2)
T9   broker.bindActorPolicy + ActorPolicy validation in resolve (D19) — wrong actor / wrong target
     / stale callback / binding_required branches. Tests: wrong actor BEFORE first decision (Codex missing #5)
T10  decision-mapper.ts: mapDecisionForPending per-kind table + _v2_* shape tests.
     action-to-decision.ts: pure translator + tests.
     (round-2 deep-review P1-5: moved BEFORE resolve so T11 can call mapDecisionForPending
     without forward-references; resolve's wire path materializes here first.)
T11  broker.resolve happy path + expiry-in-resolve (D20) + 9 ResolveError branches + tests.
     resolve uses INTERNAL #pendingById lookup, NOT public getPending (Codex P0-3 / missing #3, #4).
     Includes expiry-without-sweeper test. Calls mapDecisionForPending (now in T10) +
     actionToDecision (now in T10). Hosts all D19 actor-validation tests originally in T9.
     (round-2 deep-review P1-5: was T10 in plan v2.2; renumbered/reordered.)
T12  Broker fake e2e happy path (proves T2–T11 wired correctly). Uses FakeAppServer + InMemoryTransport.
T13  render package skeleton + tsconfig + biome
T14  render/rich-block.ts + render/approval-card.ts + ApprovalUiAction types
T15  render/truncate.ts (TDD) + render/redact.ts re-export from core
T16  render/project-approval.ts: switches on ApprovalRequestKind. Per-kind tests (9 known kinds + unknown
     defensive). Redact-applied-to-every-text-field test (gstack T-G1 / Codex missing #7).
     RichBlock projection tests (Codex missing #8).
T17  render/plain-text.ts + capability matrix tests
T18  channel-core skeleton + types + capabilities helper + tests. NO @codex-im/core runtime dep
     (Codex P1-6 / F13).
T19  channel-core/adapter.ts (closed interface; D14) + TelegramShapeFakeChannelAdapter.
     Telegram constraints cited: callback_data ≤ 62 bytes, callback_query deadline, parse_mode
     unsupported in fake. (Codex P2 + gstack A7.)
T20  Method-literal grep guard scope extension (gstack A3 / F-codex-missing-1):
     - packages/core/test/no-method-literals.test.ts → cover render/src, channel-core/src,
       im-telegram/src (if shipped).
     - packages/codex-runtime/test/no-raw-client-request.test.ts → same scope extension.
     - Add exemption for packages/core/src/approval-request-kind.ts (the classifier).
T21  P2.10 full fake e2e flow — all 9 paths PLUS all Codex missing-tests:
     - allow_once happy / decline / abort / duplicate / wrong actor (BEFORE first decision)
     - expired-without-sweeper / transport-lost / reattach + stale / unknown method (broker)
     - audit-emit-before-wire-response (gstack T-G2)
     - secondary-index drift / max-length callback_data fits 62 bytes (gstack T-G3 / Codex missing #6)
T22  Supervisor end-to-end pre-attached-broker test (D16 / F-A8) +
     #spawnFresh runtime invariant assertion (broker.isAttached())
T23  Phase 2 close-out documentation (handoff, README, TODOS, CLAUDE.md "Method literal policy" section,
     09-ROADMAP, package.json version bump)
T24  Tag gate — Codex outside-voice integrated review on phase-1-runtime-complete..HEAD
```

### Parallelization windows

- **Window A** (after T12): T13–T17 (render) ∥ T18–T19 (channel-core). They have no shared files. T20 depends on both directories existing.
- **Window B** (after T21): T22 (Supervisor integration) is independent of T21; can run in parallel.
- **Serial spine**: T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → [Window A] → T20 → T21 → [Window B merge with T22] → T23 → T24.

### Lead session vs subagent assignment

| Task | Lead vs subagent | Outside voice |
|---|---|---|
| T2 classifier | Subagent (pure types + table) | Inline |
| T3 audit skeleton | Subagent | Inline |
| T4 redact patterns | Subagent (TDD per pattern) | Inline |
| T5 audit-redact wiring | Subagent | Inline |
| T6 types extension | **Lead session** — types load-bearing for T7–T11 | Codex review on the types alone |
| T7 emitters + secondary index + #settleEntry | **Lead session** — modifies B-clean preservation surface | **Codex review** before T8 |
| T8 enablePendingMode | **Lead session** — modifies dispatch lifecycle | **Codex review** |
| T9 bindActorPolicy | **Lead session** — security-critical | **Codex review** |
| T10 mappers (decision-mapper + action-to-decision) | Subagent (per-kind table) | Inline (round-2 deep-review P1-5: moved before resolve) |
| T11 resolve | **Lead session** — centerpiece | **Codex review with adversarial mode** after T10 mapper lands |
| T12 fake e2e happy | Subagent | Inline |
| T13–T17 render | Subagent per task | Codex review after T17 |
| T18–T19 channel-core | Subagent per task | Codex review after T19 |
| T20 grep guard | Subagent | Inline |
| T21 full e2e | **Lead session** — cross-cutting | Codex review |
| T22 Supervisor integration | Subagent | Inline |
| T23 docs | Lead session | Optional Codex review |
| T24 tag gate | Lead session | **Mandatory Codex outside-voice integrated review** |

---

## 5. Tasks

> Notation: TDD-first. Every task: failing test → run → expect FAIL → minimal impl → run → expect PASS → commit. Tasks are 2–5 minutes each; bigger surfaces are split into multiple Tn.x subtasks.

### Task T1 — Protocol evidence inspection (already complete; documented)

**Files:** None to commit. Evidence captured in plan v2 header table from these reads:

```
packages/codex-protocol/src/generated/v2/CommandExecutionApprovalDecision.ts
packages/codex-protocol/src/generated/v2/FileChangeApprovalDecision.ts
packages/codex-protocol/src/generated/v2/PermissionsRequestApprovalResponse.ts
packages/codex-protocol/src/generated/v2/ToolRequestUserInputResponse.ts
packages/codex-protocol/src/generated/v2/DynamicToolCallResponse.ts
packages/codex-protocol/src/generated/v2/McpServerElicitationAction.ts
packages/codex-protocol/src/generated/v2/McpServerElicitationRequestResponse.ts
packages/codex-protocol/src/generated/ApplyPatchApprovalResponse.ts
packages/codex-protocol/src/generated/ExecCommandApprovalResponse.ts
packages/codex-protocol/src/generated/ReviewDecision.ts
packages/codex-protocol/src/generated/v2/ChatgptAuthTokensRefreshResponse.ts
packages/codex-protocol/src/generated/v2/PermissionGrantScope.ts
```

- [x] **Step 1**: Already done (plan v2 header table is the artifact).

### Task T2 — `approval-request-kind.ts` classifier in core

**Files:**
- Create: `packages/core/src/approval-request-kind.ts`
- Create: `packages/core/test/approval-request-kind.test.ts`
- Modify: `packages/core/src/index.ts` (export `classifyApprovalRequest` + `ApprovalRequestKind`; round-2 deep-review P1-1 — T2 actually exported through index.ts so the file list is corrected here to match implementation)

- [ ] **T2.1 Write failing test** — assert `classifyApprovalRequest("item/commandExecution/requestApproval")` → `"command_execution"`. One assertion per row of this table:

| Method | Expected `ApprovalRequestKind` |
|---|---|
| `item/commandExecution/requestApproval` | `command_execution` |
| `item/fileChange/requestApproval` | `file_change` |
| `item/permissions/requestApproval` | `permissions` |
| `item/tool/requestUserInput` | `tool_user_input` |
| `item/tool/call` | `tool_call` |
| `mcpServer/elicitation/request` | `mcp_elicitation` |
| `applyPatchApproval` | `legacy_apply_patch` |
| `execCommandApproval` | `legacy_exec_command` |
| `account/chatgptAuthTokens/refresh` | `auth_token_refresh` |
| `future/unseen/method` | `unknown` |

- [ ] **T2.2 Run** test. FAIL — module not found.

- [ ] **T2.3 Implement** `approval-request-kind.ts`:

```ts
export type ApprovalRequestKind =
  | "command_execution"
  | "file_change"
  | "permissions"
  | "tool_user_input"
  | "tool_call"
  | "mcp_elicitation"
  | "legacy_apply_patch"
  | "legacy_exec_command"
  | "auth_token_refresh"
  | "unknown";

const METHOD_TO_KIND = {
  "item/commandExecution/requestApproval": "command_execution",
  "item/fileChange/requestApproval": "file_change",
  "item/permissions/requestApproval": "permissions",
  "item/tool/requestUserInput": "tool_user_input",
  "item/tool/call": "tool_call",
  "mcpServer/elicitation/request": "mcp_elicitation",
  applyPatchApproval: "legacy_apply_patch",
  execCommandApproval: "legacy_exec_command",
  "account/chatgptAuthTokens/refresh": "auth_token_refresh",
} as const satisfies Record<ServerRequest["method"], Exclude<ApprovalRequestKind, "unknown">>;
// Tighter than v1's `Record<string, ...>` (round-2 deep-review P1-2): using
// `ServerRequest["method"]` as the key constraint adds a load-bearing
// compile-time guard — codex 0.126+ adding a 10th ServerRequest variant
// fails this file to compile, mirroring the Phase 1 _ExhaustiveDispatch
// check on approval-broker.ts.

export function classifyApprovalRequest(method: string): ApprovalRequestKind {
  return Object.hasOwn(METHOD_TO_KIND, method)
    ? METHOD_TO_KIND[method as keyof typeof METHOD_TO_KIND]
    : "unknown";
}
```

- [ ] **T2.4 Run** test + `pnpm typecheck`. PASS.

- [ ] **T2.5 Commit** `feat(core): T2 ApprovalRequestKind classifier (D18 / F1 / Codex P0-1)`.

### Task T3 — `audit.ts` skeleton

**Files:**
- Create: `packages/core/src/audit.ts`
- Test: `packages/core/test/audit.test.ts`

- [ ] **T3.1** Write failing test asserting `AuditEventKind` is a discriminated union of the **12** strings from D13. Also assert: constructor with `{ringSize: 100_001}` throws; `{ringSize: 100_000}` succeeds; default (no `ringSize`) is 1000.
- [ ] **T3.2** Run, FAIL.
- [ ] **T3.3** Implement `AuditEventKind` + `AuditEvent` + `AuditEmitter` skeleton (no redact yet — that's T5). Default ring 1000; `emit(event)` pushes + pino logs; `recent({limit, kind?})` returns FIFO; `_auditRingForTest()` exposes raw ring (defensive copy).
- [ ] **T3.4** Run + `pnpm test`. PASS.
- [ ] **T3.5** Commit `feat(core): T3 AuditEmitter skeleton + 12 event kinds + ring hard MAX 100_000 (D13)`.

### Task T4 — `redact.ts` relocated to core; expanded patterns

**Files:**
- Create: `packages/core/src/redact.ts`
- Test: `packages/core/test/redact.test.ts`

- [ ] **T4.1** Write failing tests for these patterns (one assertion per pattern; per Codex Q5 expanded coverage):
  - Telegram bot tokens (`\d{8,10}:[A-Za-z0-9_-]{35}`) → `***REDACTED:telegram-token***`.
  - GitHub tokens (`ghp_*`, `gho_*`, `ghs_*`, `github_pat_*`).
  - Slack tokens (`xoxb-*`, `xoxp-*`, `xoxa-*`).
  - OpenAI/Anthropic tokens (`sk-*`, `sk-ant-*`).
  - Generic bearer (`Authorization: Bearer ...` and `Authorization: Token ...`).
  - Absolute paths under `/Users/...` → `/Users/<redacted>/<path-tail>`.
  - SSH private key blocks (`-----BEGIN ... PRIVATE KEY-----` through `-----END ...-----`) → entirely elided.
  - PEM/TLS certs (`-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----`) → elided.
  - Cloud keys (AWS `AKIA*`, GCP `AIza*`, Azure connection strings).
  - Env-var-style assignments (`API_KEY=...`, `SECRET=...`, `TOKEN=...` with values longer than 16 chars) → value redacted.
  - Contextual long base64 blobs (≥40 char base64 in suspicious context like `key=`, `cert=`, `secret=`).
  - Benign code (`pnpm test`, `git status`) is unaffected.
- [ ] **T4.2** Run, FAIL.
- [ ] **T4.3** Implement `redact(text: string): string` using pre-compiled regex array; single pass.
- [ ] **T4.4** Run. PASS.
- [ ] **T4.5** Commit `feat(core): T4 redact relocated from render; expanded patterns (F10 / Codex Q5)`.

### Task T5 — Audit emit applies redact

**Files:**
- Modify: `packages/core/src/audit.ts`
- Test: `packages/core/test/audit-redaction.test.ts`

- [ ] **T5.1** Write failing test: emit an event with `metadata = { command: "echo $TELEGRAM_BOT_TOKEN; pnpm publish" }`; assert `_auditRingForTest()[0].metadata.command` has the env-style assignment redacted.
- [ ] **T5.2** Run, FAIL.
- [ ] **T5.3** Implement: in `AuditEmitter.emit`, deep-walk `event.metadata` (and any string field at the event root) through `redact()` BEFORE storing in ring AND emitting to pino. Keep stringification minimal.
- [ ] **T5.4** Run. PASS.
- [ ] **T5.5** Commit `feat(core): T5 audit emit applies redact (P1 fix F10 / Codex P1-3)`.

### Task T6 — Phase 2 type extensions in `core/src/types.ts`

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/test/types-resolve.test.ts`

- [ ] **T6.1** Write failing type-only test asserting (a) `PendingApprovalSnapshot` shape (incl. `expiresAt`), (b) `ResolveApprovalInput` requires `target` + `callbackNonce` (D19), (c) `ResolveError` has **9 kinds**: `unknown_approval_id`, `already_resolved`, `expired`, `transport_lost`, `wrong_actor`, `wrong_target`, `stale_callback`, `binding_required`, `unsupported_decision`, (d) `ActorPolicy` shape, (e) `ApprovalRecord` extended with `expiresAt: Date`.
- [ ] **T6.2** Run `pnpm typecheck:tests`, FAIL.
- [ ] **T6.3** Implement type additions per D11/D12/D19/D20. Update `index.ts` exports.
- [ ] **T6.4** Run + `pnpm test`. PASS (existing 320 still pass).
- [ ] **T6.5** Commit `feat(core): T6 Phase 2 resolve/binding/snapshot types (D11/D12/D19/D20)`.

### Task T7 — Broker `#pendingById` + emitters + `#settleEntry` helper

**Files:**
- Modify: `packages/core/src/approval-broker.ts` (additions only; settleOnce body unchanged)
- Test: `packages/core/test/approval-broker-secondary-index.test.ts`, `approval-broker-events.test.ts`, `approval-broker-settle-entry.test.ts`, `approval-broker-listpending.test.ts`

- [ ] **T7.1 Subtask (TDD per add):** for each of (`#pendingById`, `listPending`, `getPending`, `onPendingCreated`, `onPendingResolved`, `#settleEntry`, `isAttached`), write a focused failing test, run, implement minimal addition, run, verify. Commit one subtask at a time.
- [ ] **T7.2 Critical assertion (Codex P0-6 + round-2 T3):** test asserts the Phase 2 working-tree `entry.settleOnce` and `createPendingEntry` source bodies are byte-for-byte identical to the Phase 1 tag's. **Mechanism:** `git show phase-1-runtime-complete:packages/core/src/approval-broker.ts` → extract the `settleOnce(outcome) { ... }` and `function createPendingEntry(...) { ... }` source ranges via marker-based regex (e.g. lines between `// === BEGIN B-CLEAN settleOnce ===` and `// === END B-CLEAN settleOnce ===` markers added in T7.1). Compare against the same marker-bounded extraction from the working-tree file. **Do NOT** use `Function.prototype.toString()` (V8 / transpilation / formatter dependent) and do NOT use a hash of the whole file (changes to surrounding code would falsely fail). The check uses the immutable Phase 1 tag SHA `23cbca7` as ground truth.
- [ ] **T7.3 Late-settle audit visibility test:** simulate handler resolves AFTER expirePending settles; assert `won: false` audit event with `kind: "approval.duplicate_attempt", outcome: "lost-race"`; no second wire frame.
- [ ] **T7.4 Phase 1 regression guard:** all existing T9b duplicate-response tests stay green.
- [ ] **T7.5 Codex outside-voice review** on the diff (T7.1–T7.4 commits). Apply P0/P1 inline if any.
- [ ] **T7.6 Commit chain** with subject `feat(core): T7.x ...` per subtask.

### Task T8 — `enablePendingMode<M>` + `#handle` pending-mode arm

**Files:**
- Modify: `packages/core/src/approval-broker.ts`
- Test: `packages/core/test/approval-broker-pending-mode.test.ts`

- [ ] **T8.1** Write failing test: `broker.enablePendingMode("item/fileChange/requestApproval")`, then `fakeServer.emitServerRequest(...)`. Assert: (a) PendingEntry is created, (b) `listPending()` shows one item, (c) NO default-reject wire response is sent before user decision, (d) `audit.emit("approval.created")` fired once.
- [ ] **T8.2** Run, FAIL — current broker default-rejects.
- [ ] **T8.3** Implement: extend `DispatcherSpec` with `mode`; default constructor sets `mode: "default-reject"`. Add `enablePendingMode` / `disablePendingMode`. In `#handle`, branch on mode (per D18 code block above). PendingEntry creation + `#pendingById` insert + `onPendingCreated` emit happen for both `handler` and `pending` modes. `#handle` finally block deletes from BOTH maps when status === "pending" (handler-mode happy path).
- [ ] **T8.4** Run + Phase 1 regressions stay green.
- [ ] **T8.5** Codex outside-voice review.
- [ ] **T8.6** Commit `feat(core): T8 enablePendingMode + #handle pending-mode arm (D18 / F1+F2)`.

### Task T9 — `bindActorPolicy` + actor binding validation in resolve

**Files:**
- Modify: `packages/core/src/approval-broker.ts`
- Test: `packages/core/test/approval-broker-actor-binding.test.ts`

**Scope split (round-2 deep-review P1-5):** T9 ships `bindActorPolicy` storage and idempotency only. The D19 validation tests that invoke `resolve()` (wrong actor / wrong target / stale callback / binding_required / happy-path-bind-then-resolve) are deferred to **T11.x** (renumbered: was T10) — `resolve()` doesn't exist yet at T9 time, so testing through it would force a forward-reference. T9 implementation still includes the `bindActorPolicy()` method on the broker AND the internal stored-policy state; T11 wires `resolve()` to consume that stored state.

- [ ] **T9.1** Write failing tests covering D19 binding-storage invariants (no `resolve()` calls):
  - `bindActorPolicy(approvalId, policy)` returns `{kind: "ok"}` on first call.
  - `bindActorPolicy` twice with identical policy → second returns `{kind: "ok"}` (idempotent).
  - `bindActorPolicy` twice with different policy → second returns `{kind: "error", error: BindError}`.
  - `bindActorPolicy` before pending exists → returns `{kind: "error", error: ...}` (no orphan bindings).
  - Internal accessor (test-only — mirrors `_pendingRecordsForTest` pattern) `_actorPolicyForTest(approvalId)` returns the stored policy after a successful bind.
  - Stored policy includes `allowedActors`, `target`, `callbackNonce` verbatim.
- [ ] **T9.2** Run, FAIL.
- [ ] **T9.3** Implement `bindActorPolicy(approvalId, policy)` storage + idempotency. The validation logic (`resolve()` consumes the stored policy and emits `wrong_actor`/`wrong_target`/`stale_callback`/`binding_required`) lands in T11; T9 only defines the storage surface and the validation FUNCTION SIGNATURES the broker will use internally.
- [ ] **T9.4** Run. PASS. Codex review.
- [ ] **T9.5** Commit `feat(core): T9 bindActorPolicy per-card binding storage (D19 / F4+F5 / Codex P0-5; resolve()-invoking validation tests deferred to T11 per round-2 P1-5)`.

### Task T10 — `decision-mapper.ts` + `action-to-decision.ts` (corrected D11)

> **Round-2 deep-review P1-5:** moved before T11 resolve so the wire-mapping function table exists before resolve() needs to call it. No forward-references at T11 implementation time.

**Files:**
- Create: `packages/core/src/decision-mapper.ts`, `packages/core/src/action-to-decision.ts`
- Test: `packages/core/test/decision-mapper.test.ts`, `decision-mapper-shapes.test.ts`, `action-to-decision.test.ts`

- [ ] **T10.1** Write failing tests for decision-mapper per the D11 table — one row per kind × supported uiAction. Use REAL generated types: assert `mapDecisionForPending(record_with_command_kind, {kind:"allow_once"})` returns `{kind:"ok", value: {decision:"accept"}}`. Use `_v2_*` type-only constants per generated wire shape (`_v2_cmd_accept: CommandExecutionRequestApprovalResponse = { decision: "accept" };`).
- [ ] **T10.2** Run. FAIL.
- [ ] **T10.3** Implement decision-mapper switching on `classifyApprovalRequest(record.method)` — kind-aware, returning `{kind: "ok", value}` / `{kind: "error", error: JsonRpcResponseError}` / `{kind: "unsupported", reason}`. Implement action-to-decision: pure `(uiAction) → ApprovalDecision` translator.
- [ ] **T10.4** Run + typecheck. PASS.
- [ ] **T10.5** Commit `feat(core): T10 decision-mapper per-kind (D11 corrected) + actionToDecision (F11; round-2 P1-5 reorder)`.

### Task T11 — `resolve()` happy + 9 error branches + expiry-in-resolve + actor validation

> **Round-2 deep-review P1-5:** was T10 in plan v2.2; renumbered/reordered so the decision mapper (now T10) materializes first. T11 also hosts the D19 actor-validation tests originally in T9 (split per Codex round-2 P1-5).

**Files:**
- Modify: `packages/core/src/approval-broker.ts` — replace throwing stub
- Test: `packages/core/test/approval-broker-resolve.test.ts`, `approval-broker-resolve-internal-lookup.test.ts`, `approval-broker-expiry-in-resolve.test.ts`, `approval-broker-actor-binding.test.ts` (the resolve-invoking validation tests; T9 already shipped binding-storage tests)

- [ ] **T11.1 TDD per ResolveError branch** — one subtask per branch (**9 branches + happy path = 10 subtasks**). Each has its own failing test + impl + commit. Each subtask asserts both fail-closed behavior AND the matching audit event kind (per D13's 12-kind enumeration).
- [ ] **T11.2 Internal lookup test (Codex P0-3 / missing #3):** assert resolve uses `#pendingById.get` directly, NOT `getPending`. Use a terminal-state record (status="expired"); resolve must return `expired`, not `unknown_approval_id`.
- [ ] **T11.3 Expiry-without-sweeper test (Codex P0-4 / missing #4):** create pending; advance fake clock past `expiresAt`; do NOT call `expirePending()`; call `resolve(allow_once, valid actor, valid target, valid nonce)`; expect `expired` error AND no accept wire response sent. Verify `audit.emit("approval.expired")` fires.
- [ ] **T11.4 Actor binding validation tests (round-2 P1-5: deferred from T9):** bind via `bindActorPolicy` (T9 surface), then call `resolve(...)` to assert `wrong_actor` (B clicks first; happy path; A still resolves), `wrong_target`, `stale_callback`, `binding_required` (resolve before bind), `already_resolved` (duplicate click). Each branch asserts: matching ResolveError kind + matching D13 audit event + pending state preservation when not settled.
- [ ] **T11.5 Codex adversarial review** with prompt: "find a way to produce duplicate wire response, bypass actor binding, bypass expiry, race resolve with expirePending."
- [ ] **T11.6 Commit chain** `feat(core): T11.x resolve <branch> (D11/D19/D20)`.

### Task T12 — Broker fake e2e happy path (proves T2–T11 wired)

**Files:**
- Test: `packages/core/test/approval-broker-fake-e2e-happy.test.ts`

- [ ] **T12.1** Write end-to-end test: FakeAppServer + AppServerClient + ApprovalBroker. Call `broker.attach()`; `enablePendingMode("item/commandExecution/requestApproval")`; emit server-request; assert pending; `bindActorPolicy(...)`; `resolve(allow_once, ...)`; assert wire response is `{decision:"accept"}`; assert audit log has `approval.created` then `approval.resolved`.
- [ ] **T12.2** Run. PASS (everything wired in T2–T11 should compose).
- [ ] **T12.3** Commit `test(core): T12 fake e2e happy path proves T2-T11 wired (P2.10 minimum)`.

### Task T13 — `@codex-im/render` package skeleton

**Files:**
- Create: `packages/render/package.json` (deps: `@codex-im/core` type-only, `@codex-im/protocol` type-only), `tsconfig.json`, `src/index.ts` placeholder.

- [ ] **T13.1** Skeleton + register in pnpm workspace.
- [ ] **T13.2** `pnpm typecheck` PASS.
- [ ] **T13.3** Commit `chore(render): T13 package skeleton`.

### Task T14 — `rich-block.ts` + `approval-card.ts` + `ApprovalUiAction`

**Files:**
- Create: `packages/render/src/rich-block.ts`, `packages/render/src/approval-card.ts`
- Test: `packages/render/test/rich-block.test.ts`

- [ ] **T14.1** Write failing test: `RichBlock` discriminated union with 3 variants (`text`, `approval`, `unknown`); `ApprovalCard` shape per D14 (incl. `target`, `actions`, `status`, `createdAt`); `ApprovalUiAction` 4-variant union.
- [ ] **T14.2** Run, FAIL.
- [ ] **T14.3** Implement types per D11 + D12 + this task. Plain-text labels are English defaults.
- [ ] **T14.4** Run + typecheck. PASS.
- [ ] **T14.5** Commit `feat(render): T14 RichBlock + ApprovalCard + ApprovalUiAction (F12)`.

### Task T15 — `truncate.ts` + redact re-export

**Files:**
- Create: `packages/render/src/truncate.ts`, `packages/render/src/redact.ts` (re-export from core)
- Test: `packages/render/test/truncate.test.ts`

- [ ] **T15.1** Write failing tests for truncate boundary cases (Phase 2 same as v1).
- [ ] **T15.2** Implement truncate. Re-export redact from `@codex-im/core/redact`.
- [ ] **T15.3** Run. PASS.
- [ ] **T15.4** Commit `feat(render): T15 truncate + redact re-export (F10)`.

### Task T16 — `project-approval.ts`: kind-based projection

**Files:**
- Create: `packages/render/src/project-approval.ts`
- Test: `packages/render/test/project-approval-{command-execution,file-change,permissions,tool-user-input,tool-call,mcp-elicitation,legacy,unknown-defensive,redact-applied}.test.ts`

- [ ] **T16.1 TDD per kind** — one test file + impl per `ApprovalRequestKind`. Each asserts:
  - Switch is on `kind`, NOT method (verify via grep guard test in T20).
  - Card actions only include UI actions whose mapper returns `{kind:"ok"}` (per D11 table). Concrete result per kind: `command_execution`/`file_change`/`legacy_apply_patch`/`legacy_exec_command` → all 4 actions; `permissions` → only `decline`; `tool_user_input`/`tool_call` → only `decline`; `mcp_elicitation` → `decline` and `abort` (`abort` maps to wire `"cancel"`); `auth_token_refresh` → no actions surfaced (broker default-rejects; renderer should never see this kind in pending mode); `unknown` → `decline` only (C-P1 alignment).
  - Redact applied to every text field.
  - Truncate applied where param values exceed limit.
  - Risk level per kind (per Phase 2 risk taxonomy in plan).
  - Card schema = `"approval-card.v1"`.
- [ ] **T16.2 Redact-applied test (gstack T-G1):** parameterized fixture with bot-token + abs-path in params for EACH kind; assert redacted in card output.
- [ ] **T16.3 RichBlock projection test (Codex missing #8 + C-P1 round-2 alignment):** `projectAsRichBlock(snapshot, kind)` returns `{type: "approval", card}` for ALL kinds, including `"unknown"`. For `"unknown"` kind, the card is a **decline-only ApprovalCard** with safe fallback text, risk level `"critical"`, action set `[{kind:"decline"}]` only (no allow_once / allow_session / abort). `RichBlock.unknown` variant exists for non-approval future use cases (e.g. unknown ServerNotification arms surfaced from EventNormalizer); it is NOT used for unknown approval requests in Phase 2. C-P1 alignment: §0.4 redline + T16.3 + T21 path 10 all converge on "decline-only ApprovalCard for unknown approval kinds."
- [ ] **T16.4** Run all + typecheck. PASS.
- [ ] **T16.5** Commit chain `feat(render): T16.x project <kind> approval (P2.7 / F1)`.

### Task T17 — `plain-text.ts` capability fallback

**Files:**
- Create: `packages/render/src/plain-text.ts`
- Test: `packages/render/test/plain-text-capability-matrix.test.ts`

- [ ] **T17.1** Write failing tests per capability combinations (`supportsButtons` × `canEditMessage`).
- [ ] **T17.2** Implement plain-text formatter (English defaults, per Codex Q1 / gstack Q1).
- [ ] **T17.3** Run. PASS.
- [ ] **T17.4** Commit `feat(render): T17 plain-text capability fallback (gstack Q1)`.

### Task T18 — `@codex-im/channel-core` skeleton + types + capabilities

**Files:**
- Create: `packages/channel-core/package.json` (NO `@codex-im/core` runtime dep; type-only `@codex-im/render`), `tsconfig.json`, `src/types.ts`, `src/capabilities.ts`
- Test: `packages/channel-core/test/types.test.ts`, `capabilities.test.ts`, `no-broker-import.test.ts`, `no-protocol-import.test.ts`

- [ ] **T18.1** Skeleton + package.json (no runtime dep on core; type-only render).
- [ ] **T18.2** TDD types + capabilities helper.
- [ ] **T18.3** Boundary grep guard tests: `no-broker-import.test.ts` + `no-protocol-import.test.ts`.
- [ ] **T18.4** Run + typecheck. PASS.
- [ ] **T18.5** Commit chain `feat(channel-core): T18.x package skeleton + types + boundary tests (F13)`.

### Task T19 — `ChannelAdapter` interface + `TelegramShapeFakeChannelAdapter`

**Files:**
- Create: `packages/channel-core/src/adapter.ts`, `packages/channel-core/src/fake.ts`
- Test: `packages/channel-core/test/fake-adapter-roundtrip.test.ts`, `fake-adapter-callback-bounds.test.ts`, `fake-adapter-callback-deadline.test.ts`

- [ ] **T19.1** Write failing tests asserting:
  - `ChannelAdapter` interface shape (closed; D14 escape clause documented in JSDoc).
  - `TelegramShapeFakeChannelAdapter`: `callback_data ≤ 62 bytes` (cite [Telegram Bot API §inlineKeyboardButton.callback_data](https://core.telegram.org/bots/api#inlinekeyboardbutton)); `callback_query` answer must be acked within 60s absolute (cite [Telegram Bot API §answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery)); `parse_mode` unsupported.
  - Round-trip: `injectMessage` / `injectAction` triggers handlers; `sendCard` / `updateCard` / `editText` / `answerAction` work.
  - `callback_data > 62 bytes` throws.
  - `editText` / `answerAction` after `stop()` rejects.
- [ ] **T19.2** Run, FAIL.
- [ ] **T19.3** Implement `ChannelAdapter` interface (with JSDoc citing D14) and the fake (with Telegram constraints simulated).
- [ ] **T19.4** Run. PASS.
- [ ] **T19.5** Commit `feat(channel-core): T19 ChannelAdapter (D14) + TelegramShapeFakeChannelAdapter (D17 / Codex P2)`.

### Task T20 — Method-literal grep guard scope extension

**Files:**
- Modify: `packages/core/test/no-method-literals.test.ts`, `packages/codex-runtime/test/no-raw-client-request.test.ts`

- [ ] **T20.1 Concrete glob + exclusion mechanism (R2 round-2):** the existing Phase 1 `no-method-literals.test.ts` uses `git grep -F` over a hard-coded path list. Phase 2 replaces this with an explicit allowlist:

```ts
// packages/core/test/no-method-literals.test.ts
import { execFileSync } from "node:child_process";

const SCANNED_DIRS = [
  "packages/app-server-client/src",
  "packages/codex-runtime/src",
  "packages/daemon/src",
  "packages/cli/src",
  "packages/render/src",
  "packages/channel-core/src",
  // packages/im-telegram/src — added when Option B is approved; absent dir is OK.
];

const ALLOWED_FILES_FOR_SERVER_REQUEST_LITERALS = new Set([
  // The ONLY Phase 2 approved home for ServerRequest method literals
  // outside packages/core/src/approval-broker.ts (Phase 1 DispatchTable).
  "packages/core/src/approval-request-kind.ts",
]);

// scan files
const files = execFileSync("git", ["ls-files", "--", ...SCANNED_DIRS, "packages/core/src"], { encoding: "utf-8" })
  .split("\n").filter(f => f.endsWith(".ts") && !f.includes("/test/"));

// for each forbidden ServerRequest method literal (the 9 generated names from T2's METHOD_TO_KIND)
for (const method of FORBIDDEN_METHOD_LITERALS) {
  for (const file of files) {
    if (ALLOWED_FILES_FOR_SERVER_REQUEST_LITERALS.has(file)) continue;
    if (file === "packages/core/src/approval-broker.ts") continue;   // Phase 1 DispatchTable home (unchanged)
    const content = readFileSync(file, "utf-8");
    expect(content, `${file} contains forbidden method literal "${method}"`).not.toContain(method);
  }
}
```

The same shape applies to `packages/codex-runtime/test/no-raw-client-request.test.ts` (ClientRequest method literals; allowed home is `packages/codex-runtime/src/runtime.ts`'s `REQUEST_METHODS` only — no Phase 2 additions to the allowlist).

**`decision-mapper.ts` is NOT in the allowlist** — Codex round-2 C1; the mapper switches on `ApprovalRequestKind`, not on raw method strings.

- [ ] **T20.2** Run grep tests. Expect all-clean over the new directories AND the existing Phase 1 ones. PASS.
- [ ] **T20.3** Verify `decision-mapper.ts` does NOT contain any of the 9 ServerRequest method literals (extra assertion: an explicit test that scans `decision-mapper.ts` separately and asserts zero method literals).
- [ ] **T20.4** Commit `test(core,codex-runtime): T20 method-literal grep guard scope extension (gstack A3 / F-codex-missing-1 / round-2 R2 + C1)`.

### Task T21 — Full fake e2e (P2.10): all paths + Codex missing-tests

**Files:**
- Test: `packages/core/test/phase2-e2e-approval-flow.test.ts` + `phase2-e2e-secondary-index.test.ts` + `phase2-e2e-callback-bounds.test.ts`

- [ ] **T21.1 Build the rig**: FakeAppServer + InMemoryTransport + AppServerClient + ApprovalBroker (with audit) + TelegramShapeFakeChannelAdapter + a tiny daemon-wireup function that subscribes to `broker.onPendingCreated` → projects via render → `adapter.sendCard` → captures MessageRef + nonce → calls `broker.bindActorPolicy(...)`. Subscribes to `adapter.onAction` → calls `broker.resolve(...)`.
**T21.2 paths split into per-path TDD subtasks (C3 round-2 fix). Each subtask: failing-first test → run-FAIL → minimal extension to test fixtures or daemon-wireup → run-PASS → commit.** Each path's fixture MUST contain a known-bad payload (Telegram bot token + `/Users/secret/proj` absolute path + a fake AWS-key-shaped string) so the audit-redaction-per-failure-branch assertion (R4 round-2) can fire on every path. Every test asserts: (a) the matching `ResolveError` kind / wire response / no-wire behavior, (b) the matching `AuditEvent.kind` from D13's 12 enumerated kinds, (c) every string field in the audit event has bad-payload occurrences replaced by `***REDACTED:*` markers per redact.ts.

- [ ] **T21.2.1 allow_once happy path:** server-request (params containing bad payload) → pending (`approval.created` audit, payload redacted) → card → user clicks allow → resolve(allow_once) → wire is v2 `{decision:"accept"}` → audit `approval.resolved` (payload still redacted) → adapter receives `answerAction({ok:true})`. Fixture: `command_execution` kind with `cwd: "/Users/secret/proj"`, `command: "echo $TELEGRAM_BOT_TOKEN"`, `reason: "ghp_actuallyabadtoken123…"`. Assertions: 2 audit events; both have redacted strings; one wire response. TDD-first: fail before T7+T8+T9+T10+T11+T16+T19 are wired.
- [ ] **T21.2.2 decline:** same fixture, user clicks decline → wire `{decision:"decline"}` → audit `approval.resolved` with decision=decline. Assert no `accept` ever sent.
- [ ] **T21.2.3 abort (file_change):** `file_change` kind → user clicks abort → wire `{decision:"cancel"}` → audit `approval.resolved`. Assert wire is exactly `{decision:"cancel"}`, NOT `{decision:"abort"}` (legacy ReviewDecision is for legacy methods only).
- [ ] **T21.2.4 abort (permissions, unsupported):** `permissions` kind → renderer surfaces decline-only (per T16.1 fixed mapping) → if test bypasses renderer and calls `resolve({decision:{kind:"abort"}})` directly, mapper returns `unsupported` → audit `approval.unsupported_decision` → resolve returns `unsupported_decision` error → no settle. Defense-in-depth assertion.
- [ ] **T21.2.5 duplicate click:** two `injectAction` for same approvalId. First wins (audit `approval.resolved`); second loses race in `#settleEntry` → audit `approval.duplicate_attempt` (per D21 alignment, NOT a second `approval.resolved`) → resolve returns `already_resolved` error. Adapter receives `answerAction({ok:false, userMessage:"Already resolved"})`.
- [ ] **T21.2.6 wrong actor (BEFORE first decision)** (Codex missing #5): bind actor A; B clicks first → resolve returns `wrong_actor` error → audit `approval.wrong_actor` (with `actor.userId` REDACTED if the userId looks like a token; otherwise raw userId is fine for audit) → pending stays `pending` (`listPending()` still shows it) → A then resolves successfully → audit `approval.resolved`.
- [ ] **T21.2.7 wrong target:** bind actor A in chat C1; A's resolve arrives with `target.chatId: "C2"` (different chat, e.g. forwarded message exploit attempt) → resolve returns `wrong_target` → audit `approval.wrong_target` → no settle.
- [ ] **T21.2.8 stale callback (nonce mismatch):** bind with nonce N1; resolve arrives with nonce N2 (e.g. card was edited and re-bound with new nonce) → resolve returns `stale_callback` → audit `approval.stale_callback`.
- [ ] **T21.2.9 binding_required (resolve before bind):** trigger pending; deliberately skip `bindActorPolicy`; resolve arrives → `binding_required` error → audit `approval.binding_required` → pending stays open.
- [ ] **T21.2.10 expired without sweeper** (Codex missing #4): bind; advance fake clock past `expiresAt`; do NOT call `expirePending()`; resolve(allow_once) → `expired` error → audit `approval.expired` (lazy-expire path through `#settleEntry` fires it once) → wire is the kind-specific defaultReject value, NOT `accept`.
- [ ] **T21.2.11 transport_lost while pending:** simulate `transport.onClose` → broker auto-fails pending via `failPendingAsTransportLost` → audit `approval.transport_lost` → attempt resolve → `transport_lost` error → audit `approval.duplicate_attempt` (the late resolve loses race).
- [ ] **T21.2.12 reattach + stale request:** simulate transport close (path 11) → supervisor reattach to new client (per Phase 1 D6 + D7) → old approvalId resolve returns `transport_lost` (entry retained in old generation's terminal state).
- [ ] **T21.2.13 unknown approval id:** resolve with a fabricated approvalId not in `#pendingById` → `unknown_approval_id` error → audit `approval.unknown_approval_id` → no settle.
- [ ] **T21.2.14 unknown method (broker level):** `fakeServer.emitServerRequest("future/unseen/method")` with bad-payload params → broker `#handle` throws `-32601` (Pre-3 path) → audit `approval.unsupported_method` (params redacted) → NO PendingEntry created → NO card sent → no `approval.created` event.
- [ ] **T21.2.15 unknown kind (renderer defensive)** (C-P1 round-2 alignment): hand-construct a `PendingApprovalSnapshot` whose method classifies to `"unknown"` (e.g. via mock); `projectAsRichBlock(snapshot, "unknown")` returns `{type:"approval", card}` where `card.actions = [{kind:"decline"}]`, `card.target.riskLevel === "critical"`, summary indicates default-decline. Adapter renders a card with one button. User clicks decline → resolve(decline) → mapper returns `{kind:"unsupported"}` for "unknown" kind on decline action — audit `approval.unsupported_decision` → resolve returns `unsupported_decision` error. **NO wire response is sent.** Adapter receives `answerAction({ok:false, userMessage:"Phase 2 cannot resolve unknown approval kinds; default-decline at protocol layer."})`. (Note: the broker's `#handle` already prevents this snapshot from existing in production; T21.2.15 tests the defensive renderer path.)
- [ ] **T21.3 Audit-emit-before-wire-response (gstack T-G2):** in the allow_once happy path, assert `audit.recent({limit:1})[0]` is set BEFORE `await pendingPromise` resolves.
- [ ] **T21.4 Secondary-index drift (Codex missing #6):** stress test: 100 concurrent server-requests + concurrent resolves + concurrent expirePending. Verify `#pending` and `#pendingById` stay consistent (matching key sets after every operation).
- [ ] **T21.5 Max-length callback_data fits (gstack T-G3):** synthetic pending with the longest plausible `appServerRequestId` (e.g. `Number.MAX_SAFE_INTEGER`); `approval-${id}` ≤ 62 bytes when used directly OR encoded by adapter codec.
- [ ] **T21.6 Codex outside-voice review** on the e2e test commit.
- [ ] **T21.7** Commit chain `test(phase2): T21.x full e2e <path> (P2.10 / Codex missing-tests)`.

### Task T22 — Supervisor end-to-end pre-attached-broker test (D16/F-A8)

**Files:**
- Modify: `packages/daemon/src/supervisor.ts` — add `broker.isAttached()` invariant assertion at `#spawnFresh` head
- Modify: `packages/core/src/approval-broker.ts` — add `isAttached()` getter
- Test: `packages/daemon/test/supervisor-end-to-end-pre-attached-broker.test.ts`, `pre-attached-contract-runtime-invariant.test.ts`

- [ ] **T22.1 Test 1 (positive):** Supervisor with pre-attached broker → `start()` succeeds → emit server-request mid-spawn-handshake → broker dispatches via pending-mode handler.
- [ ] **T22.2 Test 2 (negative invariant):** Supervisor constructed with a fresh non-attached broker → `start()` throws "Supervisor.#spawnFresh: broker MUST be pre-attached..." Note the exact error text emphasizes "production = Supervisor; runtime-send = dev/operator only" per Codex Q6.
- [ ] **T22.3 Test 3:** mid-pending transport.onClose → supervisor's close handler fires `failPendingAsTransportLost` exactly once → reattach to new gen → old approvalId resolve returns `transport_lost`.
- [ ] **T22.4 Test 4:** 5 consecutive transport closes → supervisor halts.
- [ ] **T22.5 Implementation:** add `broker.isAttached()` getter returning `#attached`. Add the runtime-invariant check at `#spawnFresh` head with the load-bearing error message.
- [ ] **T22.6** Run. PASS. Phase 1 supervisor tests stay green.
- [ ] **T22.7** Commit `test(daemon)+feat(core,daemon): T22 Supervisor pre-attached-broker invariant (D16 / F-A8 / Codex Q6)`.

### Task T23 — Phase 2 close-out documentation

**Files:**
- Create: `docs/handoffs/2026-05-XX-phase2-to-phase3.md`, `docs/handoffs/phase2-live-status.md`
- Modify: `09-ROADMAP.md`, `README.md`, `TODOS.md`, `package.json#version` (`0.1.0-phase2-draft` → `0.1.0-phase2`), `CLAUDE.md`

- [ ] **T23.1** Draft Phase 2 → Phase 3 handoff per Phase 1 handoff format (status, gate matrix, decision log carry-forward, redlines, recommended Phase 3 mission).
- [ ] **T23.2** README updates: package count (7 → 9 / 7 → 10 if Option B); test count refresh; Phase 2 quickstart line; **explicit "production = Supervisor; runtime-send = dev/operator only"** prominence.
- [ ] **T23.3** TODOS.md: move all completed P2.x to Done with commit refs; append Phase 3 backlog (SecurityPolicy ACL, SQLite migration, launchd, audit log SQLite migration, prune sweep for terminal records, structured secret detector, synthesized turn_failed events, Telegram MVP if not shipped in P2).
- [ ] **T23.4** CLAUDE.md "Method literal policy" section updated: add `packages/render/src/**`, `packages/channel-core/src/**` to disallow list; add `packages/core/src/approval-request-kind.ts` as new approved-home. Add Phase 2 redlines (no first-actor-wins, no expirePending-as-safety, no settleOnce mod, no `"approve"` wire decision, runtime-send/Supervisor split).
- [ ] **T23.5** All gates run. `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm protocol:check`, `bash scripts/ci-check.sh` all green at HEAD.
- [ ] **T23.6** Commit `docs(phase-2): T23 close-out — handoff + roadmap + readme + todos + claude-md`.

### Task T24 — Tag gate

- [ ] **T24.1 Run Codex outside-voice integrated review** on `phase-1-runtime-complete..HEAD`.
- [ ] **T24.2 If GO**: `git tag -a phase-2-approval-im-surface-complete -m "Phase 2 — Approval & IM Surface complete"`.
- [ ] **T24.3 If GO_WITH_LOW_NITS**: apply nits inline, recommit, then tag.
- [ ] **T24.4 If NO-GO**: reopen scope per the review report; do NOT tag.

---

## 6. Verification commands

Per-task verification documented per task. Plan-level gates (run after every task and before tag):

```bash
pnpm typecheck                                      # all packages strict
pnpm typecheck:tests                                 # type-only test assertions
pnpm test                                           # full unit + contract suite
pnpm test:cli-smoke                                  # CLI smoke (FakeAppServer-injected)
pnpm lint                                           # biome
pnpm protocol:check                                  # regen determinism
bash scripts/ci-check.sh                             # 8-gate matrix
pnpm exec tsx scripts/verify-phase1-fixtures.mts    # T4.5 fixture acceptance gate
```

Operator smokes (NOT in CI; env-gated):

```bash
CODEX_SMOKE=1 pnpm smoke:app-server                  # initialize-only, safe
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn              # real turn (~$0.01)
CODEX_REAL_SMOKE=1 pnpm runtime:send -- --prompt 'Reply OK'   # dev/operator only — production goes through Supervisor
```

---

## 7. Failure modes & rollback

| Failure | Detection | Rollback |
|---|---|---|
| T7.2 settleOnce body modified | T7.2 meta-test diff | Revert T7.2 commit; fix in fresh commit |
| T11 mapper produces wrong wire value | T11 `_v2_*` type-only assertion fails at compile | Re-inspect generated TS; mapper must match exactly |
| T21.6 reveals duplicate wire response | T21.4 secondary-index stress test | Bug in T7's #settleEntry or T8's #handle; revert affected commit, re-design |
| T21.6 wrong-actor-before-first-decision allows approval | T21 path 5 | Bug in T9's bindActorPolicy; revert, re-design |
| T22 invariant fires for legit production code | T22.1 / T22.2 | bug — broker should be attached by daemon wire-up; check ordering |
| Phase 1 test count regresses (was 320) | `pnpm test` output | Phase 2 only ADDS; deletion is a bug |
| Telegram constraints in fake diverge from real | gstack A7 cited-source check | Re-inspect Telegram Bot API; sync fake numbers + cited URLs |

**Rollback strategy:** Phase 1 tag is immutable. To roll back Phase 2 without losing prior work:

1. **Soft rollback (preferred):** Create a revert commit on `phase-2-approval-im-surface` that undoes the Phase 2 commits. Keeps history intact; future cherry-picks are possible.
2. **Branch-level rollback:** Open a fresh branch off `phase-1-runtime-complete` (`git switch -c phase-2-approval-im-surface-v3 phase-1-runtime-complete`), then cherry-pick the doc-only commits to keep. Avoid `git reset --hard` (Codex P2-3 — destructive history loss without backup).
3. **Pre-tag rollback:** Before T24, no tag exists. Either of the above works without affecting downstream consumers.
4. **Post-tag rollback:** Tags are not deleted; instead create a `phase-2-rollback` annotated tag pointing at `phase-1-runtime-complete` to mark the rolled-back state.

---

## 8. Worktree parallelization

Window A (after T12): T13–T17 (render) ∥ T18–T19 (channel-core).
Window B (after T21): T22 (Supervisor) is independent.

```bash
# Worktree 1 — render (T13–T17)
git worktree add ../codex-im-rich-client.render phase-2-approval-im-surface
cd ../codex-im-rich-client.render
git switch -c phase-2-render

# Worktree 2 — channel-core (T18–T19)
git worktree add ../codex-im-rich-client.channel-core phase-2-approval-im-surface
cd ../codex-im-rich-client.channel-core
git switch -c phase-2-channel-core

# Both branches merge into phase-2-approval-im-surface before T20 (grep guard scope) begins.
# Each worktree must run its own gate matrix before merge.
```

---

<!-- §9, §10, §10A preserved verbatim from plan v1 — DO NOT EDIT (review reports are historical record). -->

## 9. GSTACK REVIEW REPORT (gstack `/plan-eng-review` 2026-05-01)

**Date:** 2026-05-01
**Reviewer:** Claude Sonnet via gstack `/plan-eng-review` skill
**Plan:** `docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md`
**Mode:** consolidated review (auto mode)

**Verdict:** APPROVE_WITH_CHANGES — superseded by Codex outside-voice REJECT below; combined disposition is REJECT pending P0 fix arc.

### Step 0 — Scope challenge: scope accepted as-is (no reduction triggered)

### Architecture findings (8)

- **A1** [P1, 9/10] `stale_callback` ResolveError variant is unreachable. T7 step 3.1 returns `unknown_approval_id` for null `getPending()`, which already covers all terminal-status entries. Drop the variant or change `getPending()` filter behavior.
- **A2** [P1, 9/10] `resolve()` returns ok before wire response hits codex; correct decoupling but plan never says it. Add JSDoc + T19 ordering assertion.
- **A3** [P1, 9/10] Boundary grep guard scope extension asserted in §3 but no task implements it. Add T9.5 to extend `no-method-literals.test.ts` + `no-raw-client-request.test.ts` scope.
- **A4** [P1, 9/10] `redact.ts` lives in render but audit emit lives in core/audit.ts → secrets land in pino logs before redaction. **Move `redact.ts` to `@codex-im/core/redact.ts`.**
- **A5** [P1, 8/10] render's `project-approval.ts` switch contains 9 method literals → conflicts with A3 boundary. Pick: explicit grep-guard exemption for `project-approval.ts` inside `as const satisfies Record<keyof DispatchTable, ProjectorSpec>` pattern, OR have core export a typed PROJECTORS registry interface.
- **A6** [P1, 8/10] `ApprovalActionDecision` (channel-core: allow_once/...) ≠ `ApprovalDecision` (core: approved/...). T19 hand-waves the conversion. Add `actionToDecision()` utility in core.
- **A7** [P2, 8/10] D17 Option C "Telegram-shape" callback_data deadline + parse_mode claims unverified. T17 must cite Telegram Bot API source.
- **A8** [P2, 6/10] Supervisor pre-attached-broker contract remains JSDoc-only after T21. Add runtime invariant check at `#spawnFresh` head.

### Code quality findings (5)

- **Q1** [P2, 9/10] Plain-text fallback uses Chinese strings. Default to English; locale layer is adapter concern.
- **Q2** [P2, 9/10] CLAUDE.md "Method literal policy" is not updated by T22; new packages need explicit allow/disallow entries.
- **Q3** [P1, 7/10] Plan defers MapDecision per-method enumeration to T6 implementation time. Add T1.5 spike to grep generated v2 shapes and document the 9-method × 4-decision mapping in plan §1 D11 NOW.
- **Q4** [P3, 5/10] No test escape hatch for audit ring buffer. Add `_auditRingForTest()`.
- **Q5** [P3, 6/10] render → protocol type-only dependency. Acceptable; flagging.

### Test review

Coverage diagram produced. 35/38 paths covered (92%). 3 gaps:
- **T-G1** [P1] No test verifies `redact()` is APPLIED inside project-approval.ts for every text field of every method.
- **T-G2** [P1] No test asserting audit-emit happens before wire-response is delivered (or doesn't matter — but plan must specify).
- **T-G3** [P1] No test for "max-length approvalId callback_data fits in 62 bytes" (codec contract).

### Performance findings

None at P0/P1.

### Decisions verdict (gstack)

| Decision | Verdict |
|---|---|
| D11 MapDecision per-method | APPROVE (apply Q3 spike before T6) |
| D12 Read-only snapshot + emitters | APPROVE |
| D13 In-memory ring + pino | APPROVE (apply A4 fix) |
| D14 ChannelAdapter closed | APPROVE |
| D15 Stable id approval-${id} | APPROVE |
| D16 runtime-send + T21 | APPROVE (apply A8 fix) |
| D17 Telegram MVP | Option C |

### Open question answers (gstack)

- Q1 (D17): Option C
- Q2 (actor binding): "first actor wins" Phase 2; Phase 3 SecurityPolicy tightens. **NOTE:** codex outside-voice DISAGREES — see §10
- Q3 (audit ring 1000): accept default
- Q4 (MapDecision unsupported): throw `unsupported_method` -32601
- Q5 (redact coverage): tokens/paths/SSH keys for Phase 2; structured detector Phase 3 backlog
- Q6 (runtime-send/Supervisor split): D16 + handoff M3 + T21 + add CLAUDE.md note

### Worktree parallelization

6 lanes: Serial S (T1–T8) → A∥B (T9–T13 ∥ T14–T18) → C (T19) → D∥E (T20 ∥ T21) → F (T22–T23). Lane C must rebase on S.

### Failure modes — 1 critical gap flagged

Redact pattern miss has no error handling; T-G1 closes it for known patterns. Add Phase 3 backlog item: structured secret detector (defense in depth).

### Completion summary

- Step 0: scope accepted
- Architecture: 8 issues (5 P1, 3 P2)
- Code quality: 5 issues (1 P1, 2 P2, 2 P3)
- Test review: diagram produced; 3 P1 gaps
- Performance: 0 issues
- NOT in scope: written
- What already exists: written
- Failure modes: 1 critical gap
- Outside voice (Codex): ran in parallel; verdict REJECT (see §10)

---

## 10. Codex outside-voice REPORT (codex 0.125.0 via `codex exec`, 2026-05-01)

**Date:** 2026-05-01
**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check --sandbox read-only` with the plan-review prompt at `/tmp/phase2-plan-codex-review-prompt.txt` piped via stdin
**Plan:** `docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md`
**Output:** `/tmp/phase2-plan-codex-review-output.txt` (4193 lines)

### Verdict: REJECT

> Implementation may begin after required changes: yes, **after P0/P1 edits are applied and this plan is re-reviewed.** Current draft should not start T2.

### P0 blockers (7)

1. **Method-literal boundary violated by design.** §0.2/§0.3 confine ServerRequest literals to `approval-broker.ts`, but T12 tells render to switch on the same 9 method keys. **Smallest fix:** core's `ApprovalBroker` projects a method-free `approvalKind` / `ApprovalRequestKind`; render switches on that, not protocol strings.
2. **Fake E2E cannot create pending approvals as written.** The broker only creates `PendingEntry` when a handler is registered; otherwise it default-rejects synchronously (`approval-broker.ts:437`, `:455`). T8/T19 emit requests but never register Phase 2 pending-producing handlers. **Add an explicit broker API/setup task for IM-driven pending handlers** (e.g., a "pending-mode" registration that suspends the request without resolving until `resolve()` is called).
3. **Terminal callback handling is internally unreachable.** T4 says `getPending()` returns null for terminal records; T7 starts `resolve()` with `getPending()` and maps null to `unknown_approval_id` — preventing `expired`, `transport_lost`, `already_resolved`, `stale_callback` branches from firing. **Use an internal `#pendingById` entry lookup before public pending filtering.**
4. **Expiry is not fail-closed unless a sweeper ran first.** T19 calls `expirePending()` before resolving, but T7 never has `resolve()` itself check age/`expiresAt`. **Add `expiresAt`/broker max-age checking inside `resolve()` and settle expired through `settleOnce`.**
5. **Actor binding contradicts the safety redline.** §0.4 says wrong actor MUST fail closed; T7/T19 default to "first actor wins" — first unauthorized click approves. **Choose per-card/target actor binding for Phase 2.**
6. **B-clean "bit-identical" not preserved if T5 wraps/replaces `entry.settleOnce`.** Keep `createPendingEntry()` and `settleOnce` body byte-for-byte unchanged; **add a broker-private `#settleEntry()` helper that calls `settleOnce` and emits only if it returns true.**
7. **Unknown-method handling contradicts itself.** §0.4 requires a safe fallback card; T19 expects no card and an `approval.unsupported_method` audit event that T2 doesn't define. **Split:** wire-unknown gets `-32601` + audit/no pending; renderer-defensive unknown snapshot gets decline-only card.

### P1 required changes before implementation (7)

- **D11 wire decisions are wrong.** Generated v2 command/file decisions are `"accept"`, `"acceptForSession"`, `"decline"`, `"cancel"` — NOT `"approve"`. (`packages/codex-protocol/src/generated/v2/CommandExecutionApprovalDecision.ts:7`.) Plan T6 example must be corrected. Also: `mapDecisionForMethod(method, decision)` lacks params needed for permissions grants — make it `mapDecisionForPending(record/snapshot, decision)`.
- **Wire audit emission, not just types.** Created/resolved/expired/transport_lost/wrong_actor/stale_callback/duplicate_attempt/unsupported_method need tests AND call sites.
- **Put redaction on audit logging too.** `render/redact.ts` cannot protect core pino audit lines if raw metadata is logged.
- **Add `ApprovalActionDecision` → core `ApprovalDecision` mapping layer + tests.**
- **Add actual `RichBlock` implementation/tests.** File listed but tasks only define `ApprovalCard`.
- **Remove `@codex-im/core` as a channel-core dependency** unless strictly type-only and not broker-shaped — adapter layer must stay independent.
- **Make tests genuinely TDD.** T12, T17/T18, T21 currently implement before tests; T7/T12/T19/T21 are not 2–5 min tasks and must be split.

### P2 nice-to-have changes

- Soften D14 wording: "closed for Phase 2; future interface change requires reviewed amendment" beats promising Phase 4/5 will never need changes.
- Rename Option C fake to `TelegramShapeFakeChannelAdapter` to make Telegram constraints explicit.
- Avoid naming Lark/DingTalk in Phase 2 production type examples unless needed.
- Add safer rollback note than `git reset --hard`.

### Missing tests (8)

- Method-literal grep guard actually covering `packages/render/src`, `packages/channel-core/src`, conditional `packages/im-telegram/src`.
- Pending-handler bootstrap test proving server request → pending without default-reject.
- `resolve()` terminal lookup tests that don't go through public `getPending()`.
- Expired approval rejected by `resolve()` even when `expirePending()` was not run.
- Wrong actor BEFORE first decision (not only duplicate after actor A resolved).
- Secondary `#pendingById` drift/prune invariant.
- Audit redaction and audit emission for every failure branch.
- RichBlock projection/fallback tests.

### Risky assumptions

- "First actor wins" is safe enough for approvals.
- Telegram-shaped fake is sufficient to validate Telegram without a real adapter spike.
- `ChannelAdapter` can be frozen before Feishu/DingTalk pressure.
- Future maintainers will remember `runtime-send` is dev-only without stronger docs.

### Suggested edits

- Add a P0 fix section before T2 for: `ApprovalRequestKind`, pending handler setup, internal terminal lookup, actor binding, expiry-in-resolve, audit event set.
- Replace T12 method switch with a switch on core-projected `approvalKind`.
- Replace T5 "wrap settleOnce" with "all settle call sites use `#settleEntry()`; `settleOnce` body remains byte-for-byte unchanged."
- Update T19 unknown-method expected behavior to match the chosen redline.

### Architecture concerns

- Current render plan widens the ServerRequest method boundary.
- Option B T20c says stale callbacks are not routed to broker; that risks adapter-level broker knowledge. Adapter should validate callback shape, then orchestration/broker decides stale.
- Channel-core should consume `ApprovalCard`/actions only, not broker/core concepts.

### Security concerns

- Actor binding must be per-card/target, not first click wins.
- Audit logs need core-side redaction before pino emit.
- Expiry must be checked in `resolve()`.
- Unsupported decisions should fail closed and should generally not be rendered as available actions.

### Decisions verdict (codex)

| Decision | Verdict |
|---|---|
| D11 | CHANGE — per-method correct, but use generated values; pass record/snapshot context, not just method |
| D12 | CHANGE — snapshot API + emitters right; `resolve()` must use internal terminal lookup, not public pending-only `getPending()` |
| D13 | CHANGE — in-memory ring + pino fine; add complete event kinds, redaction, call-site wiring |
| D14 | CHANGE — closed for Phase 2 fine; remove overbroad future-platform guarantee, keep channel-core independent |
| D15 | APPROVE_WITH_CHANGES — add secondary-index invariant tests + callback hash/collision tests |
| D16 | APPROVE — runtime-send stays direct; T21 is the right mitigation |
| D17 | Option C |

### Open question answers (codex)

- Q1 (D17): Option C
- Q2 (actor binding): **Per-card/target binding. First actor wins is NOT acceptable for approvals.** (CONTRADICTS gstack §9.)
- Q3 (audit ring 1000): fine if constructor-configurable and FIFO-tested
- Q4 (MapDecision unsupported): throw / fail closed; do not coerce. Only render actions the mapper supports.
- Q5 (redact coverage): add env assignment values, PEM/TLS certs, cloud keys, Slack/OpenAI-style tokens, contextual long base64 secrets; never log raw params
- Q6 (runtime-send/Supervisor split): not loud enough — put "production uses Supervisor; runtime-send is dev/operator tooling only" in README, handoff, AND T21 test names

### Notes for implementer

> The smallest safe redesign is to make core own protocol-method classification and pending lifecycle, render own method-free cards, channel-core own platform actions, and orchestration glue own action→decision mapping.

---

## 10A. Combined review disposition (binding)

**Combined verdict: REJECT** (Codex's REJECT supersedes gstack's APPROVE_WITH_CHANGES because Codex caught 5 P0 blockers gstack missed.)

**Cross-model agreement on:**
- D17 Option C (gstack and codex)
- D16 runtime-send split (both)
- A4/D13 redact-in-core, not render
- A6 actionToDecision translation layer
- D11 per-method MapDecision is right shape (codex requires fixing example values + signature)
- T-G2 audit ordering test
- Q6 runtime-send/Supervisor needs louder docs

**Cross-model TENSION (user must decide):**
- **Q2 actor binding:** gstack said "first actor wins (Phase 2)"; codex said "per-card/target binding (P0 blocker — first wins is NOT acceptable for approvals)." **Codex's safety reasoning is stronger.** Recommend: adopt per-card/target binding for Phase 2 — bind actor at PendingEntry creation (or first registration) and reject any other actor's resolve.

**Required P0 fix arc (apply ALL before T2 starts):**

| # | Fix | Plan sections to edit |
|---|---|---|
| F1 | Introduce `ApprovalRequestKind` in core; render switches on it (not protocol method strings) | §1 D11, §2.1, §3, T6, T12 |
| F2 | Add IM-driven pending-handler bootstrap (broker.registerImHandler / registerPendingMode) | §1 (new D), T7 prereq, T8, T19 |
| F3 | resolve() uses internal `#pendingById` entry lookup, NOT public `getPending()` | T7 step 3.1 |
| F4 | resolve() checks age/expiresAt internally; not dependent on sweeper | T7 step 3.4-new, ApprovalRecord adds expiresAt |
| F5 | Actor binding per-card/target — bind at create, reject other actors | §0.4 (already says fail closed), T7 step 3.4, T19 path 5 |
| F6 | T5 emitters via `#settleEntry()` helper; settleOnce body byte-for-byte unchanged | T5 step 3 |
| F7 | Split unknown-method handling: wire-unknown → -32601 + audit / no pending; renderer defensive unknown → decline-only card | §0.4, T19 path 9, T2 audit kinds |

**Required P1 fix arc:**

| # | Fix | Plan sections |
|---|---|---|
| F8 | Correct D11 wire decision values to `accept/acceptForSession/decline/cancel`; expand mapper signature to take pending record (params context) | §1 D11, T6 |
| F9 | Audit emission wiring + tests for all 8 event kinds | T2 step 1, T7, T19 |
| F10 | redact.ts moves to `@codex-im/core/redact.ts`; audit.emit applies redact | §2.1, §5 T2/T10 |
| F11 | actionToDecision translation in core | new task between T7 and T8 |
| F12 | RichBlock implementation + tests | T11 expansion or new task |
| F13 | Drop or downgrade `@codex-im/core` from channel-core deps | T14 |
| F14 | TDD ordering: T12 / T17 / T18 / T21 must specify failing test before implementation; T7/T12/T19/T21 split into 2–5 min subtasks | T7, T12, T17, T18, T19, T21 |

**Total fix effort: ~2–3 hours of plan editing. NO code changes — all are doc edits to the plan.**

**Re-review required after P0 fixes land** (codex explicitly: "should not start T2" until re-review).

**Implementation may begin after:** P0/P1 edits applied + plan re-reviewed by both gstack and codex.

**Round-2 update — appended non-verbatim (2026-05-01)** *(round-2 deep-review P2-1: this paragraph is appended after the verbatim round-1 §10A disposition; it is NOT part of the historical round-1 record. The verbatim round-1 block ends at the table above. For round-2 + round-3 disposition see §10C / §10D / §10E.)*: both reviewers re-reviewed plan v1.5 (post-fix-arc-v1) and returned **APPROVE_WITH_CHANGES** with **0 P0 blockers**. Codex explicitly authorized T2 to begin AFTER P1 polish is applied — **no third review cycle required**. See §10C for the round-2 polish applied to the plan body, §10D for the round-2 review reports verbatim.

---

## 10B. Required Fix Arc Applied After Review (plan v2 revision, 2026-05-01)

Each P0 + P1 finding from §10A is now mapped to applied plan edits. Status legend: **Applied** = baked into plan v2; awaiting re-review.

### P0 fixes

#### F1 — `ApprovalRequestKind` (Codex P0-1, gstack A5)
- **Severity:** P0
- **Reviewer source:** Codex P0-1; gstack A5
- **Affected decisions/tasks:** D11 [REVISED], D18 [NEW], §2.1 (new file `approval-request-kind.ts`), §3 (boundary diagram), §0.4 (new redline), T2 (new task), T16 (renderer switches on kind), T20 (grep guard scope + classifier exemption)
- **Plan changes:**
  - D11 rewritten — per-`ApprovalRequestKind` mapper, not per-method-string mapper.
  - D18 NEW — codifies the classifier-then-pending-mode sequence.
  - §2.1 — adds `packages/core/src/approval-request-kind.ts` as the only new file in core/src/** allowed to contain ServerRequest method literals.
  - §3 boundary diagram — renderer switches on kind, not method.
  - §0.4 — redline added: "Renderer MUST consume `ApprovalRequestKind` from the core classifier; the renderer file `project-approval.ts` MUST NOT contain any of the 9 ServerRequest method literals."
  - T2 (new task) — TDD-builds the classifier with one assertion per method.
  - T16 (renderer projection) — switches on `ApprovalRequestKind`, never on method.
  - T20 — grep guard scope extended to render+channel-core; explicit exemption for the classifier.
- **New tests required:**
  - `packages/core/test/approval-request-kind.test.ts` — 10 method→kind assertions (incl. unknown).
  - `packages/render/test/no-protocol-import.test.ts` — render imports nothing from app-server-client.
  - Existing `packages/core/test/no-method-literals.test.ts` (T20 modification) — render/, channel-core/, im-telegram/ scope clean.
- **Status:** Applied; requires re-review.

#### F2 — IM-driven pending-handler bootstrap via `enablePendingMode` (Codex P0-2)
- **Severity:** P0
- **Reviewer source:** Codex P0-2
- **Affected decisions/tasks:** D18 [NEW], §2.1 (broker modifications), T8 (new task)
- **Plan changes:**
  - D18 — three-mode dispatcher (`default-reject` / `handler` / `pending`); pending-mode creates PendingEntry, no IIFE, awaits external settle.
  - §2.1 — broker modifications enumerated: enablePendingMode, #handle pending-mode arm, secondary index, emitters.
  - T8 — TDD-builds the pending-mode bootstrap with a test that proves PendingEntry creation without default-reject.
- **New tests required:**
  - `packages/core/test/approval-broker-pending-mode.test.ts` — server-request → pending without default-reject; audit `approval.created` fires.
- **Status:** Applied; requires re-review.

#### F3 — `resolve()` uses internal `#pendingById` lookup (Codex P0-3)
- **Severity:** P0
- **Reviewer source:** Codex P0-3
- **Affected decisions/tasks:** D12 [REVISED], T10
- **Plan changes:**
  - D12 — clarifies internal lookup vs public filtered API; documented as load-bearing for resolve() error branches.
  - T10.2 — explicit test `approval-broker-resolve-internal-lookup.test.ts` that uses a terminal-state record and verifies resolve returns `expired` (not `unknown_approval_id`).
- **New tests required:** `approval-broker-resolve-internal-lookup.test.ts`.
- **Status:** Applied; requires re-review.

#### F4 — Expiry checked inside `resolve()` (Codex P0-4)
- **Severity:** P0
- **Reviewer source:** Codex P0-4
- **Affected decisions/tasks:** D20 [NEW], §0.4 (redline), T6 (ApprovalRecord adds `expiresAt`), T10
- **Plan changes:**
  - D20 NEW — `resolve()` checks age before validating actor; expirePending sweeper is memory hygiene only.
  - §0.4 — redline: "Expired approvals MUST fail closed inside `resolve()` itself, regardless of whether `expirePending()` has run."
  - T6 — types extension adds `expiresAt: Date` to `ApprovalRecord`.
  - T10.3 — explicit test `approval-broker-expiry-in-resolve.test.ts` that does NOT call `expirePending()` first.
- **New tests required:** `approval-broker-expiry-in-resolve.test.ts`.
- **Status:** Applied; requires re-review.

#### F5 — Per-card actor binding (Codex P0-5)
- **Severity:** P0
- **Reviewer source:** Codex P0-5
- **Affected decisions/tasks:** D19 [NEW], §0.4 (redline), §0.2 (non-goal), T9, T21 path 5
- **Plan changes:**
  - D19 NEW — `bindActorPolicy(approvalId, policy)` API; resolve() validates actor + target + callbackNonce; mismatches fail closed via audit + structured error.
  - §0.4 — redline: "Wrong-actor / wrong-target / stale-callback approval decisions MUST fail closed via `broker.resolve` returning `{kind:"error", error: ...}` AND emitting an audit event. The first unauthorized click MUST NOT bind or approve."
  - §0.2 — non-goal: "First actor wins approval semantics — replaced by `bindActorPolicy` per-card binding."
  - T9 (new task) — TDD-builds the binding; tests cover wrong-actor BEFORE first decision (not just duplicate after first).
  - T21 path 5 — explicit "wrong actor BEFORE first decision" test.
- **New tests required:** `approval-broker-actor-binding.test.ts` covering all D19 invariants.
- **Status:** Applied; requires re-review.

#### F6 — `#settleEntry` helper preserves `settleOnce` byte-for-byte (Codex P0-6)
- **Severity:** P0
- **Reviewer source:** Codex P0-6
- **Affected decisions/tasks:** D21 [NEW], §0.3 (Phase 0/1 redline strengthened), T7
- **Plan changes:**
  - D21 NEW — `#settleEntry(entry, outcome, audit)` helper calls untouched `settleOnce`; ALL call sites route through it; B-clean preserved.
  - §0.3 — Phase 0/1 redline strengthened: "B-clean: `PendingEntry.settleOnce` is the only path to a wire response. **Phase 2 routes through `#settleEntry` helper; settleOnce body stays byte-for-byte unchanged.**"
  - T7.2 — meta-test diffs the settleOnce body against Phase 1 to assert no modification.
  - T7.3 — late-settle audit visibility test.
- **New tests required:** `approval-broker-settle-entry.test.ts`; T7.2 settleOnce-bit-identical guard.
- **Status:** Applied; requires re-review.

#### F7 — Unknown-method handling: split broker-level vs renderer-level (Codex P0-7)
- **Severity:** P0
- **Reviewer source:** Codex P0-7
- **Affected decisions/tasks:** §0.4 (redline), D13 (audit kinds include `unsupported_method`), T16 (renderer defensive unknown), T21 paths 9 + 10
- **Plan changes:**
  - §0.4 redline: "Wire-unknown ServerRequest method gets `-32601` fail-closed in broker `#handle` AND an `approval.unsupported_method` audit event with NO PendingEntry created. Renderer-defensive unknown-snapshot (e.g. when an internally-unknown classifier kind appears) renders a decline-only `ApprovalCard` (read-only view, no approve action). These are TWO different code paths..."
  - D13 — `approval.unsupported_method` event kind enumerated.
  - T16.3 — `projectAsRichBlock(snapshot, "unknown")` returns `{type: "unknown", method, raw}` (defensive renderer-side fallback).
  - T21 paths 9 (wire-unknown) + 10 (renderer defensive unknown) — separately tested.
- **New tests required:** T21 paths 9 + 10.
- **Status:** Applied; requires re-review.

### P1 fixes

#### F8 — Correct wire decision values + mapper takes pending record (Codex P1-1)
- **Severity:** P1
- **Reviewer source:** Codex P1-1
- **Affected decisions/tasks:** D11 [REVISED — table updated], plan v2 header (protocol evidence table), T11
- **Plan changes:**
  - Plan v2 header — protocol evidence table pinned with exact wire values per generated TS file.
  - D11 — full per-`ApprovalRequestKind` × per-`ApprovalUiAction` mapping table with REAL values (`accept`/`acceptForSession`/`decline`/`cancel` for v2; `approved`/`approved_for_session`/`denied`/`abort` for legacy; non-decision shapes for permissions/tool-input/tool-call/elicitation; -32601 for auth-refresh).
  - D11 — mapper signature `mapDecisionForPending(record, uiAction)` takes the full record (gives access to original params for permissions response).
  - T11 — TDD-builds with `_v2_*` type-only assertions per generated wire shape.
- **New tests required:** `packages/core/test/decision-mapper.test.ts` + `decision-mapper-shapes.test.ts`.
- **Status:** Applied; requires re-review.

#### F9 — Audit emission wiring for all event kinds (Codex P1-2)
- **Severity:** P1
- **Reviewer source:** Codex P1-2
- **Affected decisions/tasks:** D13 [REVISED — 10 event kinds], T3, T5, T7-T10
- **Plan changes:**
  - D13 — 10 event kinds enumerated (added `wrong_target`, `stale_callback`, `unsupported_decision`, `duplicate_attempt` for losing settles, beyond what v1 listed).
  - T3 — audit skeleton.
  - T5 — emit applies redact.
  - T7-T10 — each call-site (`#handle`, `#settleEntry`, `bindActorPolicy`, `resolve`, `expirePending`, `failPendingAsTransportLost`) emits the appropriate kind, tested per-branch.
- **New tests required:** `audit.test.ts` (10 kinds), `audit-redaction.test.ts` (every failure-branch fixture verified redacted).
- **Status:** Applied; requires re-review.

#### F10 — `redact.ts` relocated to core; audit applies redact (Codex P1-3, gstack A4)
- **Severity:** P1
- **Reviewer source:** Codex P1-3, gstack A4
- **Affected decisions/tasks:** §2.1 (file moved), T4 (new task), T5 (audit-redact wiring), T15 (render re-export)
- **Plan changes:**
  - §2.1 — `redact.ts` location is `packages/core/src/redact.ts`.
  - T4 — TDD-builds redact in core; expanded patterns per Codex Q5 (env-var values, PEM/TLS, Slack/OpenAI tokens, contextual base64).
  - T5 — `AuditEmitter.emit` applies redact to event metadata before pino + ring storage.
  - T15 — render re-exports redact from core.
- **New tests required:** `redact.test.ts` (expanded coverage), `audit-redaction.test.ts`.
- **Status:** Applied; requires re-review.

#### F11 — `actionToDecision` translation in core (Codex P1-4, gstack A6)
- **Severity:** P1
- **Reviewer source:** Codex P1-4, gstack A6
- **Affected decisions/tasks:** §2.1 (new file `action-to-decision.ts`), T11
- **Plan changes:**
  - §2.1 — `packages/core/src/action-to-decision.ts` defines the pure UI→decision-kind translator.
  - D11 — table makes the layering explicit: `ApprovalUiAction` (UI) → `ApprovalDecision` (core) via `actionToDecision`; then `mapDecisionForPending(record, uiAction)` produces the wire shape (kind-aware).
- **New tests required:** `action-to-decision.test.ts`.
- **Status:** Applied; requires re-review.

#### F12 — `RichBlock` implementation + tests (Codex P1-5)
- **Severity:** P1
- **Reviewer source:** Codex P1-5
- **Affected decisions/tasks:** §2.2 (new file `rich-block.ts`), T14, T16.3
- **Plan changes:**
  - §2.2 — `packages/render/src/rich-block.ts` defines `RichBlock` discriminated union (Phase 2 minimum: `text` / `approval` / `unknown`).
  - T14 — TDD-builds `RichBlock` types alongside `ApprovalCard`.
  - T16.3 — `projectAsRichBlock(snapshot, kind)` integration.
- **New tests required:** `rich-block.test.ts` + `project-approval-unknown-defensive.test.ts`.
- **Status:** Applied; requires re-review.

#### F13 — Drop `@codex-im/core` runtime dep from channel-core (Codex P1-6)
- **Severity:** P1
- **Reviewer source:** Codex P1-6
- **Affected decisions/tasks:** §2.2 (channel-core package.json), §3 (boundary diagram), T18
- **Plan changes:**
  - §2.2 — channel-core's package.json deps on `@codex-im/render` (type-only). NO runtime dep on `@codex-im/core`.
  - §3 — boundary invariant 1 strengthened: "ChannelAdapter MUST NOT runtime-import from core/codex-runtime/app-server-client."
  - T18.3 — `no-broker-import.test.ts` grep guard.
- **New tests required:** `no-broker-import.test.ts`.
- **Status:** Applied; requires re-review.

#### F14 — TDD ordering + 2–5 min task granularity (Codex P1-7)
- **Severity:** P1
- **Reviewer source:** Codex P1-7
- **Affected decisions/tasks:** All §5 tasks
- **Plan changes:**
  - Every task in §5 v2 follows TDD-first: failing test → run → expect FAIL → minimal impl → run → PASS → commit.
  - T7, T10, T16, T21 split into multiple Tn.x subtasks, each 2–5 min.
- **Status:** Applied; requires re-review.

### gstack-only fixes (also applied)

- **A1** stale_callback unreachable → kept the variant but route via internal `#pendingById` (D12); now reachable for cases like binding-mismatch (separate from `expired`/`transport_lost`/`already_resolved`). **Applied via D12 + T10 branches.**
- **A2** resolve()/wire async semantics → JSDoc + T21.3 ordering assertion. **Applied.**
- **A3** Boundary grep guard scope extension → T20 task. **Applied.**
- **A7** Telegram constraints cited → T19 cites Telegram Bot API URLs. **Applied.**
- **A8** Supervisor invariant runtime check → T22.5 + `broker.isAttached()`. **Applied.**
- **Q1** English plain-text → T17 default English; locale is adapter scope. **Applied.**
- **Q2** CLAUDE.md "Method literal policy" updated → T23.4. **Applied.**
- **Q3** D11 spike now done → plan v2 header table. **Applied.**
- **Q4** `_auditRingForTest` → T3.3. **Applied.**
- **T-G1** redact-applied per text field per kind → T16.2. **Applied.**
- **T-G2** audit-emit-before-wire-response → T21.3. **Applied.**
- **T-G3** max-length callback_data → T21.5. **Applied.**

### Summary

- **P0 fixes applied:** 7 (F1–F7).
- **P1 fixes applied:** 7 (F8–F14).
- **gstack-only fixes applied:** 12.
- **P2 fixes applied:** D14 wording softened; `TelegramShapeFakeChannelAdapter` rename; rollback safer (no `git reset --hard`); Lark/DingTalk not in production examples.
- **No P1 deferred to backlog.** Per user directive.
- **All re-review required:** YES — both gstack `/plan-eng-review` AND Codex outside-voice on plan v2.

---

## 10C. Round-2 polish applied (2026-05-01)

Round-2 combined verdict on plan v1.5: **APPROVE_WITH_CHANGES**. **No P0 blockers remain.** Codex explicitly: "Whether T2 may begin after required changes: yes, after the P1 edits above are applied." No round-3 review required.

The 14-item polish list below was applied to the plan body (this is a SECOND revision — plan v2 = v1.5 + this polish). All 14 items are now in the plan body, not just summarized here.

### Three tension resolutions adopted (Codex's reasoning was stronger on all three)

| # | Topic | Adopted | Plan locations |
|---|---|---|---|
| **T1** | Binding-failure naming | **`binding_required`** (operator-precondition violation; clearer than v1's `unbound`) | D19 (line ~410+), T6.1, T9.1, T10.1, T21.2.9, ResolveError union |
| **T2** | Audit ring hard MAX | **100_000 with constructor throw** | D13, T3.1 (constructor-throw test), `AUDIT_RING_HARD_MAX` constant |
| **T3** | T7.2 settleOnce assertion | **`git show phase-1-runtime-complete:packages/core/src/approval-broker.ts` source-range comparison via marker comments** (NOT `Function.prototype.toString()`, NOT loose hash) | T7.2 |

### Codex round-2 P1 (3 items)

| # | Item | Plan changes |
|---|---|---|
| **C1** | Remove `decision-mapper.ts` from approved-homes/exemptions; mapper switches on kind only | §0.2 redline (line 67), §2.1 grep-guard line, §2.3 CLAUDE.md update line, §3 invariant 4. Allowlist now contains `approval-request-kind.ts` ONLY. |
| **C2** | Audit kinds for `binding_required` and `unknown_approval_id` | D13 `AuditEventKind` union expanded from 10 → **12** kinds (added `approval.binding_required`, `approval.unknown_approval_id`). T3.1 asserts 12. T6 enumerates 9 ResolveError kinds (added `binding_required` properly to the union; `wrong_target` was already there). T10/T21 wire emits per-branch. |
| **C3** | T21.2 split into per-path TDD subtasks | T21.2 expanded from 10-paths-in-one to **15 subtasks** (T21.2.1 – T21.2.15), each TDD-first. Each path has audit-redaction-per-branch fixture (R4). |

### gstack round-2 P1 (4 items)

| # | Item | Plan changes |
|---|---|---|
| **R1** | ResolveError count consistency (was "8 kinds" vs enumerated 9) | T6.1 → "**9 kinds**"; T10.1 → "**9 branches + happy path = 10 subtasks**"; §2.1 / §4 dependency table → "9 kinds"; §10B F3 wording aligned. |
| **R2** | T20 grep guard concrete glob + exclusion mechanism | T20.1 now shows full `git ls-files` + allowlist code; T20.3 adds explicit "decision-mapper.ts contains zero method literals" assertion. |
| **R3** | T7.2 settleOnce mechanism | Covered by **T3** above (`git show` source-range). |
| **R4** | T21 audit-redaction explicit per failure branch | T21.2.1 – T21.2.15 each have a known-bad payload fixture (Telegram bot token + abs path + AWS-key-shaped string) and assert all string fields in the resulting audit event are redacted. |

### Round-2 P2 polish (7 items)

| # | Item | Plan changes |
|---|---|---|
| **C-P1** | Renderer-defensive unknown alignment | §0.4 redline + T16.3 + T21.2.15 all converge on **decline-only `ApprovalCard`** (action set `[{kind:"decline"}]`, risk level "critical"). `RichBlock.unknown` variant remains for non-approval future use cases (e.g. unknown ServerNotification arms surfaced from EventNormalizer); it is NOT used for unknown approval requests. |
| **C-P2** | D12 vs D21 `#settleEntry` audit semantics aligned (D21 wins) | D12 `#settleEntry` pseudocode now emits original kind on win, `approval.duplicate_attempt` on loss. Single source of truth for win/loss audit semantics. |
| **C-P3** | "8 kinds" → "9 kinds" wording | Subset of R1; applied throughout. |
| **R5** | D20 `spec.defaultReject()` → `entry.spec.defaultReject()` | D20 resolve() pseudocode (line ~480) corrected; comment notes PendingEntry stores its DispatcherSpec at creation time per Phase 1. |
| **R6** | D19 binding-vs-resolve race wording | D19 strengthened: bindActorPolicy MUST be called SYNCHRONOUSLY inside `onPendingCreated` callback BEFORE adapter.sendCard. Sketches sendCard-failure handling (binding stays in place; safety preserved). |
| **R7** | T16 permissions wording | Removed "(check the actual table)" parenthetical. T16.1 now enumerates the concrete action set per kind (command/file/legacy → all 4; permissions/tool_user_input/tool_call → decline only; mcp_elicitation → decline + abort; auth_token_refresh → no actions; unknown → decline only). |
| **R8** | D20 `unsupported_decision` audit explicit | D20 resolve() pseudocode step 7 now explicitly emits `approval.unsupported_decision` on mapper-`unsupported` and `error` branches; defense-in-depth note added. |

### Round-2 status

- **All 14 polish items applied to the plan body.**
- §10A combined disposition updated: round 2 = APPROVE_WITH_CHANGES, no P0 remaining, T2 authorized after polish applied, no round 3 required.
- §12 open questions resolved with adopted answers (see §12).
- T2 may begin AFTER: (a) all 14 items applied (✅ this revision), (b) docs-only gates pass, (c) revised plan committed. No further plan-level review.

---

## 10D. Round-2 review reports (verbatim, 2026-05-01)

### gstack `/plan-eng-review` round 2 — verdict APPROVE_WITH_CHANGES

- All 14 fix-arc items from round 1 verified in plan body (not just §10B).
- Round-2 findings: 4 P1 (R1–R4) + 4 P2 (R5–R8). All resolved in §10C.
- D11–D21: APPROVE or APPROVE_WITH_CHANGES (with §10C polish applied).
- D17 Option C: APPROVE.

### Codex outside-voice round 2 — verdict APPROVE_WITH_CHANGES

> "**Remaining P0 blockers: None.** The prior P0s are materially reflected in the plan body, not only §10B."

> "**Whether T2 may begin after required changes: yes**, after the P1 edits above are applied."

Round-2 codex P1 (3 items, all resolved in §10C):
1. `decision-mapper.ts` exemption removed (C1).
2. Audit kinds for `binding_required` and `unknown_approval_id` enumerated (C2).
3. T21.2 split into per-path TDD subtasks T21.2.1 – T21.2.15 (C3).

Round-2 codex P2 (3 items, all resolved):
- Renderer-defensive unknown alignment (C-P1).
- D12 vs D21 audit semantics alignment (C-P2).
- "8 kinds" → "9 kinds" (C-P3 = R1 subset).

Cross-model agreement:
- Both APPROVE_WITH_CHANGES, no P0 blockers
- Both adopt Codex's stronger reasoning on the 3 tensions (T1 binding_required; T2 100_000 hard MAX; T3 git-show source-range)
- Both confirm D17 Option C
- Both confirm T2 authorized after polish

Output file: `/tmp/phase2-plan-codex-rereview-output.txt` (3243 lines).

---

## 10E. Round-3 deep-review (Codex post-T3, 2026-05-01) + Option B+ polish applied (plan v2.3)

After T2 + T3 landed (commits `89968ee` + `bd99dd1`), a Codex deep review was run on `phase-1-runtime-complete..HEAD` (3 commits + plan v2.2). Output: `/tmp/phase2-deep-review-output.txt` (9085 lines).

**Verdict: APPROVE_T4_AFTER_FIXES.** No P0 blockers; T2/T3 code sound; B-clean `settleOnce` byte-for-byte unchanged; method-literal boundary clean. **6 P1 + 7 P2 findings** — mostly plan/status drift caught by holistic cross-check between plan body, §10C tracking, and the actual code/handoff state.

User chose **Option B+**: apply all 6 P1 fixes + 2 docs-only P2 (AuditLogger doc + §10A wording); defer the 5 test-hardening P2 items to organic future tasks. This block (plan v2.3) records the polish applied.

### P1 fixes applied (6)

| # | Codex finding | Fix applied |
|---|---|---|
| **P1-1** | T2 file list omitted `index.ts` (T2 actually exported through it) | §5 T2 file list now lists `Modify: packages/core/src/index.ts` explicitly. Implementation already matched; this is a plan-body-catches-up edit. |
| **P1-2** | T2 plan snippet showed `Record<string, ...>` while implementation used the tighter `Record<ServerRequest["method"], ...>` | §5 T2.3 snippet updated to the implementation-equivalent type, with inline note explaining the codex 0.126+ compile-fail guard rationale. |
| **P1-3** | "10 event kinds" still present in active plan body (§0.1, §2.1) while D13/T3/code are 12 | Active body references at §0.1 line 43, §2.1 audit.ts comment, §2.1 audit.test.ts comment all updated to **12**. Historical §10B wording (which describes what plan v2 said at fix-arc time, when it was 10) is left as historical record per Codex's explicit guidance. |
| **P1-4** | D20 resolve() pseudocode emitted `approval.unsupported_method` for unknown approval id, contradicting D13 (which has both `unsupported_method` and `unknown_approval_id` as distinct kinds) | D20 step 1 now emits **`approval.unknown_approval_id`** with inline note distinguishing the two code paths (wire-level `#handle` unknown vs. resolve()-level unknown id). |
| **P1-5** | T9 tests called `resolve()` (T10 territory); T10's resolve called `mapDecisionForPending()` (T11 territory) — mechanical dependency violation | **Reorder applied**: §4 dep-graph + serial spine + §4 lead-session-table + §5 task-body sections. Old T10 (resolve) is now T11; old T11 (mapper) is now T10. T9 trimmed to `bindActorPolicy` storage + idempotency only; resolve()-invoking actor-validation tests deferred to **T11.4** (was T9.1). T11.4 explicitly assumes T10 mapper exists. No forward-references. |
| **P1-6** | `phase2-live-status.md` was stale (said "no implementation started, next=T2"; HEAD was T3) | File rewritten to reflect HEAD = T3 (`bd99dd1`); T2 + T3 marked complete; next = T4. Sibling commit. |

### P2 docs-only fixes applied (2)

| # | Codex finding | Fix applied |
|---|---|---|
| **P2-7b** | D13 still names `pino.Logger`; §3 didn't reflect the approved T3 duck-typed AuditLogger / no-pino-runtime-dep decision | D13 now defines `AuditLogger` interface + uses it as the constructor option type. §3 boundary diagram + a new invariant 0 explicitly state "core is logger-implementation-agnostic; no pino runtime dep". §0.1 P2.5 row updated. §2.1 audit.ts comment updated. |
| **P2-1** | §10A "Round-2 update" paragraph was inside the verbatim-immutable round-1 block (line 1640 within §10A) | Paragraph rewritten to begin with **"Round-2 update — appended non-verbatim (2026-05-01)"** + inline parenthetical noting the verbatim round-1 block ends at the table above. No content lost; historical posture preserved. |

### P2 deferred to backlog (5 items; tracked in TODOS.md)

These are quality-of-life test hardenings that don't block T4 / Phase 2 progress. Will be picked up organically when the relevant task naturally touches them (T6/T7 for outcome-field design; T11/T21 for additional resolve-branch coverage; T16/T17 for similar union exhaustiveness in render):

1. **T2 / T3 type-level "exact union" tests use array-membership shape; would still pass if an 11th / 13th kind were added.** Recommend `Exclude<ApprovalRequestKind, Listed[number]> extends never` style guard (and same for `AuditEventKind`).
2. **T2 classifier tests don't exercise `Object.hasOwn` defenses against `"toString"` / `"constructor"`.** Implementation is correct; tests are missing the edge case.
3. **T3 audit constructor edge tests miss `NaN`, `Infinity`, `Number.MAX_SAFE_INTEGER`, `-0`.** Implementation handles them via `Number.isInteger`; tests should pin.
4. **T3 ring FIFO test covers one overflow only; multi-cycle stress test (e.g. ringSize 3 + 10 emits → assert `[7, 8, 9]`) would catch any off-by-one in the rotate path.**
5. **D12/D21 pseudocode references `outcome: "lost-race"` as a root field on AuditEvent, but `audit.ts:88` AuditEvent has no root `outcome` field.** Either move under `metadata` or add an explicit optional root field. Decision should land BEFORE T7 starts (T7 wires `#settleEntry` and would emit `outcome` from there).

**These five items are tracked in TODOS.md under "Phase 2 P2 polish backlog (round-3 deep-review deferred)".**

### Re-verification

Post-polish gates after this block lands:
- `pnpm typecheck` — to be re-run
- `pnpm test` — 354 baseline (T2 + T3 contributions; no Phase 2 implementation tests removed)
- `pnpm lint` — to be re-run
- `pnpm protocol:check` — unchanged
- `bash scripts/ci-check.sh` — to be re-run

T4 (redact relocation to core) authorized to begin after this commit lands and gates re-confirm green.

---

## 11. Self-review checklist (writing-plans skill §Self-Review) — v2

- ✅ **Spec coverage**: every requirement in the kickoff brief Step 5 (P2.1–P2.6) maps to one or more tasks in §5.
  - P2.1 broker public surface → T2 (classifier), T3-T5 (audit), T6 (types), T7 (emitters+settleEntry), T8 (pending-mode), T9 (binding), T10 (resolve)
  - P2.2 rendering model → T13-T17 (render package)
  - P2.3 ChannelAdapter → T18-T19 (channel-core)
  - P2.4 Telegram MVP decision → D17 Option C; im-telegram NOT in default Phase 2
  - P2.5 runtime-send vs Supervisor → D16 + T22
  - P2.6 fake e2e → T12 (happy) + T21 (full 9 paths + Codex missing-tests)
- ✅ **Placeholder scan**: no "TBD", "TODO", "implement later". Every step shows code or commands.
- ✅ **Type consistency**: `ApprovalRequestKind` (T2) used in T11/T16. `PendingApprovalSnapshot` (T6) used in T7/T10/T16/T21. `ResolveApprovalInput`/`Result`/`Error` (T6) used in T9/T10/T21. `ApprovalCard`/`RichBlock` (T14) used in T16/T21. `ChannelAdapter` (T19) used in T21. No naming drift.
- ✅ **Boundary preservation**: §3 module boundaries documented; §0.4 redlines codified; §0.3 Phase 0/1 redlines strengthened (settleOnce body byte-for-byte unchanged).
- ✅ **Risk coverage**: §0.2 non-goals firmly defer; §0.4 adds 12 new redlines; §10B documents every P0/P1 fix.
- ✅ **B-clean preservation**: D21 + §0.3 + T7.2 meta-test guarantee `entry.settleOnce` body is unchanged.
- ✅ **Codex P0 closure**: F1–F7 all map to specific tasks + tests + redlines (§10B).
- ✅ **Codex P1 closure**: F8–F14 all applied; no P1 deferred.

---

## 12. Open questions — RESOLVED in v2 (round-2 polish applied)

All v1 and v2-round-1 open questions are now resolved with adopted answers:

1. **B-clean settleOnce-bit-identical assertion mechanism — RESOLVED v2.2:** **`git show phase-1-runtime-complete:packages/core/src/approval-broker.ts`** with marker-bounded source-range comparison (Codex round-2 T3). Added marker comments in T7.1 implementation; T7.2 test extracts both the Phase 1 tag's body and the working-tree body, asserts byte-equality. NOT `Function.prototype.toString()` (V8/transpilation/formatter-dependent); NOT a hash of the whole file (false positives on surrounding edits).
2. **`#pendingById` after handler-mode happy path — RESOLVED v2.2:** Handler-mode happy path deletes from both `#pending` and `#pendingById` (Phase 1 conditional-delete preserved). IM pending-mode terminal records (resolved/expired/transport_lost) ALWAYS retain in both maps until prune (Phase 1 D6 audit invariant carried into Phase 2). Documented as a deliberate non-IM/audit-retention exception per Codex round-2 Q2.
3. **`bindActorPolicy` failure mode naming — RESOLVED v2.1:** chosen as **`binding_required`** (Codex round-2 T1). Names the failure as an operator/daemon-wireup precondition violation, not a state.
4. **Audit ring hard MAX — RESOLVED v2.2:** **100_000 hard cap; constructor throws if `ringSize > 100_000`** (Codex round-2 T2). Default 1000 retained. `AUDIT_RING_HARD_MAX = 100_000` constant in `audit.ts`.
5. **`approval-request-kind.ts` exemption scope — RESOLVED v2.2:** `approval-request-kind.ts` is the ONLY Phase 2 grep-guard exemption. **`decision-mapper.ts` is NOT exempt** (Codex round-2 C1) — the mapper switches on `ApprovalRequestKind`, never on raw method strings. T20.3 adds an explicit assertion that `decision-mapper.ts` contains zero method literals.

**No outstanding questions for plan v2.2.** T2 may begin after the post-polish gates pass and the plan is committed.

---

## Appendix A — Phase 1 → Phase 2 boundary recap

Phase 1 leaves these load-bearing pieces ready:

- `ApprovalBroker` with `attach`, `reattach`, `registerHandler<M>`, `expirePending`, `failPendingAsTransportLost`, `dispatchMethods`, `_pendingRecordsForTest`. Phase 2 EXTENDS with `enablePendingMode`, `resolve`, `listPending`, `getPending`, `bindActorPolicy`, `isAttached`, `onPendingCreated`, `onPendingResolved` — all routed through new private `#settleEntry` helper that calls untouched `settleOnce`. **B-clean settleOnce body is byte-for-byte contract.**
- `CodexRuntime` `REQUEST_METHODS` table (9 entries; immutable in Phase 2).
- `EventNormalizer.events()` AsyncIterable + `endOfStream()` drain; `unknown` event arm for unknown ServerNotifications.
- `Supervisor` quartet ownership; `transportFactory`/`clientFactory`/`runtimeFactory` injection points. **Phase 2 adds runtime invariant assertion at `#spawnFresh` head: broker MUST be pre-attached.**
- `AppServerClient` ONE-SHOT lifecycle.
- T9b grep guards for ServerRequest method literals AND ClientRequest method literals — **scope extended in Phase 2 T20 to render/, channel-core/, im-telegram/**.
- `categorizeJsonRpcError` helper.
- 320 tests across 31 files; all 8 ci-check gates.

Phase 2 must not modify any of the above except adding NEW emit hooks at the `#settleEntry` helper boundary inside `ApprovalBroker`. The existing `entry.settleOnce` body remains byte-for-byte unchanged. `createPendingEntry` factory is unchanged.

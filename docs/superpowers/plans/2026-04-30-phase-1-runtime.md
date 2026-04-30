# Phase 1 — Codex Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT — awaiting human approval, then `/plan-eng-review` + Codex outside-voice review.

**Goal:** Deliver thread/turn/event/approval kernel **without** any IM. Extend (never rewrite) the Phase 0 stack so subsequent IM phases (2/4/5) only have to wire I/O.

**Architecture:** Three new packages — `codex-runtime` (state machine + EventNormalizer + typed wrappers), `core` (ApprovalBroker only — `SecurityPolicy` is Phase 3), `daemon` (supervisor implementing the ONE-SHOT lifecycle policy already documented on `AppServerClient`). Method names for server-initiated approvals are read from generated `ServerRequest.ts` union (no string literals in production code below the `ApprovalBroker` boundary).

**Tech Stack:** TypeScript 5.9 strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess; Vitest 4 (`test.projects` for unit/contract); Biome 1.9; pnpm workspace; Node 20+.

---

## 0. Scope

### 0.1 In scope

| ID | Item | Source |
|---|---|---|
| **P1.1** | `CodexRuntime` typed wrappers over `client.request<R>(method, params)` | TODOS.md, handoff §Phase 1 backlog |
| **P1.2** | `ApprovalBroker` — single server-request handler + internal method dispatch | TODOS.md, 05-PROTOCOL §4 |
| **P1.3** | `EventNormalizer` — ordered async iterator over `client.onNotification` + terminal-state recognition + unknown fail-open | TODOS.md, 03-ARCH §6 |
| **P1.4** | Daemon supervisor — ONE-SHOT lifecycle on codex restart | TODOS.md, `client.ts` JSDoc |
| **P1.5** | `categorizeJsonRpcError(err)` helper | 05-PROTOCOL §1.1 |
| **P1.6** | Richer wire fixtures (replace `harmless-turn-event-stream.jsonl` placeholder) + capture tooling | TODOS.md, host-environment.md |
| **P1.7** | `codex-im runtime send` CLI — manual turn dispatch without IM | handoff §Phase 1 目标 |
| **P1.8** | Documentation: 05-PROTOCOL re-validation against generated `ServerRequest.ts` after fixture capture | TODOS.md |

### 0.2 Non-goals (reject if asked)

- ❌ Any IM adapter (Telegram = Phase 2, 飞书 = Phase 4, 钉钉 = Phase 5)
- ❌ Computer Use (= Phase 6)
- ❌ SQLite storage / repositories (= Phase 2)
- ❌ ChannelAdapter abstraction, CommandRouter, SessionRouter (= Phase 2)
- ❌ `SecurityPolicy` full implementation — only a typed placeholder interface in Phase 1 (= Phase 3)
- ❌ `launchd` plist / install scripts (= Phase 3)
- ❌ Rewriting `@codex-im/app-server-client` / `StdioTransport` / `JsonlDecoder` — Phase 0 contracts, only extend
- ❌ Making `AppServerClient` restartable (violates ONE-SHOT policy in `client.ts` JSDoc)
- ❌ Hardcoding approval / server-request method literals in `app-server-client` layer
- ❌ Putting real-turn smoke in default `pnpm test`

### 0.3 Phase 0 redlines (still in force)

Carried verbatim from CLAUDE.md / handoff §Phase 0 红线复核. Any task that would violate one of these is **rejected at review**, not "fixed in code review".

### 0.4 Prerequisites (separate PRs)

Pre-1 and Pre-2 ship as **standalone PRs** off `phase-0-bootstrap`, each with its own Phase 0 gate re-run, before Phase 1 implementation begins. Pre-3 was added late (after T8) as a **mid-Phase-1 prerequisite** discovered during T9a-prep drift audit. None of these are Phase 1 tasks — they are prerequisites the plan depends on.

#### Pre-1: Node 22→24 bump (was P0-1 in plan-eng-review; reversed after Codex outside-voice on 2026-04-30)

Today is 2026-04-30 — Node 20 reaches EOL today per the official Node release schedule. Codex outside-voice flagged that Phase 1 cannot ship long-term on EOL Node. The right move is a single standalone bump PR, not silent inclusion in any Phase 1 task.

Scope of the bump PR:
- `package.json#engines.node` → `>=24 <25`
- `package.json#codexIm.nodeVersion` (if present) → `24.x`
- `@types/node` devDep → `^24`
- Re-run all Phase 0 gates under Node 24: `pnpm typecheck && pnpm test && pnpm lint && pnpm protocol:check && CODEX_SMOKE=1 pnpm smoke:app-server && CODEX_REAL_SMOKE=1 pnpm smoke:real-turn && pnpm audit`
- Tag: `phase0-bootstrap-node24` (preserves the original `phase0-bootstrap-complete` tag on the Node-20 commit for traceability)
- Single commit titled `chore(node): bump engines.node from >=20.10 to >=24 — Node 20 EOL 2026-04-30`

Phase 1 starts **on top of** this bump. Every later command in this plan assumes Node 24.

#### Pre-2: `@codex-im/protocol` facade expansion (Codex blocker B3)

Phase 0 facade `packages/codex-protocol/src/index.ts:12` only re-exports initialize types. Phase 1 imports `ServerRequest`, `ServerNotification`, `ClientRequest`, plus per-method params/responses. Without a facade expansion, every Phase 1 package would either grow `import { ... } from "@codex-im/protocol/generated/..."` strings (loses the audited facade rule) or break.

The facade expansion ships as a separate small PR before Task 1 because:
- It touches only one file (`packages/codex-protocol/src/index.ts`) plus its test
- Each new export is a deliberate code-review checkpoint per the facade rule (`packages/codex-protocol/README.md`)
- T1 (categorize-error) is the only Phase 1A task that does NOT depend on the facade — it can run in parallel with this PR; T3/T5/T6/T7a/T8/T9a all depend on it

Scope of the facade PR (`packages/codex-protocol/src/index.ts`):
```ts
// Add to existing initialize-only exports:
export type {
  // discriminated unions used for type-level method dispatch
  ServerRequest,
  ServerNotification,
  ClientRequest,
  ClientResponse,
  ServerResponse,
} from "./generated/index.js";

// Per-method params/responses consumed by Phase 1.
// (Add only what Phase 1 imports; new exports require a code-review checkpoint.)
export type {
  // Threading / turning
  ThreadStartParams, ThreadStartResponse,
  ThreadResumeParams, ThreadResumeResponse,
  ThreadForkParams, ThreadForkResponse,
  ThreadTurnsListParams, ThreadTurnsListResponse,
  ThreadReadParams, ThreadReadResponse,
  TurnStartParams, TurnStartResponse,
  TurnSteerParams, TurnSteerResponse,
  TurnInterruptParams, TurnInterruptResponse,    // Codex B8: turn/interrupt — not thread/interrupt
  ReviewStartParams, ReviewStartResponse,
  // Server-initiated request params (consumed by ApprovalBroker dispatchers)
  CommandExecutionRequestApprovalParams, CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalParams, FileChangeRequestApprovalResponse,
  PermissionsRequestApprovalParams, PermissionsRequestApprovalResponse,
  ToolRequestUserInputParams, ToolRequestUserInputResponse,
  DynamicToolCallParams, DynamicToolCallResponse,
  McpServerElicitationRequestParams, McpServerElicitationRequestResponse,
  ApplyPatchApprovalParams, ApplyPatchApprovalResponse,    // legacy
  ExecCommandApprovalParams, ExecCommandApprovalResponse,  // legacy
  ChatgptAuthTokensRefreshParams, ChatgptAuthTokensRefreshResponse,
  ReviewDecision,
  // Notification params (consumed by EventNormalizer)
  TurnStartedNotification, TurnCompletedNotification,
  ItemStartedNotification, ItemCompletedNotification,
  AgentMessageDeltaNotification,
  // ... other notification arms enumerated by the implementer
} from "./generated/index.js";
```

The implementer **enumerates each export** and verifies it exists in `packages/codex-protocol/src/generated/index.ts` before committing. Any name that doesn't exist is a Phase 1 plan defect — surface it before Phase 1 starts, not during implementation.

Tag/commit: a single commit `feat(protocol): expand facade for Phase 1 (ServerRequest/Notification/ClientRequest + per-method types)` on a branch off whatever the Node bump PR settles on.

#### Pre-3: `AppServerClient` explicit JSON-RPC error propagation (added 2026-04-30 after T8 — drift audit retrofit)

**Status:** added late; ships as a standalone PR off `phase-1-runtime` HEAD (`585235e`, T8 review fixes), before T9a starts.

**Goal:** Allow server-request handlers to throw a `JsonRpcResponseError` and have `AppServerClient.dispatchServerRequest` preserve, on the wire-level error envelope:
- `err.code`
- `err.rawMessage` (used as `error.message`)
- `err.data`

Generic thrown values (plain `Error`, strings, etc.) continue to collapse to `-32603 "handler error: <message>"` exactly as today — this is purely additive.

**Rationale:**
T9a's `ApprovalBroker` needs to express "server sent a method that is not in our generated dispatch table" as JSON-RPC `-32601` (Method Not Found), without:
- hard-coding approval method-name string literals outside `packages/core/`
- collapsing every dispatch-table miss into the existing `-32603 "handler error"` (which is reserved for "registered handler crashed at runtime" per T9b §9b.3)

The `JsonRpcResponseError` class already exists in `packages/app-server-client/src/errors.ts` and carries (`code`, `rawMessage`, `data`). Today it is only constructed for *inbound* error responses; Pre-3 makes it symmetric — handlers can construct one to signal *outbound* errors.

**Why this isn't part of T9a:**
The drift audit on 2026-04-30 (after T8 commit `585235e`) found that an in-progress T9a-prep change had modified `packages/app-server-client/{src,test}` outside T9a's authorized Files list (CLAUDE.md "每个任务只改计划内文件"). Rather than absorb the change into T9a or T9b, we promote it to a separate Pre-3 prerequisite with its own gate re-run, mirroring Pre-1 / Pre-2 discipline. The original drift was preserved as `git stash` (`pre3-appserverclient-jsonrpc-error-propagation`) and is unstashed during Pre-3 implementation.

**Scope (Files):**
- Modify: `packages/app-server-client/src/client.ts` — extend `dispatchServerRequest` catch block; check `err instanceof JsonRpcResponseError` first, propagate its envelope; otherwise existing `-32603` path unchanged.
- Modify: `packages/app-server-client/test/client-default-reject.test.ts` — add one unit test asserting `JsonRpcResponseError` thrown from a registered handler reaches the wire with its original code/message/data; assert it does NOT carry the `"handler error: "` prefix.

No other files are in Pre-3 scope. In particular:
- No `packages/core/` work (that is T9a/T9b).
- No `packages/codex-runtime/` work.
- No new approval method-name string literals anywhere.

**Rules:**
- Generic handler throws still map to `-32603` (legacy behavior preserved — verified by the existing "rejects with -32603 when handler throws" test in the same file).
- Explicit `JsonRpcResponseError` throws preserve their explicit code/message/data verbatim.
- No approval method names are hard-coded (the test uses a synthetic `foo/bar` method).
- No broker implementation, dispatch table, or fixture replay is added in Pre-3.
- No real IM adapter, Computer Use production flow, or WebSocket production listener is added.
- ONE-SHOT lifecycle JSDoc on `AppServerClient` is preserved verbatim — Pre-3 only edits the catch arm in `dispatchServerRequest`.

**Gate re-run before merging Pre-3:**
- `pnpm typecheck` — exit 0
- `pnpm typecheck:tests` — exit 0
- `pnpm test` — full unit suite green; expected count: 230 → **231** (one new test from this PR; also matches the 231-count observed in working-tree before stashing)
- `pnpm lint` — exit 0
- `pnpm protocol:check` — exit 0
- `bash scripts/ci-check.sh` — all 8 gates green
- (Optional, costly) `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` — sanity that real codex round-trip still works under the new catch logic. Only matters if the change accidentally leaks into the success path; the diff is in the catch arm, so this is defense-in-depth.

**Tag/commit:** single commit on a branch off `phase-1-runtime`, message:

```
feat(app-server-client): JsonRpcResponseError propagation from server-request handlers (Pre-3)

Symmetric to inbound error responses: handlers may now throw a
JsonRpcResponseError to signal an explicit JSON-RPC error envelope
(code/message/data). Generic thrown values still collapse to -32603
"handler error: ..." — Pre-3 is purely additive.

Scope: only packages/app-server-client/{src,test}. No core/runtime/
daemon work; no broker; no method-name literals.

T9a's ApprovalBroker depends on this so a "method not in dispatch
table" case can be signaled as -32601 without hardcoding approval
method names. T9b §9b.3 distinguishes generic-throw (-32603) from
explicit JsonRpcResponseError-throw (preserve code).
```

After merging Pre-3, T9a starts on top of it.

---

## 1. Decision Log (Phase 1)

Numbering continues from Phase 0 (D1–D4). Each decision must have a write-up in `docs/superpowers/plans/decision-log.md` after merge.

### D5 — EventNormalizer backpressure: single FIFO queue with class-aware walk-and-drop (revised twice; final after Codex outside-voice 2026-04-30, blocker B4)

**Question:** When raw notifications arrive faster than the async iterator consumer drains, what happens?

**Options considered (full history):**
- (A) Unbounded queue — risk OOM under 1000-delta/sec scenarios
- (B) Single bounded queue, drop oldest on overflow — risks dropping load-bearing lifecycle events (e.g. `turn/started`, `item/*/requestApproval`)
- (C) Backpressure to `client.onNotification` — impossible; notifications are stateless callbacks
- (D) Two-class FIFO + lifecycle-drains-first scheduler — **rejected by Codex B4** because draining lifecycle before delta reorders deltas around lifecycle events, contradicting the ordered-iterator goal
- (E) Single FIFO queue with class-aware walk-and-drop — **adopted**

**Decision:** **E**. There is exactly **one** FIFO queue. Order is preserved globally across both classes. Backpressure works by scanning, not by reordering.

Each notification carries a class assigned via a type-checked exhaustive `METHOD_CLASS: Record<ServerNotification["method"], "lifecycle" | "delta">` (D7-style — adding a new union member without classifying it is a TypeScript compile error). The class affects **only** the eviction policy:

- Default delta soft cap: 4096. Default total hard cap: 16384.
- On enqueue:
  - If `deltaCount >= deltaSoftCap`: walk forward from queue head, find the **oldest delta-class entry**, splice it out (preserving order of all other entries), decrement counter. Insert a `{ type: "normalizer_overflow", droppedCount, class: "delta" }` synthetic event at the spliced position so downstream renderers see the gap **at the right place in the stream**. Then enqueue the new event at the tail.
  - If after that the queue still has `length >= totalHardCap` (lifecycle saturation — should be impossible in practice under codex 0.125): emit a fatal-class synthetic `{ type: "normalizer_overflow", droppedCount, class: "lifecycle" }`, drop the oldest entry regardless of class, and log at error level. This branch indicates a real bug, not normal load.
- On drain: simple FIFO. No scheduler, no priority. Consumer sees events in arrival order, with overflow synthetics inserted **in place** of dropped entries.

**Reason:** Codex B4 was correct — the previous two-class drain-priority design was fundamentally broken. A consumer that depends on "delta_K appears between item_started and turn_completed" cannot tolerate the normalizer reordering them. Single FIFO preserves every causal invariant the wire produces. Walk-and-drop is O(N) per overflow event, but overflow is the rare path; the common path stays O(1) enqueue+dequeue.

Cost vs. previous (rejected) two-queue design: roughly the same code (~30 LOC), strictly more correct.

### D6 — Supervisor recovery on transport close: pending turn fails open, no auto-resume

**Question:** Codex child exits mid-turn. Supervisor spawns new client. What happens to the pending turn?

**Options considered:**
- (A) `thread/resume` + retry the turn — risk double-billing, double-side-effect
- (B) Mark pending turn as `failed (transport_lost)`, emit synthetic terminal event, await user re-trigger
- (C) Cache pending turn, attempt resume only if codex offers idempotency token — codex 0.125 does not

**Decision:** **B**. Daemon supervisor never auto-retries turns. ApprovalBroker pending-approval entries also fail with `decision: denied (transport_lost)` so codex doesn't get stale approvals when it restarts.

**Reason:** Phase 1 has no IM-side replay/idempotency story; better to surface the failure than silently double-execute. Phase 2+ may revisit when SessionRouter exists.

### D7 — `ApprovalBroker` method-name discrimination via generated union, with one well-defined fallback path

**Question:** `ServerRequest.ts` will gain new union arms when codex upgrades. How do we avoid silent fall-through?

**Decision:** ApprovalBroker owns a `Record<ServerRequest["method"], ApprovalDispatcher>` whose key type is the literal union from generated `ServerRequest`. New union members → TypeScript compile error → forces explicit registration. Unknown-at-runtime (defensive only) → audit-log + `respond(id, error: -32601 "no handler")` (matching Phase 0 client-layer default-reject behavior).

**Reason:** 05-PROTOCOL §4 strong constraint. Type-level enforcement prevents the historical drift (e.g. `"approval/request"` ghost method) from recurring.

### D8 — `codex-runtime` exposes events as `AsyncIterable<CodexRichEvent>`, not `EventEmitter`

**Question:** Phase 0 `client.onNotification` is callback-style. Phase 1 layer above it can be the same, async iterator, or RxJS-style.

**Decision:** **AsyncIterable**. `for await (const ev of runtime.events()) { ... }` aligns with terminal-state recognition (iterator closes on `turn/completed`/`thread/closed`/transport-close). Per-thread / per-turn filtered sub-iterators built on the same primitive.

**Reason:** Matches CodexRuntime user story ("await every event in order until terminal"); EventEmitter loses ordering across awaitable consumers; Rx is overkill for Phase 1.

### D9 — `categorizeJsonRpcError` is a pure helper in `app-server-client/errors.ts`, not a class

**Decision:** Pure function `categorizeJsonRpcError(err: JsonRpcResponseError): ErrorCategory`. No state. Returns discriminated union `{ category: "method-not-found" | "invalid-params" | "invalid-request" | "internal-error" | "unknown", code: number, message: string }`. Malformed JSON wire frames are explicitly **out of scope** — they reach `StdioTransport.logger.warn`, never `JsonRpcResponseError`.

---

## 2. File Structure

### 2.1 New packages

```text
packages/codex-runtime/
  package.json                    # name: @codex-im/codex-runtime
  tsconfig.json                   # composite; references protocol + app-server-client + testkit (devDep)
  src/index.ts                    # facade, named exports only
  src/types.ts                    # CodexRichEvent discriminated union, ThreadRef, TurnRef, RuntimeOptions
  src/event-normalizer.ts         # EventNormalizer class + AsyncIterable
  src/runtime.ts                  # CodexRuntime class — typed wrappers + state machine
  src/state.ts                    # internal thread/turn/item maps; pure data, no I/O
  src/method-names.ts             # narrowing helpers over ClientRequest / ServerNotification union
  test/event-normalizer.test.ts   # unit, fake transport
  test/event-normalizer-fixture.test.ts  # contract, replays packages/testkit fixtures
  test/runtime.test.ts            # unit, fake transport
  test/runtime-fixture.test.ts    # contract
  README.md                       # surface map + Phase 1 scope
  vitest.config.ts                # extends root projects pattern

packages/core/
  package.json                    # name: @codex-im/core
  tsconfig.json
  src/index.ts                    # facade
  src/types.ts                    # ApprovalRecord, ApprovalDecision (IM-layer enum), ApprovalDispatcher
  src/approval-broker.ts          # ApprovalBroker class
  src/security-policy.ts          # placeholder interface only — Phase 3 fills in
  test/approval-broker.test.ts            # unit, FakeAppServer.emitServerRequest round-trip
  test/approval-broker-dispatch.test.ts   # exhaustive method dispatch
  test/approval-broker-fixture.test.ts    # contract; replays fixture with a captured server-request
  README.md
  vitest.config.ts

packages/daemon/
  package.json                    # name: @codex-im/daemon
  tsconfig.json
  src/index.ts                    # entrypoint stub (Phase 1 = unit-test only, no spawn)
  src/supervisor.ts               # Supervisor class — ONE-SHOT lifecycle
  src/types.ts
  test/supervisor.test.ts         # unit, in-memory transport + injected client factory
  README.md
  vitest.config.ts
```

### 2.2 Existing packages — modify

```text
packages/app-server-client/
  src/errors.ts                   # ADD categorizeJsonRpcError + ErrorCategory union
  src/index.ts                    # ADD export
  test/categorize-error.test.ts   # NEW — coverage for unknown variant / missing field / invalid type / unknown field / -32603 / unknown
  README.md                       # NEW (was missing) — surface map for Phase 1 readers

packages/testkit/
  fixtures/codex-0.125.0/                # version-pinned dir preserved (P0-2 — DO NOT split per phase)
    phase1-richer-turn-event-stream.jsonl    # NEW — captured Phase 1, replaces placeholder
    phase1-richer-turn-server-request.jsonl  # NEW — captured server-initiated approval round
    metadata.json                            # UPDATE — declare new fixtures
  src/fixture-loader.ts                  # MAYBE-ADD typed loader if absent
  test/fixture-replay.test.ts            # ADD assertions over new fixtures
  README.md                              # NEW — surface map + naming rule "<phase>-<scenario>-<frame-type>.jsonl" under <version>/

packages/cli/
  src/runtime-send.ts             # NEW — `codex-im runtime send` command
  src/smoke-real-turn.ts          # MODIFY — accept --capture <path> flag (P1.6 capture tool)
  src/index.ts                    # MODIFY — wire `runtime send` subcommand
  src/prompts/richer-turn.txt     # NEW — fixture-capture prompt
  README.md                       # MODIFY — document runtime send + --capture
```

### 2.3 Workspace / root

```text
package.json                      # ADD scripts: runtime:send, smoke:real-turn:capture, check:all
pnpm-workspace.yaml               # already covers packages/* — no change
tsconfig.base.json                # no change expected
biome.json / .biome*              # no change expected
scripts/ci-check.sh               # NEW (P1-4) — local "did your worktree pass everything?" gate; bundles check:codex-version + typecheck + test + lint + protocol:check; subagents must run before claiming done
scripts/redact-fixture.mjs        # NEW (P1-5) — JSONL filter that scrubs absolute paths + model names; T4 capture pipes through it
scripts/redact-fixture.test.mjs   # NEW (P1-5) — round-trip test on a known dirty fixture; runs as part of pnpm test
scripts/split-capture.mts         # NEW (Codex B2) — JSON-aware splitter; reads raw capture JSONL, emits two JSONL streams (notifications vs server-initiated requests). Replaces unsafe grep pipeline.
scripts/verify-phase1-fixtures.mts # NEW (Codex B1) — committed tsx script that backs T4.5 acceptance gate; type-checks fixture frames against generated ServerRequest["method"] union; requires ≥1 approval-capable method
docs/handoffs/2026-04-30-phase0-to-phase1.md   # source of truth — DO NOT MODIFY here
docs/superpowers/plans/decision-log.md         # APPEND D5 (revised), D6, D7, D8, D9 after merge
docs/phase-1/                     # NEW — Codex outside-voice + plan-eng-review + fixture-prompt-review reports
  fixture-prompt-review.md        # T4 step 4.2 output
  event-normalizer-review.md      # T7b step output
  approval-broker-review.md       # T9b step output
05-CODEX-APP-SERVER-PROTOCOL.md   # MODIFY §3/§4.1 only after fixture capture lands real shapes
09-ROADMAP.md                     # MODIFY Phase 1 verification matrix after merge (mark done)
TODOS.md                          # MOVE Phase 1 items to "Done in Phase 1" after merge
```

### 2.4 Files explicitly **not** touched in Phase 1

- `packages/app-server-client/src/client.ts` — Phase 0 contract, only consumed
- `packages/app-server-client/src/jsonl.ts` — Phase 0 contract
- `packages/app-server-client/src/transport.ts` / `stdio-transport.ts` — Phase 0 contract
- `packages/app-server-client/src/handshake.ts` — Phase 0 contract
- `packages/codex-protocol/src/generated/**` — generated, only consumed
- `scripts/canonicalize-schema.mjs`, `scripts/check-codex-version.mjs` — Phase 0 contract

---

## 3. Module Boundaries

```text
┌─────────────────────────────────────────────────┐
│ packages/daemon — Supervisor (Phase 1.4)        │
│   owns: process supervision, client recreation  │
│   delegates: nothing (top of Phase 1 stack)     │
└──────────────┬──────────────────────────────────┘
               │ owns lifecycle of:
               ▼
┌─────────────────────────────────────────────────┐
│ packages/codex-runtime — Runtime + Normalizer   │
│   owns: thread/turn/item state, event ordering  │
│   delegates: AppServerClient (Phase 0)          │
└──────────────┬──────────────────────────────────┘
               │ subscribes / requests via:
               ▼
┌─────────────────────────────────────────────────┐
│ packages/core — ApprovalBroker                  │
│   owns: ALL server-request dispatch             │
│   delegates: AppServerClient.setServerRequestHandler (Phase 0)│
│   Phase 1: SecurityPolicy is a noop interface   │
└──────────────┬──────────────────────────────────┘
               │ wraps:
               ▼
┌─────────────────────────────────────────────────┐
│ packages/app-server-client — Phase 0 contract   │
│   + categorizeJsonRpcError (additive only)      │
└──────────────┬──────────────────────────────────┘
               │ wire:
               ▼
              codex app-server (subprocess, JSONL)
```

**Single-handler invariant:** Only `ApprovalBroker.handleServerRequest` is registered with `client.setServerRequestHandler`. `EventNormalizer` registers via `client.onNotification`. `CodexRuntime` exposes the normalizer's iterator + the broker — it does **not** subscribe to client primitives directly.

---

## 4. Task Order & Dependencies

Granularity target: each task = 1 git commit, 2–5 min of execution time per step (10–25 min per task). Engineer should run TDD at each step.

### Dependency graph (revised after Codex outside-voice 2026-04-30: Pre-1 + Pre-2 prerequisites; T6 derives from METHOD_CLASS; Supervisor uses transport.onClose)

```text
PRE-1 (Node 24 bump, separate PR off phase-0-bootstrap) ──┐
                                                            │  both must merge before any Phase 1 task runs
PRE-2 (@codex-im/protocol facade expansion, separate PR) ─┘
                                              │
                                              ▼
T1 (categorizeJsonRpcError) ───┐   ← first Phase 1 task to land; ErrorCategory used by T7b/T9b/T11b tests
T2 (CLI flags: --capture / --prompt-file / --cwd) ───┤
T3 (codex-runtime skeleton) ───┼──► T4 (fixture spike, lead, real $) ──► T4.5 (verify-phase1-fixtures.mts gate, lead) ──┐
T5 (core skeleton)          ───┘                                                                                          │
                                                                                                                           ▼
                                                                                                            T6 (METHOD_CLASS-derived isServerNotificationMethod)
                                                                                                                                │
              ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────┐
              ▼                                                                                                                 ▼                               ▼
   T7a (Normalizer skeleton + single FIFO + happy path)                          T8 (CodexRuntime wrappers — turn/interrupt not thread/interrupt)     T9a (Broker skeleton + exhaustive Record<ServerRequest['method']> + dispatch coverage)
              │                                                                                                                                                 │
              ▼                                                                                                                                                 ▼
   T7b (walk-and-drop overflow + unknown + terminal semantics + ordering tests + reviews)                            T9b (timeout + throw + transport-loss + per-method v2 response mappers + reviews)
              └─────────────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                                                                                    ▼
                                                                                                          T10 (codex-im runtime send)
                                                                                                                    │
                                                                                                                    ▼
                                                                                                          T11a (Supervisor skeleton — owns transport spawn; subscribes to transport.onClose; never depends on client.onClose)
                                                                                                                    │
                                                                                                                    ▼
                                                                                                          T11b (backoff + halt + transport-loss propagation + close-idempotence test + outside-voice review)
                                                                                                                    │
                                                                                                                    ▼
                                                                                                          T12 (docs + roadmap update)
```

### Parallelization windows

- **Pre-Phase-1 (sequential, lead-only):** Pre-1 (Node bump) → Pre-2 (protocol facade). Each is its own PR with its own Phase 0 gate re-run. **No Phase 1 task starts until both merge.**
- **Phase 1A (parallel, no deps after Pre-1+Pre-2):** T1, T2, T3, T5 — four worktrees concurrently. T1 should land first since later tests reference its `ErrorCategory` type.
- **Phase 1B (sequential gate, lead-only):** T4 → **T4.5 acceptance gate** — single worktree, real codex spawn. T4.5 must pass (≥1 valid `ServerRequest` frame matching generated `ServerRequest["method"]` union, **and** ≥1 of the approval-capable method subset) before any T7/T9 work.
- **Phase 1B′ (sequential after T3):** T6.
- **Phase 1C (parallel, T4.5+T6 done):** T7a → T7b, T8, T9a → T9b — three lanes concurrently. Each lane is internally sequential (skeleton before edges). **Pre-3 sits on this boundary**: discovered after T8, gates T9a. T7/T8 lanes are unaffected; only the T9 lane waits for Pre-3 to merge.
- **Phase 1D (sequential):** T10 → T11a → T11b → T12.

### Subagent / outside-voice / review assignment

| Task | Implementation | Review |
|---|---|---|
| T1 categorizeJsonRpcError | subagent (pure helper) | inline |
| T2 --capture flag | subagent | inline |
| T3 codex-runtime skeleton | subagent | inline (must include `scripts/ci-check.sh` + `scripts/redact-fixture.mjs` per P1-4/P1-5) |
| T4 fixture spike | **lead session only** (real $ + sandbox config) | **Codex outside voice** for prompt design (T4 step 4.2) |
| T4.5 fixture acceptance gate | **lead session only** | inline (one-step task; cannot be subagent-delegated) |
| T5 core skeleton | subagent | inline |
| T6 method-name helpers | self | inline |
| T7a Normalizer skeleton | **lead session** | inline |
| T7b Normalizer edges + 2-class queue | **lead session** | **`/plan-eng-review` + Codex outside voice** before merge |
| T8 CodexRuntime wrappers | subagent | inline |
| T9a Broker skeleton + happy path | **lead session** | inline |
| T9b Broker edges + reviews | **lead session** | **`/plan-eng-review` + Codex outside voice** before merge |
| T10 runtime send CLI | subagent | inline |
| T11a Supervisor skeleton | **lead session** | inline |
| T11b Supervisor edges + reviews | **lead session** (lifecycle correctness critical) | **Codex outside voice** for failure modes |
| T12 docs + roadmap | subagent | inline |

**Phase exit gate (before tagging `phase-1-runtime-complete`):** full Codex outside-voice on integrated diff (`codex review`), gstack `/plan-eng-review` on combined plan-vs-actual, `pnpm audit` re-baseline, all packages pass `bash scripts/ci-check.sh`.

---

## 5. Tasks

### Task 1: `categorizeJsonRpcError` helper (P1.5)

**Order:** First task to land in Phase 1A. `ErrorCategory` is referenced by T7b/T9b/T11b tests, so completing T1 first eliminates cross-worktree staging conflicts.

**Files:**
- Create: `packages/app-server-client/test/categorize-error.test.ts`
- Modify: `packages/app-server-client/src/errors.ts`
- Modify: `packages/app-server-client/src/index.ts`

- [ ] **Step 1.1: Write failing test for `unknown variant` → method-not-found**

```ts
// packages/app-server-client/test/categorize-error.test.ts
import { describe, expect, it } from "vitest";
import { categorizeJsonRpcError, JsonRpcResponseError } from "../src/index.js";

describe("categorizeJsonRpcError", () => {
  it("classifies -32600 with 'unknown variant' as method-not-found", () => {
    const err = new JsonRpcResponseError(-32600, "unknown variant `foo`");
    expect(categorizeJsonRpcError(err)).toEqual({
      category: "method-not-found",
      code: -32600,
      message: "unknown variant `foo`",
    });
  });
});
```

- [ ] **Step 1.2: Run, verify FAIL**

Run: `pnpm --filter @codex-im/app-server-client test --run categorize-error`
Expected: `categorizeJsonRpcError is not a function` or import error.

- [ ] **Step 1.3: Implement minimal helper**

```ts
// packages/app-server-client/src/errors.ts (add to existing file)
export type ErrorCategory =
  | { category: "method-not-found"; code: number; message: string }
  | { category: "invalid-params"; code: number; message: string }
  | { category: "invalid-request"; code: number; message: string }
  | { category: "internal-error"; code: number; message: string }
  | { category: "unknown"; code: number; message: string };

export function categorizeJsonRpcError(err: JsonRpcResponseError): ErrorCategory {
  const { code, message } = err;
  if (code === -32600) {
    if (message.includes("unknown variant")) return { category: "method-not-found", code, message };
    if (message.includes("missing field") || message.includes("invalid type") || message.includes("unknown field")) {
      return { category: "invalid-params", code, message };
    }
    return { category: "invalid-request", code, message };
  }
  if (code === -32603) return { category: "internal-error", code, message };
  return { category: "unknown", code, message };
}
```

- [ ] **Step 1.4: Re-export from index**

```ts
// packages/app-server-client/src/index.ts (add)
export { categorizeJsonRpcError, type ErrorCategory } from "./errors.js";
```

- [ ] **Step 1.5: Add remaining test cases (one per category) — all initially failing if any branch wrong**

Cover: `missing field`, `invalid type`, `unknown field`, generic -32600 → invalid-request, -32603 → internal-error, -32700 → unknown, helper does not throw on empty message.

- [ ] **Step 1.6: Run all tests, verify PASS**

Run: `pnpm --filter @codex-im/app-server-client test --run`
Expected: all green incl. existing Phase 0 tests.

- [ ] **Step 1.7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 1.8: Commit**

```bash
git add packages/app-server-client/src/errors.ts packages/app-server-client/src/index.ts packages/app-server-client/test/categorize-error.test.ts
git commit -m "feat(app-server-client): categorizeJsonRpcError helper (P1.5)

Maps -32600 overload (unknown method vs invalid params vs invalid
request) using error.message keyword match per Phase 0 wire spike
case 3+4. Pure helper, no state."
```

**Exit criteria:** all categorize-error.test.ts cases pass; typecheck + lint green; helper exported from package index.

---

### Task 2: CLI capture flags — `--capture`, `--prompt-file`, `--cwd` (P1.6 capture tool; expanded after Codex B2 + required-change)

**Files:**
- Modify: `packages/cli/src/smoke-real-turn.ts`
- Modify: `packages/cli/src/index.ts` (subcommand wiring)
- Modify: `packages/cli/README.md`
- Modify: `vitest.config.ts` — **rename** `packages/cli/test/smoke-*.test.ts` exclusion so it stays excluded from `unit` project (those tests spawn real subprocesses), but **add** new pure-unit tests for the flag parsing under a different name pattern (`packages/cli/test/cli-flags.test.ts`) that runs in default unit project.
- Create: `packages/cli/test/cli-flags.test.ts` (pure unit — argv parsing, no subprocess)
- Create: `packages/cli/test/smoke-real-turn-capture.test.ts` (subprocess-style test using `InMemoryTransport`; lives under the existing `smoke-*` exclude pattern, runs only via dedicated script — Codex required change to **not** exclude flag-handling tests from default gate)

- [ ] **Step 2.1: Decide test placement.**

Codex B2 noted that `vitest.config.ts:14` excludes `packages/cli/test/smoke-*.test.ts` from the default unit run. Pure flag-parsing tests **must** be in the default gate. The decision:
- `cli-flags.test.ts` — pure argv parsing (no transport, no subprocess) — included in default unit project.
- `smoke-real-turn-capture.test.ts` — uses `InMemoryTransport` to assert capture-stream writes; included under the `smoke-*` exclude (because future iterations may grow into subprocess work). Run explicitly via `pnpm test:cli-smoke` (new script) and required by `bash scripts/ci-check.sh`.

- [ ] **Step 2.2: Write failing pure-unit test — argv parsing.**

```ts
// packages/cli/test/cli-flags.test.ts
import { describe, expect, it } from "vitest";
import { parseSmokeRealTurnArgs } from "../src/smoke-real-turn.js";

describe("smoke-real-turn argv parsing", () => {
  it("accepts --capture <path>", () => {
    expect(parseSmokeRealTurnArgs(["--capture", "/tmp/out.jsonl"])).toMatchObject({
      capturePath: "/tmp/out.jsonl",
    });
  });
  it("accepts --prompt-file <path>", () => {
    expect(parseSmokeRealTurnArgs(["--prompt-file", "packages/cli/src/prompts/richer-turn.txt"])).toMatchObject({
      promptFile: "packages/cli/src/prompts/richer-turn.txt",
    });
  });
  it("accepts --cwd <path> for the codex subprocess working dir", () => {
    expect(parseSmokeRealTurnArgs(["--cwd", "/tmp/codex-fixture-spike"])).toMatchObject({
      subprocessCwd: "/tmp/codex-fixture-spike",
    });
  });
  it("accepts all three together in any order", () => {
    expect(parseSmokeRealTurnArgs([
      "--cwd", "/tmp/x",
      "--capture", "/tmp/cap.jsonl",
      "--prompt-file", "p.txt",
    ])).toMatchObject({
      subprocessCwd: "/tmp/x",
      capturePath: "/tmp/cap.jsonl",
      promptFile: "p.txt",
    });
  });
  it("rejects unknown flags loudly", () => {
    expect(() => parseSmokeRealTurnArgs(["--bogus"])).toThrow(/unknown flag/);
  });
});
```

- [ ] **Step 2.3: Verify FAIL** (`parseSmokeRealTurnArgs` not exported).
- [ ] **Step 2.4: Refactor `smoke-real-turn.ts`:**
  - Extract pure `parseSmokeRealTurnArgs(argv: string[]): SmokeOptions` (no I/O).
  - Add `runSmokeRealTurnWithCapture` injectable transport factory + capture writer (file write stream piping `JSON.stringify(msg) + "\n"` per inbound message).
  - Wire `--prompt-file` to `readFileSync(promptFile, "utf8")` for the `turn/start` input text (replaces hardcoded "Reply OK" when the flag is present).
  - Wire `--cwd` to the `StdioTransport` spawn options (`{ cwd: subprocessCwd }`); does NOT change the harness's own working dir.
- [ ] **Step 2.5: Verify unit test passes.**
- [ ] **Step 2.6: Add `smoke-real-turn-capture.test.ts` (transport-injected, no subprocess)** — assert `runSmokeRealTurnWithCapture({ transport: new InMemoryTransport(), capturePath, ... })` writes one JSONL line per inbound message and exits cleanly.
- [ ] **Step 2.7: Update `vitest.config.ts`** — keep `smoke-*.test.ts` excluded from `unit` project (subprocess concern); add a third project `cli-smoke` that includes only `packages/cli/test/smoke-*.test.ts` and runs via `pnpm test:cli-smoke`. Add this to `scripts/ci-check.sh` so it runs in the local gate.
- [ ] **Step 2.8: Update `packages/cli/README.md`** documenting all three flags and the `--cwd` semantics: "applies only to the spawned codex subprocess, not the harness itself".
- [ ] **Step 2.9: `bash scripts/ci-check.sh` — exit 0** (runs unit + contract + new cli-smoke project).
- [ ] **Step 2.10: Commit.**

```bash
git commit -m "feat(cli): smoke:real-turn --capture/--prompt-file/--cwd (P1.6 part 1, Codex B2)

Pure parseSmokeRealTurnArgs extracted into default unit gate.
runSmokeRealTurnWithCapture injectable transport + capture writer.
--cwd applies only to spawned codex subprocess, not harness.
New cli-smoke vitest project covers transport-injected smoke test.
ci-check.sh runs unit + contract + cli-smoke."
```

**Exit criteria:** flag-parsing unit tests run in the **default** `pnpm test`; capture flow tested with `InMemoryTransport`; CLI accepts all three flags; README documents semantics; default behavior unchanged when no flags passed.

---

### Task 3: `packages/codex-runtime` package skeleton

**Files:**
- Create: `packages/codex-runtime/package.json`
- Create: `packages/codex-runtime/tsconfig.json`
- Create: `packages/codex-runtime/src/index.ts`
- Create: `packages/codex-runtime/src/types.ts`
- Create: `packages/codex-runtime/README.md`
- Create: `packages/codex-runtime/vitest.config.ts`
- Create: `packages/codex-runtime/test/skeleton.test.ts`

- [ ] **Step 3.1: Write failing test — package importable, exports `CodexRichEvent` type**

```ts
// packages/codex-runtime/test/skeleton.test.ts
import { describe, expect, it } from "vitest";
import * as runtime from "../src/index.js";

describe("@codex-im/codex-runtime skeleton", () => {
  it("exports type-only surface for CodexRichEvent", () => {
    // type-level assertion via runtime sentinel
    expect(typeof runtime).toBe("object");
  });
});
```

- [ ] **Step 3.2: Create `package.json` (mirror `packages/app-server-client/package.json`).**

```json
{
  "name": "@codex-im/codex-runtime",
  "version": "0.1.0-phase1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "lint": "biome check src test"
  },
  "dependencies": {
    "@codex-im/protocol": "workspace:*",
    "@codex-im/app-server-client": "workspace:*"
  },
  "devDependencies": {
    "@codex-im/testkit": "workspace:*",
    "vitest": "^4.1.5",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3.3: Create `tsconfig.json` extending `tsconfig.base.json` with composite + project references to protocol + app-server-client.**
- [ ] **Step 3.4: Create `src/types.ts` (discriminated union skeleton — only stubs for now)**

```ts
// packages/codex-runtime/src/types.ts
export type CodexRichEvent =
  | { type: "thread_started"; threadId: string; raw: unknown }
  | { type: "thread_closed"; threadId: string; raw: unknown; terminal: true }
  | { type: "turn_started"; threadId: string; turnId: string; raw: unknown }
  | { type: "turn_completed"; threadId: string; turnId: string; raw: unknown; terminal: true }
  | { type: "item_started"; threadId: string; turnId: string; itemId: string; raw: unknown }
  | { type: "item_completed"; threadId: string; turnId: string; itemId: string; raw: unknown }
  | { type: "agent_message_delta"; threadId: string; turnId: string; itemId: string; deltaText: string; raw: unknown }
  | { type: "warning"; raw: unknown }
  | { type: "error"; raw: unknown }
  | { type: "normalizer_overflow"; droppedCount: number; class: "delta" }   // D5 (revised): only delta class can overflow
  | { type: "unknown"; method: string; params: unknown };

// D5 (revised) classification table — domain MUST equal ServerNotification["method"] union
// (compile-time enforced; new method without classification = TS error)
export type EventClass = "lifecycle" | "delta";
export type MethodClassification = Readonly<Record<string /* ServerNotification['method'] */, EventClass>>;

- [ ] **Step 3.5: Create `src/index.ts`**

```ts
// packages/codex-runtime/src/index.ts
export type { CodexRichEvent } from "./types.js";
```

- [ ] **Step 3.6: Add to `pnpm-workspace.yaml` — already `packages/*`, no change.**
- [ ] **Step 3.7: Create `scripts/ci-check.sh` (P1-4)** — repo-wide local gate that bundles:

```bash
#!/usr/bin/env bash
# scripts/ci-check.sh — local "did your worktree pass everything?" gate.
# Every subagent MUST run this before claiming a task complete.
set -euo pipefail
pnpm check:codex-version
pnpm typecheck
pnpm test
pnpm lint
pnpm protocol:check
echo "ci-check: all gates green"
```

Make it executable (`chmod +x scripts/ci-check.sh`). Add `"check:all": "bash scripts/ci-check.sh"` to root `package.json` scripts.

- [ ] **Step 3.8: Create `scripts/redact-fixture.mjs` + `scripts/redact-fixture.test.mjs` (P1-5)** — JSONL filter for T4 capture. Stdin → stdout. Replaces:
  - absolute paths matching `/Users/`, `/home/`, `/private/var/folders/`, `/tmp/codex-fixture-*` → `<CWD>`
  - model names matching `gpt-*`, `o1-*`, `o3-*`, `o4-*`, `claude-*` → `<MODEL>`
  - leaves wire IDs / methods / params shape untouched
  Test: round-trip a known dirty JSONL fixture; assert idempotent (running twice == once).
- [ ] **Step 3.9: Run `pnpm install`, then `bash scripts/ci-check.sh` — must exit 0 (this is the new local gate going forward).**
- [ ] **Step 3.10: Commit.**

```bash
git commit -m "feat(codex-runtime): package skeleton + ci-check + redact-fixture (P1 prep)

Creates @codex-im/codex-runtime with CodexRichEvent type union skeleton.
Adds scripts/ci-check.sh as the local subagent gate (P1-4) and
scripts/redact-fixture.mjs as the T4 capture sanitizer (P1-5).
No runtime logic yet — wired into pnpm workspace, typecheck + biome clean."
```

**Exit criteria:** package builds + typechecks; skeleton test passes; `bash scripts/ci-check.sh` exits 0; redact-fixture round-trip test passes; both scripts importable from any worktree.

---

### Task 4: Fixture spike — capture richer wire fixtures (P1.6 part 2) **[lead session, real codex]**

**Prerequisites:** T1, T2, T3 merged (so `scripts/redact-fixture.mjs` and `scripts/ci-check.sh` exist). `codex login` fresh. Quota verified. Repo on a temp `fixture-spike` branch off `phase-0-bootstrap` so no half-baked fixture pollutes Phase 1 PRs.

**Naming rule (P0-2):** fixtures stay under the version-pinned dir `packages/testkit/fixtures/codex-0.125.0/`. Phase tracing goes in the **filename** as `<phase>-<scenario>-<frame-type>.jsonl`. This preserves the `replayFixture(version, name)` contract and the codex-version → fixture-set link.

**Files:**
- Create: `packages/cli/src/prompts/richer-turn.txt`
- Create: `packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl` (captured, redacted)
- Create: `packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl` (captured, redacted)
- Modify: `packages/testkit/fixtures/codex-0.125.0/metadata.json`
- Modify: `packages/testkit/test/fixture-replay.test.ts`

- [ ] **Step 4.1: Design prompt — write `prompts/richer-turn.txt`**

Goal of prompt: trigger ≥1 of each of:
- `item/agentMessage/delta` (model writes prose)
- `item/started` + `item/completed` for a shell exec item
- `item/commandExecution/outputDelta` (codex 0.125 schema may emit this)
- `item/fileChange/patchUpdated` (codex proposes a patch)
- `item/{commandExecution,fileChange}/requestApproval` (server-initiated request)

Prompt skeleton: "in a sandboxed scratch dir, propose adding a single-file `hello.txt` containing 'hi' and propose running `ls -la`. Do not actually execute anything; await my approval."

⚠ This is a Phase 0 outside-voice consultation point — **before running**, send `codex consult` with the prompt + safety constraints (sandbox=read-only, approval_policy=on-request, scratch dir under `/tmp/codex-fixture-XXXX`) and ask "will this trigger ≥1 server-initiated approval without taking destructive action".

- [ ] **Step 4.2: Codex outside-voice consult — record verdict in `docs/phase-1/fixture-prompt-review.md`.**
- [ ] **Step 4.3: Run capture (Codex B2 — fixed: stay in repo for pnpm + paths; pass --cwd to subprocess for sandboxing):**

```bash
# from repo root — pnpm needs the workspace, paths must be repo-relative
mkdir -p /tmp/codex-fixture-spike
CODEX_REAL_SMOKE=1 pnpm --filter @codex-im/cli smoke:real-turn -- \
  --capture /tmp/codex-fixture-spike/raw-stream.jsonl \
  --prompt-file packages/cli/src/prompts/richer-turn.txt \
  --cwd /tmp/codex-fixture-spike
```

`--cwd` (added in T2) puts the **codex subprocess** in the scratch dir while the harness keeps using repo-relative paths for `--prompt-file` and `pnpm --filter` resolution.

Expected: real codex spawn, ≥1 approval request, all events captured, smoke exits cleanly with default-reject.

- [ ] **Step 4.4: Inspect raw capture — confirm presence of:**
  - `turn/started`
  - ≥1 `item/agentMessage/delta`
  - ≥1 `item/{commandExecution|fileChange}/requestApproval`
  - `turn/completed`
- [ ] **Step 4.5: Split capture into two fixtures via the JSON-aware splitter + redact (P1-5; Codex B2 — grep replaced with JSON parser since wire frames can have nested objects with embedded `"method"` strings).**

`phase1-richer-turn-event-stream.jsonl` = notifications (no `id` field) only.
`phase1-richer-turn-server-request.jsonl` = the server-initiated request frames (have `id` AND `method`) only.

`scripts/split-capture.mts` (created in T3 alongside redact-fixture.mjs) does this with a real JSON parser:

```ts
// scripts/split-capture.mts (committed; usage: tsx scripts/split-capture.mts <in> <notifications-out> <requests-out>)
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, notifOut, reqOut] = process.argv;
if (!inPath || !notifOut || !reqOut) {
  console.error("usage: tsx scripts/split-capture.mts <raw> <notif-out> <req-out>");
  process.exit(2);
}

const lines = readFileSync(inPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
const notifications: string[] = [];
const requests: string[] = [];
for (const line of lines) {
  let frame: unknown;
  try { frame = JSON.parse(line); } catch { continue; }   // skip non-JSON noise
  if (typeof frame !== "object" || frame === null) continue;
  const f = frame as Record<string, unknown>;
  // Server-initiated request: has both id AND method (top-level keys).
  // Notification: has method but no id (top-level).
  // Response: has id but no method — skip (T4 raw stream may include client-side responses).
  if ("method" in f && "id" in f) requests.push(line);
  else if ("method" in f && !("id" in f)) notifications.push(line);
}

writeFileSync(notifOut, notifications.join("\n") + (notifications.length ? "\n" : ""));
writeFileSync(reqOut, requests.join("\n") + (requests.length ? "\n" : ""));
console.log(`split: ${notifications.length} notifications, ${requests.length} server-requests`);
```

Then redact:

```bash
# Split + redact pipeline (Codex B2 — JSON-aware, no grep)
pnpm exec tsx scripts/split-capture.mts \
  /tmp/codex-fixture-spike/raw-stream.jsonl \
  /tmp/codex-fixture-spike/notifications.raw.jsonl \
  /tmp/codex-fixture-spike/requests.raw.jsonl

node scripts/redact-fixture.mjs < /tmp/codex-fixture-spike/notifications.raw.jsonl \
  > packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl

node scripts/redact-fixture.mjs < /tmp/codex-fixture-spike/requests.raw.jsonl \
  > packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl

# Idempotency check — running redact on the output should yield no diff
node scripts/redact-fixture.mjs < packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl \
  | diff - packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl
```

Then `git diff` the resulting files manually as a final sanity check before commit.

- [ ] **Step 4.6: Update `metadata.json` to declare new fixtures (under `codex-0.125.0`).**
- [ ] **Step 4.7: Update `fixture-replay.test.ts` to load + parse both new fixtures (no semantic assertions yet — just "no throw").**
- [ ] **Step 4.8: Re-run `bash scripts/ci-check.sh` — all green.**
- [ ] **Step 4.9: Commit.**

```bash
git commit -m "fixture(testkit): phase1 richer turn + server-request capture (P1.6)

Captured against codex 0.125.0 with sandbox=read-only +
approval_policy=on-request. Replaces harmless-turn placeholder.
Paths + model names redacted via scripts/redact-fixture.mjs.
Filenames phase-prefixed under version-pinned codex-0.125.0/ dir."
```

**Exit criteria:** ≥1 server-initiated approval frame in `phase1-richer-turn-server-request.jsonl`; ≥10 notification frames in `phase1-richer-turn-event-stream.jsonl` covering ≥3 distinct methods; replay test passes; no PII / absolute path leaks (verified by re-running redact script — output should be identical / idempotent); `bash scripts/ci-check.sh` exits 0.

**Rollback:** if capture fails to produce a server-request frame after 3 prompt iterations, revert to placeholder + open issue documenting which `approval_policy` setting reliably triggers the request. Do **not** fabricate a fixture. T4.5 (next) will hard-block T7/T9 if this happens.

---

### Task 4.5: Fixture acceptance gate via `scripts/verify-phase1-fixtures.mts` **[lead session]**

(NEW per plan-eng-review P1-2; rewritten after Codex B1 — committed `tsx` script, not inline `node -e`.) Hard-blocks T7/T9 if T4 didn't produce a usable server-request capture. Cannot be subagent-delegated.

**Files:**
- Create: `scripts/verify-phase1-fixtures.mts`
- Create: `scripts/verify-phase1-fixtures.test.mts` (negative test cases — Codex required-tests "Fixture gate negative tests")

- [ ] **Step 4.5.1: Author `scripts/verify-phase1-fixtures.mts`.**

The script does what `node -e` cannot:

```ts
// scripts/verify-phase1-fixtures.mts — runs as `pnpm exec tsx scripts/verify-phase1-fixtures.mts`
// Codex B1: committed verification, not inline.
import { readFileSync } from "node:fs";
import type { ServerRequest } from "@codex-im/protocol";

// Exhaustive runtime table over generated ServerRequest["method"] union.
// Adding a generated arm without a row here is a TS compile error (D7-style).
// Codex outside-voice noted: generated unions don't exist at runtime, so we
// derive an exhaustive Record<ServerRequest["method"], boolean>.
const APPROVAL_CAPABLE: Record<ServerRequest["method"], boolean> = {
  // v2 approvals — what the gate primarily wants
  "item/commandExecution/requestApproval": true,
  "item/fileChange/requestApproval": true,
  "item/permissions/requestApproval": true,
  // v2 user-input — also approval-capable in our sense
  "item/tool/requestUserInput": true,
  // legacy (pre-v2) — still approval-capable for compat
  "applyPatchApproval": true,
  "execCommandApproval": true,
  // tool/elicitation/auth — server-initiated but NOT what the gate is about
  "item/tool/call": false,
  "mcpServer/elicitation/request": false,
  "account/chatgptAuthTokens/refresh": false,
};

const ALL_METHODS = new Set<string>(Object.keys(APPROVAL_CAPABLE));
const APPROVAL_METHODS = new Set<string>(
  Object.entries(APPROVAL_CAPABLE).filter(([, v]) => v).map(([k]) => k),
);

interface Frame { method?: unknown; id?: unknown; params?: unknown }

export interface VerifyResult {
  ok: boolean;
  totalFrames: number;
  approvalCapableFrames: number;
  unknownMethods: string[];
  errors: string[];
}

export function verify(jsonlText: string): VerifyResult {
  const lines = jsonlText.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, totalFrames: 0, approvalCapableFrames: 0, unknownMethods: [], errors: ["empty fixture file"] };

  const errors: string[] = [];
  const unknownMethods = new Set<string>();
  let totalFrames = 0;
  let approvalCapableFrames = 0;

  for (const [i, line] of lines.entries()) {
    let frame: Frame;
    try { frame = JSON.parse(line) as Frame; }
    catch (e) { errors.push(`line ${i + 1}: not valid JSON: ${(e as Error).message}`); continue; }

    if (typeof frame.method !== "string") { errors.push(`line ${i + 1}: missing string method`); continue; }
    if (!("id" in frame) || frame.id == null) {
      errors.push(`line ${i + 1}: missing id — this fixture must contain server-initiated REQUESTS, not notifications`);
      continue;
    }
    totalFrames++;
    const m = frame.method;
    if (!ALL_METHODS.has(m)) {
      unknownMethods.add(m);
      errors.push(`line ${i + 1}: method "${m}" not in generated ServerRequest["method"] union`);
      continue;
    }
    if (APPROVAL_METHODS.has(m)) approvalCapableFrames++;
  }

  if (approvalCapableFrames === 0) {
    errors.push(`gate failed: 0 approval-capable frames; need ≥1 of ${[...APPROVAL_METHODS].join(", ")}`);
  }

  return { ok: errors.length === 0, totalFrames, approvalCapableFrames, unknownMethods: [...unknownMethods], errors };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl";
  const text = readFileSync(path, "utf8");
  const r = verify(text);
  if (!r.ok) {
    console.error(`GATE FAIL: ${path}`);
    for (const e of r.errors) console.error("  -", e);
    process.exit(1);
  }
  console.log(`GATE PASS: ${r.totalFrames} server-request frames, ${r.approvalCapableFrames} approval-capable`);
  if (r.unknownMethods.length) console.warn(`  warning: unknown methods seen: ${r.unknownMethods.join(", ")}`);
}
```

- [ ] **Step 4.5.2: Author `scripts/verify-phase1-fixtures.test.mts`** with the **negative cases Codex flagged as missing**:

```ts
import { describe, expect, it } from "vitest";
import { verify } from "./verify-phase1-fixtures.mts";

describe("verify-phase1-fixtures negative cases", () => {
  it("rejects empty file", () => {
    expect(verify("").ok).toBe(false);
  });
  it("rejects a notification mistakenly placed in the requests fixture (no id)", () => {
    const r = verify(JSON.stringify({ method: "turn/started", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing id"))).toBe(true);
  });
  it("rejects a fixture containing only non-approval server-requests (e.g. token refresh)", () => {
    const r = verify(JSON.stringify({ id: 1, method: "account/chatgptAuthTokens/refresh", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("0 approval-capable"))).toBe(true);
  });
  it("rejects unknown methods (not in generated union)", () => {
    const r = verify(JSON.stringify({ id: 1, method: "future/unseen/approval", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.unknownMethods).toContain("future/unseen/approval");
  });
  it("accepts a fixture with ≥1 approval-capable v2 method", () => {
    const r = verify(JSON.stringify({ id: 1, method: "item/commandExecution/requestApproval", params: {} }));
    expect(r.ok).toBe(true);
    expect(r.approvalCapableFrames).toBe(1);
  });
  it("accepts a fixture with a legacy method (applyPatchApproval)", () => {
    const r = verify(JSON.stringify({ id: 1, method: "applyPatchApproval", params: {} }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 4.5.3: Run the gate against the captured fixture:**

```bash
pnpm exec tsx scripts/verify-phase1-fixtures.mts
# Expected: GATE PASS: <N> server-request frames, <M> approval-capable
```

If exit code ≠ 0: STOP. Do not start T7, T8, or T9. Loop back to T4 with a different prompt or `approval_policy` setting. Document the rollback in `docs/phase-1/fixture-prompt-review.md`.

- [ ] **Step 4.5.4: Add `pnpm exec tsx scripts/verify-phase1-fixtures.mts` to `scripts/ci-check.sh`** so every later subagent reruns the gate.

- [ ] **Step 4.5.5: Commit.**

```bash
git commit -m "feat(scripts): verify-phase1-fixtures.mts — fixture acceptance gate (Codex B1)

Type-checked exhaustive table over generated ServerRequest['method']
union. Requires ≥1 approval-capable method. Negative tests cover
empty file, mistaken notification, only non-approval requests,
unknown methods. Wired into ci-check.sh."
```

**Exit criteria:** script + tests committed; script exits 0 against the captured fixture; all 6 negative-case tests pass; `bash scripts/ci-check.sh` runs the gate.

**Rollback:** see T4 rollback. T4.5 itself has no rollback — it is the gate.

---

### Task 5: `packages/core` package skeleton

Mirror Task 3 for `@codex-im/core`. Surface in `src/types.ts`:

```ts
export type ApprovalDecision =
  | { kind: "approved" }
  | { kind: "approved_for_session" }
  | { kind: "denied"; reason?: string }
  | { kind: "abort" };

// (P1-1) Forward-compat slot for the IM actor that resolved an approval.
// Phase 1 always sets actor: null (no IM yet). Phase 2 fills in platform/userId.
// Putting the field in the type now avoids a Phase 2 audit-row migration.
export type ApprovalActor =
  | null
  | { kind: "system"; reason: string }
  | { kind: "im"; platform: string; userId: string; chatId?: string };

export type ApprovalRecord = {
  id: string;
  appServerRequestId: string | number;
  method: string;
  params: unknown;
  status: "pending" | "resolved" | "expired" | "transport_lost";
  actor: ApprovalActor;                  // (P1-1) always null in Phase 1
  createdAt: Date;
  decidedAt?: Date;
  decision?: ApprovalDecision;
};

export interface SecurityPolicy {
  /** Phase 1: noop interface. Phase 3 implements. */
  readonly version: "phase1-noop";
}
```

- [ ] **Steps 5.1–5.7:** mirror T3 (failing test, package.json, tsconfig, types, index, install/typecheck, commit).
- [ ] **Step 5.8: Add a type-level test** — verify `ApprovalRecord.actor` accepts `null`, `{ kind: "system", reason: "..." }`, and `{ kind: "im", platform: "telegram", userId: "..." }` but rejects unknown `kind` values.

```bash
git commit -m "feat(core): package skeleton + ApprovalRecord types (P1 prep)

Types include ApprovalActor slot (P1-1) so Phase 2 can attach IM
platform/userId without an audit-row migration. Phase 1 callers
always set actor: null."
```

**Exit criteria:** identical to T3 + ApprovalActor type-level test passes.

---

### Task 6: `method-names.ts` — typed narrowing helpers (rewritten after Codex B5)

**Codex B5 found:** `Set<ServerNotificationMethod>([...])` is **not** exhaustive — TypeScript happily accepts a strict subset. The original "engineer enumerates ALL" maintenance note is unenforceable. Rewrite: derive the runtime check from `METHOD_CLASS` (T7a), which IS exhaustive by construction (`Record<ServerNotification["method"], EventClass>` has every union member as a key).

**Files:**
- Create: `packages/codex-runtime/src/method-names.ts`
- Create: `packages/codex-runtime/test/method-names.test.ts`

**Depends on:** T7a's `event-class.ts` for `METHOD_CLASS`. Adjust execution order: T6 lands AFTER T7a's classification-table commit (or in the same PR). The graph above already places T6 after T3 + T4.5; T7a can land its `event-class.ts` first as a sub-step inside its lane.

- [ ] **Step 6.1: Write failing test.**

```ts
// packages/codex-runtime/test/method-names.test.ts
import { describe, expect, it } from "vitest";
import { isServerNotificationMethod } from "../src/method-names.js";

describe("isServerNotificationMethod", () => {
  it("accepts a known method", () => expect(isServerNotificationMethod("turn/started")).toBe(true));
  it("rejects an unknown method", () => expect(isServerNotificationMethod("future/never/seen")).toBe(false));
  it("narrows the type for downstream consumers", () => {
    const m: string = "turn/completed";
    if (isServerNotificationMethod(m)) {
      // type-level check — m is now ServerNotification["method"]
      const _ok: typeof m = m;
      expect(typeof _ok).toBe("string");
    }
  });
});
```

- [ ] **Step 6.2: Implement helper by deriving from `METHOD_CLASS` (Codex B5 fix).**

```ts
// packages/codex-runtime/src/method-names.ts
import type { ServerNotification } from "@codex-im/protocol";
import { METHOD_CLASS } from "./event-class.js";

export type ServerNotificationMethod = ServerNotification["method"];

// METHOD_CLASS is Record<ServerNotification["method"], EventClass>, so its
// keys are exactly the generated union — no parallel enumeration to drift.
// (No Set<Union> exhaustiveness false-positive; the Record's domain is
// type-level enforced in event-class.ts.)
export function isServerNotificationMethod(m: string): m is ServerNotificationMethod {
  return Object.hasOwn(METHOD_CLASS, m);
}

export const KNOWN_NOTIFICATION_METHODS: readonly ServerNotificationMethod[] =
  Object.freeze(Object.keys(METHOD_CLASS) as ServerNotificationMethod[]);
```

- [ ] **Step 6.3: Type-level exhaustiveness assertion (compile-time test).**

```ts
// packages/codex-runtime/test/method-class-exhaustive.test-d.ts
import { expectTypeOf } from "vitest";
import type { ServerNotification } from "@codex-im/protocol";
import { METHOD_CLASS } from "../src/event-class.js";

// If event-class.ts ever drops a union arm, this assertion fails to compile.
// (vitest type-test mode picks up *.test-d.ts files via vitest typecheck.)
expectTypeOf<keyof typeof METHOD_CLASS>().toEqualTypeOf<ServerNotification["method"]>();
```

- [ ] **Step 6.4: `bash scripts/ci-check.sh` — exit 0** (incl. `vitest typecheck` for the type-level test).
- [ ] **Step 6.5: Commit.**

```bash
git commit -m "feat(codex-runtime): method-name narrowing derived from METHOD_CLASS (Codex B5)

isServerNotificationMethod now uses Object.hasOwn over the
exhaustive Record<ServerNotification['method'], EventClass> table
in event-class.ts. Avoids the Set<Union> false-positive
exhaustiveness footgun. Type-level test asserts METHOD_CLASS keys
equal the generated union."
```

**Exit criteria:** `isServerNotificationMethod` narrows to generated union; type-level test forces `METHOD_CLASS` to stay exhaustive; ci-check green.

---

### Task 7a: `EventNormalizer` skeleton + happy path (P1.3 part 1) **[lead session]**

(Split per plan-eng-review P1-3.) Skeleton ships first — happy-path mapping, FIFO ordering, basic AsyncIterable contract. Edges land in T7b.

**Files:**
- Create: `packages/codex-runtime/src/event-normalizer.ts`
- Create: `packages/codex-runtime/src/event-class.ts` (D5 revised — classification table)
- Create: `packages/codex-runtime/test/event-normalizer.test.ts`

- [ ] **Step 7a.1: Write failing unit test — empty iterator until subscribe + first notification.**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryTransport, makeFakeAppServerClient } from "@codex-im/testkit";
import { EventNormalizer } from "../src/event-normalizer.js";

describe("EventNormalizer skeleton", () => {
  it("yields events in arrival order", async () => {
    const { client, transport } = makeFakeAppServerClient();
    const norm = new EventNormalizer(client);
    const it = norm.events()[Symbol.asyncIterator]();
    transport.simulateInbound({ method: "turn/started", params: { threadId: "t1", turnId: "u1" } });
    const ev = (await it.next()).value;
    expect(ev).toMatchObject({ type: "turn_started", threadId: "t1", turnId: "u1" });
  });

  it("late subscriber sees events buffered before iteration started", async () => {
    const { client, transport } = makeFakeAppServerClient();
    const norm = new EventNormalizer(client);
    transport.simulateInbound({ method: "turn/started", params: { threadId: "t1", turnId: "u1" } });
    transport.simulateInbound({ method: "turn/completed", params: { threadId: "t1", turnId: "u1" } });
    const it = norm.events()[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ type: "turn_started" });
    expect((await it.next()).value).toMatchObject({ type: "turn_completed" });
  });
});
```

- [ ] **Step 7a.2: Verify FAIL.**
- [ ] **Step 7a.3: Implement classification table (`event-class.ts`)** — D5 revised:

```ts
// packages/codex-runtime/src/event-class.ts
import type { ServerNotification } from "@codex-im/protocol";
import type { EventClass } from "./types.js";

// Domain MUST equal ServerNotification["method"] union — TypeScript errors if
// a new union arm is added without a classification entry.
export const METHOD_CLASS: Readonly<Record<ServerNotification["method"], EventClass>> = {
  "turn/started": "lifecycle",
  "turn/completed": "lifecycle",
  "thread/started": "lifecycle",
  "thread/closed": "lifecycle",
  "item/started": "lifecycle",
  "item/completed": "lifecycle",
  "warning": "lifecycle",
  "error": "lifecycle",
  "guardianWarning": "lifecycle",
  "thread/tokenUsage/updated": "lifecycle",
  "model/rerouted": "lifecycle",
  "model/verification": "lifecycle",
  "thread/compacted": "lifecycle",
  "turn/diff/updated": "lifecycle",
  "turn/plan/updated": "lifecycle",
  "item/agentMessage/delta": "delta",
  "item/reasoning/textDelta": "delta",
  "item/commandExecution/outputDelta": "delta",
  "item/fileChange/outputDelta": "delta",
  "item/fileChange/patchUpdated": "delta",
  "item/plan/delta": "delta",
  // ... full enumeration; exhaustive over generated union
};

export function classifyMethod(m: ServerNotification["method"]): EventClass {
  return METHOD_CLASS[m];
}
```

- [ ] **Step 7a.4: Implement minimal normalizer — single FIFO queue, happy path only (D5 final / Codex B4 fix).**

```ts
// packages/codex-runtime/src/event-normalizer.ts
import type { AppServerClient, JsonRpcNotification } from "@codex-im/app-server-client";
import { isServerNotificationMethod } from "./method-names.js";
import { classifyMethod } from "./event-class.js";
import type { CodexRichEvent } from "./types.js";

export type NormalizerOptions = {
  deltaSoftCap?: number;        // when delta count exceeds this, walk-and-drop oldest delta
  totalHardCap?: number;        // last-resort backstop; emits fatal lifecycle overflow if breached
};

export class EventNormalizer {
  // Codex B4: ONE queue. Order is preserved globally. Backpressure is
  // per-class via walk-and-drop, not via priority drain.
  #queue: CodexRichEvent[] = [];
  #deltaCount = 0;
  #waiters: Array<(ev: IteratorResult<CodexRichEvent>) => void> = [];
  #closed = false;
  #unsub: () => void;
  #deltaSoftCap: number;
  #totalHardCap: number;
  #droppedDeltaCount = 0;

  constructor(client: AppServerClient, opts: NormalizerOptions = {}) {
    this.#deltaSoftCap = opts.deltaSoftCap ?? 4096;
    this.#totalHardCap = opts.totalHardCap ?? 16384;
    this.#unsub = client.onNotification((msg) => this.#onNotification(msg));
  }

  #onNotification(msg: JsonRpcNotification) {
    const m = msg.method;
    if (!isServerNotificationMethod(m)) {
      this.#enqueue({ type: "unknown", method: m, params: msg.params }, "lifecycle");
      return;
    }
    const cls = classifyMethod(m);
    this.#enqueue(this.#mapNotification(msg), cls);
  }

  #enqueue(ev: CodexRichEvent, cls: "lifecycle" | "delta") {
    // T7b: full eviction logic. T7a happy path = no eviction needed in tests.
    this.#queue.push(ev);
    if (cls === "delta") this.#deltaCount++;
    this.#drain();
  }

  #mapNotification(msg: JsonRpcNotification): CodexRichEvent {
    // T7a: minimal mapping — turn/started, turn/completed, item/started, item/completed,
    // agentMessage/delta. Full exhaustive switch lands in T7b.
    switch (msg.method) {
      case "turn/started": {
        const p = msg.params as { threadId: string; turnId: string };
        return { type: "turn_started", threadId: p.threadId, turnId: p.turnId, raw: msg };
      }
      case "turn/completed": {
        const p = msg.params as { threadId: string; turnId: string };
        return { type: "turn_completed", threadId: p.threadId, turnId: p.turnId, raw: msg, terminal: true };
      }
      // T7b adds the rest
      default:
        return { type: "unknown", method: msg.method, params: msg.params };
    }
  }

  events(): AsyncIterable<CodexRichEvent> {
    return { [Symbol.asyncIterator]: () => this.#asyncIterator() };
  }

  #asyncIterator(): AsyncIterator<CodexRichEvent> {
    return {
      next: () => new Promise((resolve) => {
        if (this.#queue.length > 0) {
          const ev = this.#queue.shift()!;
          if ((ev as { type: string }).type.endsWith("_delta") || (ev as { type: string }).type.endsWith("_overflow")) {
            // delta-class accounting; T7b refines this using the real class map
          }
          resolve({ value: ev, done: false });
          return;
        }
        if (this.#closed) { resolve({ value: undefined, done: true }); return; }
        this.#waiters.push(resolve);
      }),
      return: async () => { this.#close(); return { value: undefined, done: true }; },
    };
  }

  #drain() {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      const w = this.#waiters.shift()!;
      w({ value: this.#queue.shift()!, done: false });
    }
  }

  #close() {
    this.#closed = true;
    this.#unsub();
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
  }
}
```

- [ ] **Step 7a.5: Run test, verify PASS for happy path + late subscriber.**
- [ ] **Step 7a.6: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 7a.7: Commit.**

```bash
git commit -m "feat(codex-runtime): EventNormalizer skeleton + classification table (P1.3 part 1; D5 final)

Single FIFO queue preserves global order across lifecycle and
delta classes (D5 final, Codex B4 fix). Classification table is
type-checked exhaustive over ServerNotification union. T7b lands
walk-and-drop overflow + exhaustive mapping + terminal semantics."
```

**Exit criteria:** happy-path test + late-subscriber test pass; classification table compiles exhaustively; ci-check green.

---

### Task 7b: `EventNormalizer` edges + reviews (P1.3 part 2) **[lead session]**

**Files:**
- Modify: `packages/codex-runtime/src/event-normalizer.ts` (fill in T7a stubs)
- Modify: `packages/codex-runtime/test/event-normalizer.test.ts`
- Create: `packages/codex-runtime/test/event-normalizer-fixture.test.ts`
- Create: `packages/codex-runtime/test/event-normalizer-ordering.test.ts` (Codex required-test "Event ordering test with interleaved lifecycle + deltas")

- [ ] **Step 7b.1: Add coverage for each `ServerNotification` arm** — one test per method, asserting correct `CodexRichEvent.type` mapping.
- [ ] **Step 7b.2: Implement full exhaustive `#mapNotification` switch over the generated `ServerNotification` union.** Use TypeScript exhaustiveness check (`const _exhaustive: never = m;` in default branch).
- [ ] **Step 7b.3: Add `turn/completed` status mapping (Codex required-test "turn/completed mapping based on turn.status").**

The wire `turn/completed` notification carries `params.turn.status` ∈ `"completed" | "failed" | "interrupted"`. The normalizer must emit one of three rich events:
```ts
case "turn/completed": {
  const p = msg.params as { turn: { id: string; threadId: string; status: "completed" | "failed" | "interrupted" } };
  switch (p.turn.status) {
    case "completed":   return { type: "turn_completed",   threadId: p.turn.threadId, turnId: p.turn.id, raw: msg, terminal: true };
    case "failed":      return { type: "turn_failed",      threadId: p.turn.threadId, turnId: p.turn.id, raw: msg, terminal: true };
    case "interrupted": return { type: "turn_interrupted", threadId: p.turn.threadId, turnId: p.turn.id, raw: msg, terminal: true };
  }
}
```
Add `turn_failed` and `turn_interrupted` to `CodexRichEvent` in `types.ts`.

- [ ] **Step 7b.4: Implement walk-and-drop overflow (D5 final / Codex B4 fix).**

```ts
#enqueue(ev: CodexRichEvent, cls: "lifecycle" | "delta") {
  if (cls === "delta" && this.#deltaCount >= this.#deltaSoftCap) {
    // Find oldest delta, splice it out, insert overflow synthetic in its place
    for (let i = 0; i < this.#queue.length; i++) {
      const old = this.#queue[i];
      const oldCls = isOverflow(old) ? "lifecycle" : classifyOf(old);
      if (oldCls === "delta") {
        this.#queue.splice(i, 1, { type: "normalizer_overflow", droppedCount: ++this.#droppedDeltaCount, class: "delta" });
        this.#deltaCount--;
        break;
      }
    }
  }
  this.#queue.push(ev);
  if (cls === "delta") this.#deltaCount++;
  // Hard cap (lifecycle saturation — should be impossible in practice)
  while (this.#queue.length > this.#totalHardCap) {
    this.#queue.shift();
    this.#queue.unshift({ type: "normalizer_overflow", droppedCount: 1, class: "lifecycle" });
    // log error — this branch indicates a bug
  }
  this.#drain();
}
```

- [ ] **Step 7b.5: Ordering test (Codex required-test).**

```ts
// packages/codex-runtime/test/event-normalizer-ordering.test.ts
it("preserves global FIFO order across lifecycle and delta even under overflow", async () => {
  const { client, transport } = makeFakeAppServerClient();
  const norm = new EventNormalizer(client, { deltaSoftCap: 5 });
  // Wire pattern: delta delta lifecycle delta delta delta delta lifecycle delta delta delta
  const wire: Array<{ method: string; params: unknown }> = [
    { method: "item/agentMessage/delta", params: { delta: 1 } },
    { method: "item/agentMessage/delta", params: { delta: 2 } },
    { method: "turn/started", params: { threadId: "t", turnId: "u" } },
    { method: "item/agentMessage/delta", params: { delta: 3 } },
    { method: "item/agentMessage/delta", params: { delta: 4 } },
    { method: "item/agentMessage/delta", params: { delta: 5 } },
    { method: "item/agentMessage/delta", params: { delta: 6 } },   // soft cap exceeded → drop oldest delta (delta 1)
    { method: "turn/completed", params: { turn: { id: "u", threadId: "t", status: "completed" } } },
    { method: "item/agentMessage/delta", params: { delta: 7 } },
    { method: "item/agentMessage/delta", params: { delta: 8 } },
    { method: "item/agentMessage/delta", params: { delta: 9 } },   // drop oldest delta (delta 2)
  ];
  for (const w of wire) transport.simulateInbound(w);
  const out: CodexRichEvent[] = [];
  const it = norm.events()[Symbol.asyncIterator]();
  for (let i = 0; i < 11; i++) out.push((await it.next()).value as CodexRichEvent);
  // Expected order (with overflow synthetics replacing dropped delta 1 and delta 2):
  // overflow-1, delta-2, turn_started, delta-3, delta-4, delta-5, delta-6, turn_completed, delta-7, delta-8, delta-9
  // — but wait: after dropping delta-1, delta-2 is still there. After dropping delta-2 too, only the synthetic remains at delta-2's slot.
  // Implementer adapts assertions to the precise eviction sequence; the invariant is:
  //   for any pair of original wire entries A then B, the rich events derived from them
  //   appear in the output stream in the same order, OR are replaced by an overflow synthetic at A's position.
  expect(out.map((e) => e.type)).toEqual([
    "normalizer_overflow",   // delta-1 dropped
    "agent_message_delta",   // delta-2
    "turn_started",
    "agent_message_delta",   // delta-3
    "agent_message_delta",   // delta-4
    "agent_message_delta",   // delta-5
    "agent_message_delta",   // delta-6
    "turn_completed",
    "agent_message_delta",   // delta-7
    "agent_message_delta",   // delta-8
    "agent_message_delta",   // delta-9
  ]);
});
```

- [ ] **Step 7b.6: Iterator terminal semantics test (Codex required clarification).**

Document the contract in JSDoc on `events()`:
> The global stream stays open until `transport.onClose` or the caller invokes `iterator.return()` / `break`s out of `for await`. Per-turn / per-thread filtered sub-iterators (added in P2 if needed) close at their respective terminal events.

Test: feed `turn/completed`; assert next iteration **does NOT close** automatically; assert calling `iterator.return()` resolves with `{ done: true }`.

- [ ] **Step 7b.7: Lifecycle-never-dropped test** — push 1000 deltas + interleave 5 `turn/started`; assert all 5 lifecycle events delivered, no lifecycle dropped, only delta overflow synthetics observed.
- [ ] **Step 7b.8: Unknown-method test — feed `{ method: "future/unseen", params: {} }`, assert `{ type: "unknown" }`, no throw.**
- [ ] **Step 7b.9: Add fixture replay test** — load `phase1-richer-turn-event-stream.jsonl`, feed each line into `transport.simulateInbound`, assert iterator yields exactly N events in order, all three terminal-state arms (`turn_completed | turn_failed | turn_interrupted`) parsed correctly when present.
- [ ] **Step 7b.10: `for await ... of` integration test** — consume entire fixture without a manual `break`.
- [ ] **Step 7b.11: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 7b.12: Codex outside-voice review on the diff** — `codex review` against the EventNormalizer files. Specifically ask: "is global FIFO order preserved across all eviction paths?". Record findings in `docs/phase-1/event-normalizer-review.md`.
- [ ] **Step 7b.13: gstack `/plan-eng-review`** on the EventNormalizer module surface vs. plan.
- [ ] **Step 7b.14: Commit.**

```bash
git commit -m "feat(codex-runtime): EventNormalizer edges + reviews (P1.3 part 2; D5 final)

Single FIFO queue with class-aware walk-and-drop preserves global
order under overflow (D5 final / Codex B4). Exhaustive
ServerNotification union mapping with turn.status →
turn_completed | turn_failed | turn_interrupted. Iterator stays
open until transport close / explicit return. Fixture replay over
phase1-richer-turn-event-stream.jsonl. Outside-voice + plan-eng-review
captured."
```

**Exit criteria:** all unit + fixture replay + ordering tests pass; lifecycle-never-dropped invariant proven; iterator terminal semantics documented + tested; unknown methods do not crash; outside-voice + plan-eng-review captured.

---

### Task 8: `CodexRuntime` typed wrappers (P1.1)

**Files:**
- Create: `packages/codex-runtime/src/runtime.ts`
- Create: `packages/codex-runtime/src/state.ts`
- Create: `packages/codex-runtime/test/runtime.test.ts`

- [ ] **Step 8.1: Write failing test — `runtime.threadStart({})` returns `ThreadStartResponse` from generated types.**
- [ ] **Step 8.2: Implement minimal wrappers — one per `ClientRequest` arm we expose in Phase 1**

Methods to wrap (Codex B8 fix — `thread/interrupt` removed; not a real generated method per `packages/codex-protocol/src/generated/ClientRequest.ts:79`):
- `thread/start`, `thread/resume`, `thread/fork`, `thread/turns/list`, `thread/read`
- `turn/start`, `turn/steer`, `turn/interrupt` (this is the only "interrupt" — operates on the active turn within a thread)
- `review/start`

Each wrapper signature pulls types from `@codex-im/protocol` (Pre-2 facade); if a Phase-1-needed name is missing from the facade, that's a Pre-2 defect, not a Phase 1 implementation choice.

Pattern:

```ts
// packages/codex-runtime/src/runtime.ts
import type { AppServerClient } from "@codex-im/app-server-client";
import type {
  ThreadStartParams, ThreadStartResponse,
  TurnStartParams, TurnStartResponse,
  // ... all imports from @codex-im/protocol generated types
} from "@codex-im/protocol";
import { EventNormalizer } from "./event-normalizer.js";

export class CodexRuntime {
  readonly events: EventNormalizer;
  constructor(private client: AppServerClient) {
    this.events = new EventNormalizer(client);
  }

  threadStart(params: ThreadStartParams = {}): Promise<ThreadStartResponse> {
    return this.client.request<ThreadStartParams, ThreadStartResponse>("thread/start", params);
  }
  turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.client.request<TurnStartParams, TurnStartResponse>("turn/start", params);
  }
  // ... all wrappers
}
```

- [ ] **Step 8.3: One test per wrapper using `FakeAppServer` + `replayFixture`.**
- [ ] **Step 8.4: Add lifecycle JSDoc on `CodexRuntime` mirroring `AppServerClient` ONE-SHOT policy.** "When the underlying client closes, this runtime is dead. Construct a new one."
- [ ] **Step 8.5: Typecheck + lint + test.**
- [ ] **Step 8.6: Commit.**

```bash
git commit -m "feat(codex-runtime): typed request wrappers + ONE-SHOT JSDoc (P1.1)"
```

**Exit criteria:** all 10 wrapper methods have a passing test; types come from `@codex-im/protocol` generated union (no string-literal `method` imports outside this file); JSDoc documents lifecycle.

---

### Task 9a: `ApprovalBroker` skeleton + happy path (P1.2 part 1) **[lead session]**

(Split per plan-eng-review P1-3.) Skeleton lands single-handler invariant + happy-path dispatch + per-method dispatch over T4.5-captured fixture. Edges (timeout/throw/transport-loss/reviews) land in T9b.

**Depends on: Pre-3** (`AppServerClient` `JsonRpcResponseError` propagation). T9a's "unknown method → -32601" expectation requires the Pre-3 catch-arm extension; without Pre-3, the broker's throw collapses to `-32603`. Do not start T9a until Pre-3 is merged.

**Files:**
- Create: `packages/core/src/approval-broker.ts`
- Create: `packages/core/test/approval-broker.test.ts`
- Create: `packages/core/test/approval-broker-dispatch.test.ts`
- Create: `packages/core/test/dispatch-coverage.test.ts` (P2-2 — exhaustive `ServerRequest["method"]` registration check)

T9a may NOT modify any file in `packages/app-server-client/`. The `JsonRpcResponseError` propagation lives in Pre-3.

- [ ] **Step 9a.1: Write failing test — single handler registration, dispatch by method, default-reject for unregistered.**

The unknown-method test uses a synthetic method name (`future/unseen/method`) that is intentionally NOT in the generated `ServerRequest["method"]` union. The broker signals `-32601` by throwing a `JsonRpcResponseError` (Pre-3 path); it MUST NOT hard-code any approval method-name string literal in `packages/core/` test code, except as needed to assert dispatch behavior for methods that are in the generated union.

```ts
import { describe, expect, it } from "vitest";
import { AppServerClient } from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { ApprovalBroker } from "../src/approval-broker.js";

describe("ApprovalBroker skeleton", () => {
  it("default-rejects an unknown (non-generated) method via -32601 (Pre-3 path)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    // Synthetic name — not in generated ServerRequest union. The broker
    // throws JsonRpcResponseError({ code: -32601, ... }); Pre-3's
    // AppServerClient catch-arm preserves the explicit code.
    await expect(
      fake.emitServerRequest("future/unseen/method", {}, 42),
    ).rejects.toMatchObject({ code: -32601 });
    await client.stop();
  });

  it("duplicate attach() throws", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    expect(() => broker.attach()).toThrow(/already attached/);
    await client.stop();
  });
});
```

- [ ] **Step 9a.2: Implement broker skeleton with **exhaustive Record-based** dispatch table (Codex B6 fix — `Map` was not exhaustive).**

```ts
// packages/core/src/approval-broker.ts
import type { AppServerClient, JsonRpcRequest } from "@codex-im/app-server-client";
import type { ServerRequest, ReviewDecision } from "@codex-im/protocol";
import type {
  CommandExecutionRequestApprovalParams, CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalParams, FileChangeRequestApprovalResponse,
  PermissionsRequestApprovalParams, PermissionsRequestApprovalResponse,
  ToolRequestUserInputParams, ToolRequestUserInputResponse,
  DynamicToolCallParams, DynamicToolCallResponse,
  McpServerElicitationRequestParams, McpServerElicitationRequestResponse,
  ApplyPatchApprovalParams, ApplyPatchApprovalResponse,
  ExecCommandApprovalParams, ExecCommandApprovalResponse,
  ChatgptAuthTokensRefreshParams, ChatgptAuthTokensRefreshResponse,
} from "@codex-im/protocol";
import type { ApprovalDecision, ApprovalRecord, ApprovalActor } from "./types.js";

// Per-method dispatcher specification — params and response types are method-specific.
// (Codex outside-voice noted v2 approval responses are NOT all { decision: ReviewDecision }.
// Per 05-PROTOCOL §4.1 the v2 response shapes live at packages/codex-protocol/src/generated/v2/*RequestApprovalResponse.ts.)
export type DispatcherSpec<P, R> = {
  handler: ((req: { method: string; params: P; id: string | number }) => Promise<R>) | null;
  defaultReject: () => R;
};

// Exhaustive Record over generated ServerRequest["method"] union.
// TypeScript fails to compile if a generated arm is missing.
type DispatchTable = {
  "item/commandExecution/requestApproval": DispatcherSpec<CommandExecutionRequestApprovalParams, CommandExecutionRequestApprovalResponse>;
  "item/fileChange/requestApproval":       DispatcherSpec<FileChangeRequestApprovalParams,       FileChangeRequestApprovalResponse>;
  "item/permissions/requestApproval":      DispatcherSpec<PermissionsRequestApprovalParams,      PermissionsRequestApprovalResponse>;
  "item/tool/requestUserInput":            DispatcherSpec<ToolRequestUserInputParams,            ToolRequestUserInputResponse>;
  "item/tool/call":                        DispatcherSpec<DynamicToolCallParams,                 DynamicToolCallResponse>;
  "mcpServer/elicitation/request":         DispatcherSpec<McpServerElicitationRequestParams,     McpServerElicitationRequestResponse>;
  "applyPatchApproval":                    DispatcherSpec<ApplyPatchApprovalParams,              ApplyPatchApprovalResponse>;
  "execCommandApproval":                   DispatcherSpec<ExecCommandApprovalParams,             ExecCommandApprovalResponse>;
  "account/chatgptAuthTokens/refresh":     DispatcherSpec<ChatgptAuthTokensRefreshParams,        ChatgptAuthTokensRefreshResponse>;
};

// Type-level guard: DispatchTable's keys MUST equal ServerRequest["method"].
// If a new generated arm is added without updating this table, this line fails to compile.
type _ExhaustiveDispatch = ServerRequest["method"] extends keyof DispatchTable
  ? keyof DispatchTable extends ServerRequest["method"] ? true : ["dispatch table has stale keys not in ServerRequest"]
  : ["dispatch table is missing a ServerRequest method"];
const _exhaustiveCheck: _ExhaustiveDispatch = true;

export class ApprovalBroker {
  #table: DispatchTable;
  #pending = new Map<string | number, ApprovalRecord>();
  #attached = false;
  constructor(private client: AppServerClient) {
    // Default-reject specs for non-approval methods — explicit, never silent fall-through.
    this.#table = {
      "item/commandExecution/requestApproval": { handler: null, defaultReject: () => ({ decision: "denied" } as CommandExecutionRequestApprovalResponse) },
      "item/fileChange/requestApproval":       { handler: null, defaultReject: () => ({ decision: "denied" } as FileChangeRequestApprovalResponse) },
      "item/permissions/requestApproval":      { handler: null, defaultReject: () => ({ decision: "denied" } as PermissionsRequestApprovalResponse) },
      // user-input requires a string answer — Phase 1 default-reject = empty + cancelled flag (semantics from generated type)
      "item/tool/requestUserInput":            { handler: null, defaultReject: () => ({ /* per ToolRequestUserInputResponse shape */ } as ToolRequestUserInputResponse) },
      // tool/call: Phase 1 has no Computer Use; default-reject means error response per generated shape
      "item/tool/call":                        { handler: null, defaultReject: () => ({ /* error per DynamicToolCallResponse shape */ } as DynamicToolCallResponse) },
      "mcpServer/elicitation/request":         { handler: null, defaultReject: () => ({ /* per shape */ } as McpServerElicitationRequestResponse) },
      "applyPatchApproval":                    { handler: null, defaultReject: () => ({ decision: "denied" satisfies ReviewDecision } as ApplyPatchApprovalResponse) },
      "execCommandApproval":                   { handler: null, defaultReject: () => ({ decision: "denied" satisfies ReviewDecision } as ExecCommandApprovalResponse) },
      // auth refresh: Phase 1 must NOT silently approve; explicit error
      "account/chatgptAuthTokens/refresh":     { handler: null, defaultReject: () => { throw Object.assign(new Error("auth refresh not supported in Phase 1"), { code: -32601 }); } },
    };
  }

  attach(): void {
    if (this.#attached) throw new Error("ApprovalBroker already attached");
    this.client.setServerRequestHandler((req) => this.#handle(req));
    this.#attached = true;
  }

  // T9b: also accept a DispatchHandlers object to register multiple at once
  registerHandler<M extends keyof DispatchTable>(method: M, handler: NonNullable<DispatchTable[M]["handler"]>): void {
    this.#table[method].handler = handler as DispatchTable[M]["handler"];
  }

  async #handle(req: JsonRpcRequest): Promise<unknown> {
    const m = req.method as keyof DispatchTable;
    const spec = this.#table[m];
    if (!spec) {
      // method not in generated union — fail-open as -32601
      throw Object.assign(new Error(`unsupported method ${req.method}`), { code: -32601 });
    }
    if (!spec.handler) {
      // explicit default-reject (returned to codex as a successful response with denied decision,
      // NOT as a -32601 error — codex needs the response shape to continue)
      return spec.defaultReject();
    }
    return await spec.handler(req as never);
  }

  // T9b: timeout + transport-loss + actor-binding
  resolve(_approvalId: string, _decision: ApprovalDecision, _actor: ApprovalActor): void { throw new Error("T9b"); }
  failPendingAsTransportLost(): void { throw new Error("T9b"); }
  expirePending(): void { throw new Error("T9b"); }
}
```

- [ ] **Step 9a.3: Add per-method dispatcher tests using fixture from T4 + T4.5** — one test per method present in `phase1-richer-turn-server-request.jsonl` AND one explicit-default-reject test per non-approval method (`item/tool/call`, `mcpServer/elicitation/request`, `account/chatgptAuthTokens/refresh`). Codex required-test "broker tests for all 9 generated server-request methods, including explicit unsupported default-reject".
- [ ] **Step 9a.4: Add v2 approval response-shape tests (Codex required-test).** For each v2 method, assert:
  - `item/commandExecution/requestApproval` → response shape per `packages/codex-protocol/src/generated/v2/CommandExecutionRequestApprovalResponse.ts`
  - `item/fileChange/requestApproval` → per `FileChangeRequestApprovalResponse.ts`
  - `item/permissions/requestApproval` → per `PermissionsRequestApprovalResponse.ts`
  None of these are guaranteed to use the legacy `{ decision: ReviewDecision }` shape — the test reads the actual generated type and validates the response shape against it. **Do not assume legacy shape applies.**
- [ ] **Step 9a.5: Add `dispatch-coverage.test.ts`** — `_ExhaustiveDispatch` type-level test (already in source); plus a runtime test that asserts `Object.keys(broker.dispatchTable())` covers every method seen in the captured fixture AND every method in the generated union.
- [ ] **Step 9a.6: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 9a.7: Commit.**

```bash
git commit -m "feat(core): ApprovalBroker skeleton + happy-path dispatch (P1.2 part 1)

Owns the single AppServerClient.setServerRequestHandler slot —
duplicate attach() throws. Default-reject -32601 for unregistered
methods. Per-method dispatch tests over phase1 fixture.
dispatch-coverage.test.ts enforces exhaustive coverage. T9b
adds timeout + throw + transport-loss + outside-voice review."
```

**Exit criteria:** single-handler invariant test passes; per-method dispatch covers every method seen in T4 fixture; ci-check green.

---

### Task 9b: `ApprovalBroker` edges + reviews (P1.2 part 2) **[lead session]**

**Files:**
- Modify: `packages/core/src/approval-broker.ts`
- Modify: `packages/core/test/approval-broker.test.ts`
- Create: `packages/core/test/approval-broker-fixture.test.ts`

- [ ] **Step 9b.1: Add `reattach(client)` API used by Supervisor (Codex B7 dependency).** Detaches from the prior client (drops its handler reference), validates the new client is a different instance, calls `client.setServerRequestHandler(...)` on the new one, transfers any retained pending state. Throws if `client === priorClient` (catches identity bugs). Test: assert `setServerRequestHandler` called once on new, prior client's handler reference set to null after reattach.
- [ ] **Step 9b.2: Add timeout test — registered dispatcher that takes 31s → broker must default-reject (-32603 "handler error") + audit.**
- [ ] **Step 9b.3: Add throw tests — distinguish generic-throw from explicit-JsonRpcResponseError-throw.** Two cases, both must pass:
   1. **Generic throw:** registered dispatcher throws a plain `Error("policy denied")` → broker / `AppServerClient` collapse to `-32603 "handler error: policy denied"` + audit. Distinguishes "handler errored" (-32603) from "no handler at all" (which is `-32601` only when `setServerRequestHandler` was never called — orthogonal to the broker, since the broker IS the registered handler).
   2. **Explicit `JsonRpcResponseError` throw (Pre-3 path):** registered dispatcher throws `new JsonRpcResponseError({ code, message, data })` → wire envelope preserves the explicit `code`, `message`, and `data` verbatim. NO `"handler error: "` prefix. The broker uses this path for "method not in dispatch table" with `code: -32601`. Test asserts the wire envelope matches the thrown error's fields exactly.

   Neither case should crash the broker or AppServerClient.
- [ ] **Step 9b.4: Add transport-loss test (D6)** — pending approval at transport close → status `transport_lost`, decision auto-set to `{ kind: "denied", reason: "transport_lost" }`, `actor` set to `{ kind: "system", reason: "transport_lost" }`.
- [ ] **Step 9b.5: Implement `resolve(approvalId, decision, actor)` + `failPendingAsTransportLost()` + `expirePending()`** — actor field always required (P1-1 enforcement); Phase 1 callers pass `{ kind: "system", reason: "..." }` since no IM exists yet. `failPendingAsTransportLost()` is **idempotent** (Codex B7 close-idempotence dependency): if called twice, the second call is a no-op. Test asserts both behaviors.
- [ ] **Step 9b.6: Type-level test (P2-4)** — assert no string literal of an approval method name exists outside `packages/core/`. Implementation: build-time grep over `packages/{app-server-client,codex-runtime,daemon,cli}/src/**` for `/['"](approval|item\/|turn\/|thread\/)/` — fail test if any match. Exempts test files.
- [ ] **Step 9b.7: Codex outside-voice review on broker diff.** Specifically ask:
  1. "is the single-slot invariant violated anywhere?"
  2. "does method-name handling read from the generated `ServerRequest` union?"
  3. "is `ApprovalActor` always set on resolve, including system-initiated transport-loss path?"
  Capture in `docs/phase-1/approval-broker-review.md`.
- [ ] **Step 9b.8: gstack `/plan-eng-review`** on the broker module.
- [ ] **Step 9b.9: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 9b.10: Commit.**

```bash
git commit -m "feat(core): ApprovalBroker edges + reviews (P1.2 part 2)

Timeout default-rejects with -32603 (handler error). Generic-throw
collapses to -32603. Explicit JsonRpcResponseError-throw preserves
code/message/data verbatim (Pre-3 path; the broker uses this for
'method not in dispatch table' as -32601). Transport-loss (D6)
auto-resolves pending approvals as denied with ApprovalActor=
{ kind: 'system', reason: 'transport_lost' }. Build-time grep guard
(P2-4) ensures approval method names exist nowhere outside
packages/core/. Outside-voice + plan-eng-review captured."
```

**Exit criteria:** broker is the only module that calls `client.setServerRequestHandler`; test coverage includes default-reject, throw, timeout, transport-loss, exhaustive method dispatch, ApprovalActor binding, and the no-method-literal grep guard; outside-voice + plan-eng-review recorded.

---

### Task 10: `codex-im runtime send` CLI

**Files:**
- Create: `packages/cli/src/runtime-send.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/README.md`
- Create: `packages/cli/test/runtime-send.test.ts`

- [ ] **Step 10.1: Write failing test — `runtimeSend` with InMemoryTransport completes one turn and prints final summary.**
- [ ] **Step 10.2: Implement command using `CodexRuntime` + `EventNormalizer.events()`.**

```ts
// pseudo
export async function runtimeSend(opts: { transport: Transport; prompt: string }) {
  const client = new AppServerClient(opts.transport, ...);
  const broker = new ApprovalBroker(client);
  broker.attach();
  await client.start();
  const handshake = await performInitializeHandshake(client, { name: "codex-im-cli", title: null, version });
  const runtime = new CodexRuntime(client);
  const thread = await runtime.threadStart({});
  const turn = await runtime.turnStart({ threadId: thread.threadId, input: [{ type: "text", text: opts.prompt, text_elements: [] }] });
  for await (const ev of runtime.events.events()) {
    process.stdout.write(JSON.stringify(ev) + "\n");
    if (ev.type === "turn_completed") break;
  }
  await client.stop();
}
```

- [ ] **Step 10.3: Subcommand wiring + README + safety rails (read-only sandbox + default-reject through ApprovalBroker — same as smoke).**
- [ ] **Step 10.4: Test, typecheck, lint, commit.**

```bash
git commit -m "feat(cli): codex-im runtime send (P1 dev tooling)"
```

**Exit criteria:** `pnpm runtime:send -- --prompt 'Reply OK'` runs end-to-end against real codex with same safety rails as smoke.

---

### Task 11a: Daemon Supervisor skeleton (P1.4 part 1) **[lead session]**

(Split per plan-eng-review P1-3; rewritten after Codex B7 — Supervisor owns the transport spawn and subscribes to `transport.onClose`, not the nonexistent `client.onClose`.)

**Codex B7 background:** `AppServerClient` has no public `onClose` API; `handleClose` is private and the constructor itself subscribes to `transport.onClose`. Phase 0's JSDoc documents the supervisor pattern as "observes `client.transport.onClose`" — meaning the supervisor either holds a transport reference directly or owns the spawn that produces it. The cleaner design is: **Supervisor owns the spawn → subscribes to transport.onClose → constructs AppServerClient passing that transport**. No new public surface on `AppServerClient`. Nothing in Phase 0 contracts changes.

**Files:**
- Create: `packages/daemon/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`
- Create: `packages/daemon/src/supervisor.ts`
- Create: `packages/daemon/test/supervisor.test.ts`

- [ ] **Step 11a.1: Skeleton (mirror T3 — package.json/tsconfig/index/types/README/vitest.config) — commit separately.**
- [ ] **Step 11a.2: Write failing test — `Supervisor.start()` constructs transport+client; on transport close, constructs **new** transport+client (object identity differs).**
- [ ] **Step 11a.3: Implement supervisor — owns spawn + transport subscription (Codex B7).**

```ts
import type { Transport, AppServerClient, AppServerClientOptions } from "@codex-im/app-server-client";

export interface SupervisorOptions {
  // Spawns a fresh transport on every recovery; supervisor owns the subprocess lifecycle.
  transportFactory: () => Transport;
  // Constructs a client given a transport. Decoupled from transportFactory so tests can
  // pass an InMemoryTransport without spawning a real process.
  clientFactory: (transport: Transport, opts?: AppServerClientOptions) => AppServerClient;
  broker: ApprovalBroker;        // .attach(client) re-attaches per spawn
  runtimeFactory: (c: AppServerClient) => CodexRuntime;
  audit: { emitFatal(msg: string): void; emit(msg: string): void };
  performHandshake: (c: AppServerClient) => Promise<unknown>;
}

export class Supervisor {
  #currentTransport: Transport | null = null;
  #currentClient: AppServerClient | null = null;
  #closing = false;
  #closeUnsub: (() => void) | null = null;

  constructor(private opts: SupervisorOptions) {}

  async start(): Promise<void> { await this.#spawnFresh(); }

  async #spawnFresh(): Promise<void> {
    // Codex B7: subscribe to transport.onClose BEFORE constructing the client,
    // so we never miss a close event during client setup.
    const transport = this.opts.transportFactory();
    this.#currentTransport = transport;
    this.#closeUnsub = transport.onClose((code) => this.#onTransportClose(code));

    const client = this.opts.clientFactory(transport);
    this.#currentClient = client;

    // ApprovalBroker is the single owner of client.setServerRequestHandler (D7).
    // attach() throws if the broker is already attached to a different client; T9b
    // adds reattach(client) to support supervisor recovery without leaking the prior client.
    this.opts.broker.reattach(client);

    await client.start();
    await this.opts.performHandshake(client);
    const _runtime = this.opts.runtimeFactory(client);
    // Note: T7's normalizer subscribes to client.onNotification inside its constructor.
    // The supervisor does NOT call client.onClose — there is no such API. Close detection
    // flows from transport.onClose only.
  }

  // T11b: implement transport-close idempotence + backoff + halt
  #onTransportClose(_code: number | null) { throw new Error("T11b"); }
}
```

- [ ] **Step 11a.4: Tests (skeleton scope only):**
  1. **Fresh transport+client per spawn** — assert object identity of both differs after a simulated transport close.
  2. **`broker.reattach` called once per spawn** — assert mock spy count.
  3. **Subscribe-before-spawn ordering** — using a transport that emits `onClose` synchronously inside its constructor, assert the supervisor still receives it (proves the subscription happens before the client construction races).
  4. **No zombie listeners** — old transport's `onClose` handler does not fire after a new transport is in place.
- [ ] **Step 11a.5: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 11a.6: Commit.**

```bash
git commit -m "feat(daemon): Supervisor skeleton — owns transport spawn (P1.4 part 1; Codex B7)

Supervisor owns transport spawn and subscribes to transport.onClose
BEFORE constructing AppServerClient. No dependency on a (nonexistent)
client.onClose API. Fresh transport+client per spawn,
object-identity-asserted. broker.reattach() per spawn. T11b lands
backoff + halt + close-idempotence."
```

**Exit criteria:** Supervisor never references `client.onClose`; subscribe-before-spawn ordering proven by test; ONE-SHOT invariant proven by object-identity assertions; no zombie listener test passes; ci-check green.

---

### Task 11b: Supervisor edges + reviews (P1.4 part 2) **[lead session]**

**Files:**
- Modify: `packages/daemon/src/supervisor.ts`
- Modify: `packages/daemon/test/supervisor.test.ts`

- [ ] **Step 11b.1: Implement `#onTransportClose` with idempotence + bounded exponential backoff + halt-on-cascade.**

```ts
#onTransportClose(code: number | null) {
  // Codex required-test "Supervisor close idempotence test": concurrent close events
  // call transport-loss cleanup ONCE.
  if (this.#closing) return;
  this.#closing = true;

  // D6: pending approvals fail-as-transport-lost (T9b API)
  this.opts.broker.failPendingAsTransportLost();
  // Pending turns: T7's runtime emits a synthetic `turn_failed` for each pending turn (T7b extension)
  // (delivered through the EventNormalizer; no separate runtime API needed)

  this.opts.audit.emit(`transport closed (code=${code}); cleanup complete`);

  this.#consecutiveFailures++;
  if (this.#consecutiveFailures >= 5) {
    this.opts.audit.emitFatal("supervisor halted: 5 consecutive transport closes");
    return;
  }
  setTimeout(async () => {
    this.#closing = false;
    try { await this.#spawnFresh(); }
    catch (e) { this.opts.audit.emitFatal(`spawnFresh failed: ${(e as Error).message}`); }
  }, this.#backoff());
}

#backoff(): number {
  // 500ms → 1s → 2s → 4s → 8s
  return 500 * (1 << Math.min(this.#consecutiveFailures - 1, 4));
}
```

- [ ] **Step 11b.2: Tests:**
  1. **Close idempotence under concurrent events** (Codex required-test) — fire `transport.onClose` twice in quick succession; assert `broker.failPendingAsTransportLost()` called exactly once, audit fires once.
  2. Pending approvals from old client are marked `transport_lost` (D6) — wired through `broker.failPendingAsTransportLost()`.
  3. Pending turns from old runtime emit synthetic `turn_failed (transport_lost)` event through the normalizer.
  4. Exponential backoff bounded (500ms → 1s → 2s → 4s → 8s).
  5. 5 consecutive failures → halt + emit fatal audit; no further `#spawnFresh` calls.
- [ ] **Step 11b.3: Codex outside-voice review.** Specifically ask:
  1. "do we ever reuse a closed AppServerClient?"
  2. "does any branch leak the prior runtime reference?"
  3. "is `failPendingAsTransportLost` called exactly once per close, even under concurrent close events?"
  4. "is the close subscription always installed before any wire activity could trigger it?"
  Capture in `docs/phase-1/supervisor-review.md`.
- [ ] **Step 11b.4: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 11b.5: Commit.**

```bash
git commit -m "feat(daemon): Supervisor edges + reviews (P1.4 part 2; Codex B7 + close-idempotence)

Close idempotence under concurrent events (#closing latch).
Bounded exponential backoff (500ms..8s) with 5-failure halt and
fatal audit. Pending approvals (D6) auto-fail as transport_lost
via broker.failPendingAsTransportLost(). Pending turns emit
synthetic turn_failed event. Outside-voice review captured."
```

**Exit criteria:** all supervisor tests pass including close-idempotence + transport-loss propagation + halt cascade; outside-voice review captured.

---

### Task 12: Documentation + roadmap update

**Files:**
- Modify: `09-ROADMAP.md` (Phase 1 verification matrix → mark done with commit refs)
- Modify: `TODOS.md` (move Phase 1 backlog → Done; lift Phase 2 forward)
- Modify: `05-CODEX-APP-SERVER-PROTOCOL.md` §3/§4.1 (only fields confirmed by fixture)
- Modify: `README.md` (Phase 1 status section)
- Create: `docs/handoffs/<DATE>-phase1-to-phase2.md` (skeleton modeled on Phase 0→1 handoff)
- Create: `docs/superpowers/plans/decision-log.md` entries D5–D9
- Update: `packages/{codex-runtime,core,daemon}/README.md`

- [ ] **Steps 12.1–12.6:** edit each doc; run `pnpm test typecheck lint`; commit individually for clean PR history.
- [ ] **Step 12.7: Tag** `phase-1-runtime-complete` only after the integrated review (below).

**Exit criteria:** every Phase 1 backlog item in TODOS.md marked done with commit hash; 09-ROADMAP Phase 1 section shows ✅; handoff to Phase 2 ready for next-session bootstrap.

---

## 6. Verification commands

After **every** task (mandatory for subagents before claiming done — P1-4):

```bash
bash scripts/ci-check.sh    # bundles check:codex-version + typecheck + test + lint + protocol:check
```

End-of-phase exit gate (before tagging):

```bash
bash scripts/ci-check.sh && pnpm audit
CODEX_SMOKE=1 pnpm smoke:app-server                # initialize unchanged
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn            # legacy harmless prompt still passes
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn -- --capture /tmp/phase1-final.jsonl --prompt-file packages/cli/src/prompts/richer-turn.txt
node scripts/redact-fixture.mjs < /tmp/phase1-final.jsonl > /tmp/phase1-final.redacted.jsonl
diff /tmp/phase1-final.redacted.jsonl packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl || true
# diff is informational — model output may vary; structural similarity expected
```

Plus integrated outside-voice + plan-eng-review on the **whole-phase diff** before tagging.

---

## 7. Failure modes & rollback

| Mode | Detection | Rollback |
|---|---|---|
| Fixture spike (T4) cannot trigger any server-initiated approval after 3 prompt iterations | `phase1-richer-turn-server-request.jsonl` empty; **T4.5 acceptance gate exits 1** | Revert T4 commits; open issue documenting which `approval_policy` reliably triggers requests; T4.5 **hard-blocks** T7/T9 until resolved (do not write ApprovalBroker tests against a fabricated fixture) |
| EventNormalizer delta queue overflow in real run (D5 revised) | `normalizer_overflow` synthetic event with `class: "delta"` observed during T11 supervisor smoke | Tighten delta cap, add coalescing in renderer (Phase 2 work); record in known-issues. Lifecycle queue is unbounded by design — overflow there indicates a different bug |
| EventNormalizer lifecycle event observed dropped | `normalizer_overflow` synthetic with `class: "lifecycle"` — should be **impossible** by D5 revised contract | This is a critical bug, not a tuning issue. Halt phase, file issue, fix code path before continuing |
| ApprovalBroker dispatch table missing a generated union arm | TypeScript compile error on next `pnpm protocol:generate` after codex upgrade | Add the arm + dispatcher; this is the **intended** type-level guard (D7), not a failure |
| Supervisor spawns infinite-fail loop | 5+ consecutive transport closes within backoff window | Halt + emit fatal audit (built into T11b). Operator runs `codex --version`, `codex login`, then restarts daemon manually |
| Generated `ServerRequest`/`ServerNotification` shape changes mid-Phase | `pnpm protocol:check` fails or fixture replay fails | `pnpm check:codex-version` should have already failed first. If it passed, treat as upstream codex regression: pin codex version downward, file issue, do not "fix" by editing generated types |
| `pnpm audit` introduces non-zero vulnerabilities during Phase 1 | exit code ≠ 0 | Do not silence. Bump deps minimally + retest before continuing |
| Phase 1 PR conflicts with main on `09-ROADMAP.md` because Phase 0 was retroactively edited | merge conflict | Resolve in favor of more-recent timestamp; never overwrite Phase 0 closure |
| Subagent claims a task "done" without running gates | reviewer cannot reproduce green | Subagent must run `bash scripts/ci-check.sh` (P1-4) before claiming done; reject any PR/handoff that doesn't show ci-check output |

---

## 8. Worktree parallelization

Recommended sequence — using `git worktree` per Phase 0 plan v2 conventions. T1 lands first (its `ErrorCategory` is referenced by T7b/T9b/T11b tests), then the other Phase 1A worktrees rebase onto it.

```text
worktree-T1    feat/p1.5-categorize-error      → ready immediately, lands first

# rebase next three onto main after T1:
worktree-T2    feat/p1.6-capture-flag          → ready after T1
worktree-T3    feat/codex-runtime-skeleton     → ready after T1 (also lands ci-check.sh + redact-fixture.mjs)
worktree-T5    feat/core-skeleton              → ready after T1

# merge T1+T2+T3+T5 → integration branch phase-1-foundations
# from foundations (lead-only, sequential gate):

worktree-T4    feat/p1.6-fixture-spike         → lead-only, real codex spawn
# T4.5 acceptance gate runs INSIDE the T4 worktree (single-step) — gate must exit 0 before merge

worktree-T6    feat/method-name-helpers        → quick, sequential after T3

# from foundations + T4.5-passed + T6 (Phase 1C, three parallel lanes):

worktree-T7a   feat/p1.3-normalizer-skeleton   → lead session
worktree-T7b   feat/p1.3-normalizer-edges      → lead session, after T7a merges
worktree-T8    feat/p1.1-runtime-wrappers      → subagent
worktree-T9a   feat/p1.2-broker-skeleton       → lead session
worktree-T9b   feat/p1.2-broker-edges          → lead session, after T9a merges
# T7a/b, T8, T9a/b lanes parallel; merge into phase-1-runtime-core

# from runtime-core (Phase 1D, sequential):

worktree-T10   feat/p1.7-runtime-send-cli      → subagent
worktree-T11a  feat/p1.4-supervisor-skeleton   → lead session
worktree-T11b  feat/p1.4-supervisor-edges      → lead session, after T11a merges
worktree-T12   docs/phase-1-closeout           → subagent
```

Each worktree must run `bash scripts/ci-check.sh` locally before merge (P1-4). Lead session does final integration review + tag.

**Conflict flags:** T7a→T7b, T9a→T9b, T11a→T11b each touch the same primary file inside a package, so `b` always rebases on `a`'s merge. No cross-package conflicts expected.

---

## 9. GSTACK REVIEW REPORT (template — to be filled after `/plan-eng-review`)

> Fill this section after the Phase 1 plan goes through gstack `/plan-eng-review`. Phase 0 plan v2 had 11 issues caught here; expect similar volume.

```text
Reviewer: gstack /plan-eng-review
Date: <after review>
Verdict: <pass | request changes>
Issues:
  P1: ...
  P2: ...
  P3: ...
Resolutions:
  ...
```

---

## 10. Codex outside-voice REPORT (template)

```text
Reviewer: codex 0.125.0 via `codex review`
Date: <after review>
Verdict: <pass | request changes>
Issues by group:
  Group 1 (architecture): ...
  Group 2 (correctness): ...
  Group 3 (testability): ...
Resolutions:
  ...
```

---

## 11. Self-review checklist (writing-plans skill §Self-Review)

- [x] Spec coverage: P1.1–P1.6 + CLI `runtime send` + 05-PROTOCOL §3/§4.1 doc maintenance — each maps to T7a/T7b (P1.3), T8 (P1.1), T9a/T9b (P1.2), T11a/T11b (P1.4), T1 (P1.5), T2+T4+T4.5 (P1.6), T10 (CLI), T12 (docs). Pre-1 + Pre-2 cover Codex-flagged prerequisites (Node bump, protocol facade).
- [x] No placeholders: every step has either a code block, a command, or an unambiguous file path.
- [x] Type consistency: `ApprovalDecision` + `ApprovalActor` shape used identically in T5 (definition) and T9a/T9b (consumer); `CodexRichEvent` discriminated union introduced in T3 (with `turn_failed` / `turn_interrupted` added in T7b for status mapping) and consumed in T7a/T7b; `EventClass` classification table type-checked exhaustive in T7a; `DispatchTable` exhaustive over `ServerRequest["method"]` in T9a.
- [x] No backwards-compat shims (Phase 0 contracts only extended, never refactored). Codex B7 fix: Supervisor uses `transport.onClose` per Phase 0 JSDoc, no new public surface on `AppServerClient`.
- [x] Every task has explicit verification commands (`bash scripts/ci-check.sh` after T3) and exit criteria.
- [x] Sequential vs parallel windows declared (Pre-1 → Pre-2 → Phase 1A parallel → 1B + 1B′ sequential → 1C parallel lanes with internal a→b sequencing → 1D sequential).
- [x] Subagent / outside-voice / `/plan-eng-review` assignments declared per task.
- [x] Plan-eng-review P0/P1 fixes applied inline (D5 revised, fixture path preserved, ApprovalRecord.actor added, T4.5 gate inserted, T7/T9/T11 split, ci-check.sh + redact-fixture.mjs added).
- [x] Codex outside-voice fixes applied inline (Pre-1 Node 24 bump, Pre-2 protocol facade, D5 final / single-FIFO, T2 --prompt-file/--cwd + vitest-exclusion fix, T4 capture command fixed, T4.5 = committed verify-phase1-fixtures.mts, T6 derived from METHOD_CLASS, T7b turn.status mapping + ordering test + iterator semantics, T8 thread/interrupt → turn/interrupt, T9 exhaustive Record + per-method v2 mappers + non-approval default-rejects, T11 transport-owned with close idempotence).

---

## 12. Open questions — RESOLVED (twice)

Decisions reached after plan-eng-review (2026-04-30) and Codex outside-voice (2026-04-30):

1. **Fixture-capture target dir** — **resolved**. Capture runs in `/tmp/codex-fixture-spike` (outside repo, to avoid sandbox writes during real codex spawn). Captured + redacted output lands in `packages/testkit/fixtures/codex-0.125.0/phase1-*.jsonl` (version-pinned dir preserved per P0-2; phase tracing via filename prefix). Capture command stays in repo root with `--cwd` flag controlling subprocess working dir (Codex B2 fix).
2. **Node target for new packages** — **reversed by Codex outside-voice 2026-04-30**. Today is Node 20 EOL. Bump to Node 24 (Active LTS) as Pre-1, a standalone PR off `phase-0-bootstrap` with full Phase 0 gate re-run. Pre-1 is a prerequisite of Phase 1, not a Phase 1 task. See §0.4 Pre-1 for scope.
3. **CI integration timing** — **resolved**. Phase 1 ships `scripts/ci-check.sh` (local subagent gate, P1-4) but defers GitHub Actions workflow to Phase 2 hygiene as TODOS already lists. The local gate is mandatory before any subagent claims a task done.
4. **`@codex-im/protocol` facade scope** — **resolved by Codex B3**. Phase 0 facade exposes only initialize types. Phase 1 needs `ServerRequest`, `ServerNotification`, `ClientRequest`, plus the per-method params/responses enumerated in §0.4 Pre-2. Ships as Pre-2 prerequisite PR; Phase 1 imports cannot start until merged.

---

**Status:** Plan-eng-review P0/P1 + Codex outside-voice B1–B8 fixes applied inline (2026-04-30). Plan now ready for:

1. gstack `/plan-eng-review` — already run on 2026-04-30; report below
2. Codex outside-voice — already run on 2026-04-30; report below
3. **Pre-1 (Node 24 bump) PR** off `phase-0-bootstrap` — full Phase 0 gate re-run
4. **Pre-2 (protocol facade) PR** off Pre-1 — narrow facade expansion
5. Begin Phase 1 execution per `superpowers:subagent-driven-development` (recommended) — fresh subagent per task with two-stage review
6. **Pre-3 (`AppServerClient` JsonRpcResponseError propagation) PR** off `phase-1-runtime` HEAD after T8 — added late as a mid-Phase-1 prerequisite discovered during T9a-prep drift audit; gates T9a only (T7/T8 lanes are unaffected).

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run; Phase 1 is foundations, not a product/strategy change |
| Codex Review | `codex review` (outside voice) | Independent 2nd opinion | 1 | **APPROVE WITH CHANGES → CHANGES APPLIED** | 8 blockers (B1 verify-script, B2 capture command, B3 protocol facade, B4 queue ordering, B5 Set non-exhaustive, B6 Map non-exhaustive, B7 client.onClose absent, B8 thread/interrupt non-existent) + Node 24 advice + 7 missing tests + 4 risky-assumption notes. All 8 blockers resolved inline; tests folded into respective tasks; risky assumptions documented in T4 prompt-design step. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | **APPROVE WITH CHANGES → CHANGES APPLIED** | 3 P0 (D5 revise, fixture path, Node target), 5 P1 (ApprovalRecord.actor, T4.5 gate, T7/T9/T11 split, ci-check.sh, redact script), 5 P2 — all P0+P1 applied inline (Node decision later reversed by Codex outside-voice; see Open question #2) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI in Phase 1 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | n/a | no developer-facing surface in Phase 1 |

- **CROSS-MODEL:** Eng Review and Codex outside-voice converged on 7/8 of the same architectural concerns (queue design, exhaustive method dispatch, non-hardcoded method names, T7/T9/T11 split, fixture gate hardness, ci-check.sh hygiene). They DISAGREED on Node 24: Eng Review rejected the bump to preserve Phase 0 contract; Codex outside-voice approved on the basis that today is Node 20 EOL and the bump can land as a standalone Pre-1 PR with full Phase 0 re-run. The Codex argument is stronger — Pre-1 was added.
- **UNRESOLVED:** 0 (all blockers + P0+P1 applied; P2 deferred but tracked).
- **VERDICT:** ENG REVIEW CLEARED + CODEX OUTSIDE-VOICE CLEARED — ready for Pre-1 + Pre-2 prerequisite PRs, then Phase 1 execution.

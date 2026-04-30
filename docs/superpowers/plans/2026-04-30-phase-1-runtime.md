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

---

## 1. Decision Log (Phase 1)

Numbering continues from Phase 0 (D1–D4). Each decision must have a write-up in `docs/superpowers/plans/decision-log.md` after merge.

### D5 — EventNormalizer backpressure: two-class queue, lifecycle unbounded, deltas drop-oldest (revised after plan-eng-review P0-3)

**Question:** When raw notifications arrive faster than the async iterator consumer drains, what happens?

**Options considered:**
- (A) Unbounded queue — risk OOM under 1000-delta/sec scenarios
- (B) Single bounded queue, drop oldest on overflow — risks dropping `turn/started`, `item/*/requestApproval`, or other load-bearing lifecycle events
- (C) Backpressure to `client.onNotification` — impossible; notifications are stateless callbacks
- (D) Two-class queue: lifecycle events unbounded, delta events bounded with drop-oldest + overflow synthetic event

**Decision:** **D**. Classify each notification on enqueue into one of two classes via a method-prefix table:

- **Lifecycle class (unbounded):** `turn/{started,completed,failed,interrupted}`, `thread/{started,closed,...}`, `item/{started,completed}`, all `item/*/requestApproval` and other `ServerRequest`-correlated frames, `error`, `warning`, `guardianWarning`, `model/*`, `thread/tokenUsage/updated`. These are O(N) per turn (not per token), so OOM risk is bounded by turn count and acceptable.
- **Delta class (bounded, default cap 4096, drop-oldest):** `*/delta`, `*/outputDelta`, `*/textDelta`, `*/patchUpdated` (the high-frequency byproduct streams). On overflow, drop oldest and emit `{ type: "normalizer_overflow", droppedCount, class: "delta" }` synthetic event.

Classification table is type-level-checked (D7-style): the prefix-to-class map's domain must equal `ServerNotification["method"]` union, so a new method that isn't classified causes a compile error.

**Reason:** Phase 1 has no renderer yet, so dropping a `turn/started` would corrupt runtime state without recourse. Lifecycle events are inherently rate-limited by codex's per-turn structure; deltas are the only events that can burst. Splitting the classes preserves the safety property "every state-machine transition is observed" while keeping bounded memory under delta storms. Cost: ~10 LOC over the single-queue version, all type-checked.

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

### Dependency graph (revised after plan-eng-review: T1 first; T4.5 hard gate; T7/T9/T11 split per P1-3)

```text
T1 (categorizeJsonRpcError) ───┐   ← first to land — pure helper, zero deps; ErrorCategory used by T7/T9/T11 tests
T2 (--capture flag CLI)     ───┤
T3 (codex-runtime skeleton) ───┼──► T4 (fixture spike, lead, real $) ──► T4.5 (acceptance gate, lead) ──┐
T5 (core skeleton)          ───┘                                                                          │
                                                                                                           ▼
                                                                T6 (ServerNotification narrowing helpers)
                                                                                  │
              ┌───────────────────────────────────────────────────────────────────┼───────────────────────────────┐
              ▼                                                                   ▼                               ▼
   T7a (Normalizer skeleton + happy path)              T8 (CodexRuntime wrappers)           T9a (Broker skeleton + happy path)
              │                                                                                                 │
              ▼                                                                                                 ▼
   T7b (overflow + unknown + terminal + 2-class queue + reviews)                                T9b (timeout + throw + transport-loss + reviews)
              └───────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                                          ▼
                                                T10 (codex-im runtime send)
                                                          │
                                                          ▼
                                                T11a (Supervisor skeleton — fresh-client + re-attach)
                                                          │
                                                          ▼
                                                T11b (backoff + halt + transport-loss propagation + outside-voice review)
                                                          │
                                                          ▼
                                                T12 (docs + roadmap update)
```

### Parallelization windows

- **Phase 1A (parallel, no deps):** T1, T2, T3, T5 — four worktrees concurrently. T1 should land first since later tests reference its `ErrorCategory` type.
- **Phase 1B (sequential gate, lead-only):** T4 → **T4.5 acceptance gate** — single worktree, real codex spawn. T4.5 must pass (≥1 valid `ServerRequest` frame matching generated union) before any T7/T9 work.
- **Phase 1B′ (sequential after T3):** T6.
- **Phase 1C (parallel, T4.5+T6 done):** T7a → T7b, T8, T9a → T9b — three lanes concurrently. Each lane is internally sequential (skeleton before edges).
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

### Task 2: `--capture` flag in `smoke-real-turn` (P1.6 capture tool)

**Files:**
- Modify: `packages/cli/src/smoke-real-turn.ts`
- Modify: `packages/cli/src/index.ts` (subcommand wiring)
- Modify: `packages/cli/README.md`
- Create: `packages/cli/test/smoke-real-turn-capture.test.ts` (unit, no subprocess)

- [ ] **Step 2.1: Write failing test — `--capture <path>` writes JSONL of every inbound message**

```ts
// packages/cli/test/smoke-real-turn-capture.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@codex-im/testkit";
import { runSmokeRealTurnWithCapture } from "../src/smoke-real-turn.js";

describe("smoke-real-turn --capture", () => {
  it("writes one JSONL line per inbound message", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "capture-"));
    const file = join(tmp, "out.jsonl");
    const transport = new InMemoryTransport();
    // ... seed transport with 3 fake notifications + 1 response
    await runSmokeRealTurnWithCapture({ transport, capturePath: file, harmlessPrompt: "Reply OK" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(4);
    expect(JSON.parse(lines[0])).toMatchObject({ method: "..." });
  });
});
```

- [ ] **Step 2.2: Run, verify FAIL** (`runSmokeRealTurnWithCapture` not exported).
- [ ] **Step 2.3: Refactor `smoke-real-turn.ts` to expose injectable transport + capture writer**

Extract transport construction into a factory parameter; default = real `StdioTransport`. Add `capturePath` option that opens a write stream and pipes every transport `onMessage` payload as `JSON.stringify(msg) + "\n"`.

- [ ] **Step 2.4: Run unit test, verify PASS.**
- [ ] **Step 2.5: Add `--capture <path>` arg parsing in `cli/src/index.ts`.**

```ts
// pseudo-flag; respect existing arg-parser style
if (args.includes("--capture")) {
  const idx = args.indexOf("--capture");
  capturePath = args[idx + 1];
}
```

- [ ] **Step 2.6: Update `packages/cli/README.md`** documenting `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn -- --capture <path>`.
- [ ] **Step 2.7: Run full suite + typecheck + lint.**
- [ ] **Step 2.8: Commit.**

```bash
git commit -m "feat(cli): smoke:real-turn --capture <path> flag (P1.6 part 1)

Writes one JSONL line per inbound message to <path> for fixture
capture. No-op if --capture absent. Tested with InMemoryTransport;
real subprocess capture exercised in T4."
```

**Exit criteria:** unit test passes against `InMemoryTransport`; CLI accepts flag; README documents usage; default behavior unchanged.

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
- [ ] **Step 4.3: Run capture:**

```bash
mkdir -p /tmp/codex-fixture-spike
cd /tmp/codex-fixture-spike
CODEX_REAL_SMOKE=1 pnpm --filter @codex-im/cli smoke:real-turn -- \
  --capture $(pwd)/raw-stream.jsonl \
  --prompt-file packages/cli/src/prompts/richer-turn.txt
```

Expected: real codex spawn, ≥1 approval request, all events captured, smoke exits cleanly with default-reject.

- [ ] **Step 4.4: Inspect raw capture — confirm presence of:**
  - `turn/started`
  - ≥1 `item/agentMessage/delta`
  - ≥1 `item/{commandExecution|fileChange}/requestApproval`
  - `turn/completed`
- [ ] **Step 4.5: Split capture into two fixtures + redact via the script (P1-5).**

`phase1-richer-turn-event-stream.jsonl` = notifications only.
`phase1-richer-turn-server-request.jsonl` = the server-request frame(s) only.

```bash
# split + redact (idempotent; script is committed in T3)
grep -E '^\{[^}]*"method":[^}]*\}$' raw-stream.jsonl \
  | grep -v '"id":' \
  | node scripts/redact-fixture.mjs \
  > packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl

grep -E '^\{[^}]*"id":[0-9]+,[^}]*"method":' raw-stream.jsonl \
  | node scripts/redact-fixture.mjs \
  > packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl
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

### Task 4.5: Fixture acceptance gate **[lead session, single step]**

(NEW per plan-eng-review P1-2.) One-step task that hard-blocks T7/T9 if T4 didn't produce a usable server-request capture. Cannot be subagent-delegated.

**Files:** none created; this is a verification step.

- [ ] **Step 4.5.1: Verify the captured server-request fixture meets the gate.**

```bash
node -e '
import { readFileSync } from "node:fs";
import type { ServerRequest } from "@codex-im/protocol";

const lines = readFileSync(
  "packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl",
  "utf8",
).trim().split("\n").filter(Boolean);

if (lines.length < 1) {
  console.error("GATE FAIL: zero server-request frames captured");
  process.exit(1);
}

for (const line of lines) {
  const frame = JSON.parse(line);
  if (typeof frame.method !== "string" || frame.id == null) {
    console.error("GATE FAIL: frame missing method or id:", line);
    process.exit(1);
  }
  // Type-level discrimination: method MUST be assignable to ServerRequest["method"]
  // (script-level — the actual TS check happens in T9 dispatch test)
}

console.log(`GATE PASS: ${lines.length} server-request frame(s) captured`);
' --input-type=module
```

If exit code ≠ 0: STOP. Do not start T7, T8, or T9. Loop back to T4 with a different prompt or `approval_policy` setting. Document the rollback in `docs/phase-1/fixture-prompt-review.md`.

**Exit criteria:** script exits 0 with `GATE PASS: N server-request frame(s) captured` where N ≥ 1.

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

### Task 6: `method-names.ts` — typed narrowing helpers

**Files:**
- Create: `packages/codex-runtime/src/method-names.ts`
- Create: `packages/codex-runtime/test/method-names.test.ts`

- [ ] **Step 6.1: Write failing test — `isServerNotificationMethod("turn/started") === true`, `=== false` for unknown.**
- [ ] **Step 6.2: Implement helper using generated union from `@codex-im/protocol`**

```ts
// packages/codex-runtime/src/method-names.ts
import type { ServerNotification } from "@codex-im/protocol";

export type ServerNotificationMethod = ServerNotification["method"];

const KNOWN_METHODS: ReadonlySet<ServerNotificationMethod> = new Set<ServerNotificationMethod>([
  // Type-level enforcement: TS errors here if generated union shrinks
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  // ... full list pulled from generated ServerNotification.ts; engineer enumerates ALL
]);

export function isServerNotificationMethod(m: string): m is ServerNotificationMethod {
  return KNOWN_METHODS.has(m as ServerNotificationMethod);
}
```

⚠ **Maintenance note:** the engineer must enumerate the full union — TypeScript will fail to narrow if any arm is missing because `Set<Union>` accepts a strict subset. Do not use `Set<string>`. The compile-time guarantee is the whole point.

- [ ] **Step 6.3–6.5:** verify test passes; typecheck; lint; commit.

```bash
git commit -m "feat(codex-runtime): typed ServerNotification method-name helpers"
```

**Exit criteria:** `isServerNotificationMethod` narrows to generated union; adding a fake string fails typecheck; existing tests green.

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

- [ ] **Step 7a.4: Implement minimal normalizer (happy path only — no overflow yet)**

```ts
// packages/codex-runtime/src/event-normalizer.ts
import type { AppServerClient, JsonRpcNotification } from "@codex-im/app-server-client";
import { isServerNotificationMethod } from "./method-names.js";
import { classifyMethod } from "./event-class.js";
import type { CodexRichEvent } from "./types.js";

export type NormalizerOptions = { deltaQueueCap?: number };

export class EventNormalizer {
  #lifecycleQueue: CodexRichEvent[] = [];   // unbounded — D5 revised
  #deltaQueue: CodexRichEvent[] = [];       // bounded
  #waiters: Array<(ev: IteratorResult<CodexRichEvent>) => void> = [];
  #closed = false;
  #unsub: () => void;
  #deltaCap: number;
  #droppedDeltaCount = 0;

  constructor(client: AppServerClient, opts: NormalizerOptions = {}) {
    this.#deltaCap = opts.deltaQueueCap ?? 4096;
    this.#unsub = client.onNotification((msg) => this.#onNotification(msg));
  }

  #onNotification(msg: JsonRpcNotification) {
    const m = msg.method;
    if (!isServerNotificationMethod(m)) {
      this.#lifecycleQueue.push({ type: "unknown", method: m, params: msg.params });
      this.#drain();
      return;
    }
    const cls = classifyMethod(m);
    const ev = this.#mapNotification(msg);
    if (cls === "lifecycle") {
      this.#lifecycleQueue.push(ev);
    } else {
      // T7b: implement bounded drop-oldest + overflow synthetic
      this.#deltaQueue.push(ev);
    }
    this.#drain();
  }

  #mapNotification(msg: JsonRpcNotification): CodexRichEvent {
    // T7b: full exhaustive switch over ServerNotification union; T7a does turn/started + turn/completed only
    /* implementer: see T7b for full mapping */ return { type: "unknown", method: msg.method, params: msg.params };
  }

  events(): AsyncIterable<CodexRichEvent> {
    return { [Symbol.asyncIterator]: () => this.#asyncIterator() };
  }

  // FIFO across both queues, lifecycle drained first when both have items
  // (bounded queue can starve under burst, but lifecycle frequency << delta frequency)
  #asyncIterator(): AsyncIterator<CodexRichEvent> { /* ... see T7b for full impl */ throw new Error("T7b"); }
  #drain() { /* T7b */ }
  #close() { /* T7b */ }
}
```

- [ ] **Step 7a.5: Run test, verify PASS for happy path + late subscriber.**
- [ ] **Step 7a.6: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 7a.7: Commit.**

```bash
git commit -m "feat(codex-runtime): EventNormalizer skeleton + classification table (P1.3 part 1)

Two-class queue (D5 revised): lifecycle unbounded, delta bounded.
Classification table is type-checked exhaustive over
ServerNotification union. T7b lands overflow + unknown + terminal."
```

**Exit criteria:** happy-path test + late-subscriber test pass; classification table compiles exhaustively; ci-check green.

---

### Task 7b: `EventNormalizer` edges + reviews (P1.3 part 2) **[lead session]**

**Files:**
- Modify: `packages/codex-runtime/src/event-normalizer.ts` (fill in T7a stubs)
- Modify: `packages/codex-runtime/test/event-normalizer.test.ts`
- Create: `packages/codex-runtime/test/event-normalizer-fixture.test.ts`

- [ ] **Step 7b.1: Add coverage for each `ServerNotification` arm** — one test per method, asserting correct `CodexRichEvent.type` mapping.
- [ ] **Step 7b.2: Implement full exhaustive `#mapNotification` switch over the generated `ServerNotification` union.** Use TypeScript exhaustiveness check (`const _exhaustive: never = m;` in default branch).
- [ ] **Step 7b.3: Implement bounded delta queue + drop-oldest + overflow synthetic event.**

```ts
if (cls === "delta") {
  if (this.#deltaQueue.length >= this.#deltaCap) {
    this.#deltaQueue.shift();
    this.#droppedDeltaCount++;
    // emit overflow synthetic on the lifecycle queue so it's never itself dropped
    this.#lifecycleQueue.push({ type: "normalizer_overflow", droppedCount: this.#droppedDeltaCount, class: "delta" });
  }
  this.#deltaQueue.push(ev);
}
```

- [ ] **Step 7b.4: Lifecycle-never-dropped test** — push `cap + 100` deltas + interleave 5 `turn/started`; assert all 5 lifecycle events delivered, overflow synthetic appears, no lifecycle event missing. (Suggested test from review §"Suggested additional tests".)
- [ ] **Step 7b.5: Add overflow test — push `cap + 10` deltas, assert drop + overflow synthetic on lifecycle queue.**
- [ ] **Step 7b.6: Add unknown-method test — feed `{ method: "future/unseen", params: {} }`, assert `{ type: "unknown" }`, no throw.**
- [ ] **Step 7b.7: Add terminal-state test — feed `turn/completed`, assert iterator continues delivering then closes when caller calls `iterator.return()`.**
- [ ] **Step 7b.8: Add fixture replay test** — load `phase1-richer-turn-event-stream.jsonl`, feed each line into `transport.simulateInbound`, assert iterator yields exactly N events in order, terminal `turn_completed` present.
- [ ] **Step 7b.9: Add `for await ... of` integration test** — consume entire fixture.
- [ ] **Step 7b.10: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 7b.11: Codex outside-voice review on the diff** — `codex review` against the EventNormalizer files. Record findings in `docs/phase-1/event-normalizer-review.md`.
- [ ] **Step 7b.12: gstack `/plan-eng-review`** on the EventNormalizer module surface vs. plan.
- [ ] **Step 7b.13: Commit.**

```bash
git commit -m "feat(codex-runtime): EventNormalizer edges + reviews (P1.3 part 2)

Two-class queue with lifecycle never dropped, delta bounded with
drop-oldest + overflow synthetic on lifecycle queue. Exhaustive
ServerNotification union mapping. Fixture replay test against
phase1-richer-turn-event-stream.jsonl. Outside-voice + plan-eng-review
captured in docs/phase-1/event-normalizer-review.md."
```

**Exit criteria:** all unit + fixture replay tests pass; lifecycle-never-dropped test proves D5 revised invariant; iterator closes cleanly on terminal events; unknown methods do not crash; outside-voice + plan-eng-review captured.

---

### Task 8: `CodexRuntime` typed wrappers (P1.1)

**Files:**
- Create: `packages/codex-runtime/src/runtime.ts`
- Create: `packages/codex-runtime/src/state.ts`
- Create: `packages/codex-runtime/test/runtime.test.ts`

- [ ] **Step 8.1: Write failing test — `runtime.threadStart({})` returns `ThreadStartResponse` from generated types.**
- [ ] **Step 8.2: Implement minimal wrappers — one per `ClientRequest` arm we expose in Phase 1**

Methods to wrap (per TODOS P1.1):
- `thread/start`, `thread/resume`, `thread/fork`, `thread/interrupt`, `thread/turns/list`, `thread/read`
- `turn/start`, `turn/steer`, `turn/interrupt`
- `review/start`

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

**Files:**
- Create: `packages/core/src/approval-broker.ts`
- Create: `packages/core/test/approval-broker.test.ts`
- Create: `packages/core/test/approval-broker-dispatch.test.ts`
- Create: `packages/core/test/dispatch-coverage.test.ts` (P2-2 — exhaustive `ServerRequest["method"]` registration check)

- [ ] **Step 9a.1: Write failing test — single handler registration, dispatch by method, default-reject for unregistered.**

```ts
import { describe, expect, it } from "vitest";
import { FakeAppServer } from "@codex-im/testkit";
import { ApprovalBroker } from "../src/approval-broker.js";

describe("ApprovalBroker skeleton", () => {
  it("default-rejects an unknown method via -32601", async () => {
    const fake = new FakeAppServer();
    const broker = new ApprovalBroker(fake.client);
    broker.attach();
    const resp = await fake.emitServerRequest("future/unseen/method", {}, 42);
    expect(resp.error).toMatchObject({ code: -32601 });
  });

  it("duplicate attach() throws", () => {
    const fake = new FakeAppServer();
    const broker = new ApprovalBroker(fake.client);
    broker.attach();
    expect(() => broker.attach()).toThrow(/already attached/);
  });
});
```

- [ ] **Step 9a.2: Implement broker skeleton with internal dispatch table**

```ts
// packages/core/src/approval-broker.ts
import type { AppServerClient, JsonRpcRequest } from "@codex-im/app-server-client";
import type { ServerRequest } from "@codex-im/protocol";
import type { ApprovalDecision, ApprovalRecord, ApprovalActor } from "./types.js";

type ServerRequestMethod = ServerRequest["method"];
type Dispatcher = (req: JsonRpcRequest) => Promise<unknown>;

export class ApprovalBroker {
  #dispatchers = new Map<ServerRequestMethod, Dispatcher>();
  #pending = new Map<string | number, ApprovalRecord>();
  #attached = false;
  constructor(private client: AppServerClient) {}

  attach(): void {
    if (this.#attached) throw new Error("ApprovalBroker already attached");
    this.client.setServerRequestHandler((req) => this.#handle(req));
    this.#attached = true;
  }

  registerDispatcher<M extends ServerRequestMethod>(method: M, fn: Dispatcher): void {
    this.#dispatchers.set(method, fn);
  }

  async #handle(req: JsonRpcRequest): Promise<unknown> {
    const dispatcher = this.#dispatchers.get(req.method as ServerRequestMethod);
    if (!dispatcher) {
      // default-reject — matches Phase 0 client.ts policy
      throw Object.assign(new Error("no handler registered"), { code: -32601 });
    }
    return await dispatcher(req);
  }

  // T9b: timeout + transport-loss + actor-binding
  resolve(_approvalId: string, _decision: ApprovalDecision, _actor: ApprovalActor): void { throw new Error("T9b"); }
  expirePending(): void { throw new Error("T9b"); }
}
```

- [ ] **Step 9a.3: Add per-method dispatcher tests using fixture from T4 + T4.5** — one test per method present in `phase1-richer-turn-server-request.jsonl`. Each test:
  1. Constructs `FakeAppServer`.
  2. Replays the captured request via `fake.emitServerRequest(method, params, id)`.
  3. Asserts broker's dispatcher is invoked with correctly-typed params.
  4. Asserts `client.respond` writes `{ decision: ... }` mapped from `ApprovalDecision`.
- [ ] **Step 9a.4: Add `dispatch-coverage.test.ts` (P2-2)** — exhaustive type-level check that `ServerRequest["method"]` union is registrable; test fails if a generated arm has no dispatcher slot.
- [ ] **Step 9a.5: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 9a.6: Commit.**

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

- [ ] **Step 9b.1: Add timeout test — registered dispatcher that takes 31s → broker must default-reject (-32603 "handler error") + audit.**
- [ ] **Step 9b.2: Add throw test — registered dispatcher throws → broker default-rejects with -32603 (NOT -32601) + audit, does not crash.** This distinguishes "no handler" (-32601) from "handler errored" (-32603).
- [ ] **Step 9b.3: Add transport-loss test (D6)** — pending approval at transport close → status `transport_lost`, decision auto-set to `{ kind: "denied", reason: "transport_lost" }`, `actor` set to `{ kind: "system", reason: "transport_lost" }`.
- [ ] **Step 9b.4: Implement `resolve(approvalId, decision, actor)` + `expirePending()`** — actor field always required (P1-1 enforcement); Phase 1 callers pass `{ kind: "system", reason: "..." }` since no IM exists yet.
- [ ] **Step 9b.5: Type-level test (P2-4)** — assert no string literal of an approval method name exists outside `packages/core/`. Implementation: build-time grep over `packages/{app-server-client,codex-runtime,daemon,cli}/src/**` for `/['"](approval|item\/|turn\/|thread\/)/` — fail test if any match. Exempts test files.
- [ ] **Step 9b.6: Codex outside-voice review on broker diff.** Specifically ask:
  1. "is the single-slot invariant violated anywhere?"
  2. "does method-name handling read from the generated `ServerRequest` union?"
  3. "is `ApprovalActor` always set on resolve, including system-initiated transport-loss path?"
  Capture in `docs/phase-1/approval-broker-review.md`.
- [ ] **Step 9b.7: gstack `/plan-eng-review`** on the broker module.
- [ ] **Step 9b.8: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 9b.9: Commit.**

```bash
git commit -m "feat(core): ApprovalBroker edges + reviews (P1.2 part 2)

Timeout default-rejects with -32603 (handler error). Throws
default-reject with -32603 (distinguishes from -32601 'no handler').
Transport-loss (D6) auto-resolves pending approvals as denied with
ApprovalActor={ kind: 'system', reason: 'transport_lost' }. Build-time
grep guard (P2-4) ensures approval method names exist nowhere
outside packages/core/. Outside-voice + plan-eng-review captured."
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

(Split per plan-eng-review P1-3.) Skeleton ships fresh-client + re-attach + ONE-SHOT identity guarantee. Backoff + halt-on-cascade + transport-loss propagation lands in T11b.

**Files:**
- Create: `packages/daemon/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`
- Create: `packages/daemon/src/supervisor.ts`
- Create: `packages/daemon/test/supervisor.test.ts`

- [ ] **Step 11a.1: Skeleton (mirror T3 — package.json/tsconfig/index/types/README/vitest.config) — commit separately.**
- [ ] **Step 11a.2: Write failing test — `Supervisor.start()` constructs client; on transport close, constructs **new** client (object identity differs).**
- [ ] **Step 11a.3: Implement supervisor following the 7-step protocol from `client.ts` JSDoc** (already documented). Inject `clientFactory` for testability — Phase 1 tests use injected factory; real `StdioTransport` wiring stays minimal.

```ts
export class Supervisor {
  #current: AppServerClient | null = null;
  constructor(private opts: {
    clientFactory: () => AppServerClient;
    broker: ApprovalBroker;
    runtimeFactory: (c: AppServerClient) => CodexRuntime;
  }) {}

  async start(): Promise<void> {
    await this.#spawnFresh();
  }

  async #spawnFresh(): Promise<void> {
    const client = this.opts.clientFactory();          // fresh instance per ONE-SHOT
    this.#current = client;
    this.opts.broker.attachTo(client);                 // re-attach single handler (T9b adds attachTo)
    await client.start();
    await performInitializeHandshake(client, /* clientInfo */);
    const runtime = this.opts.runtimeFactory(client);
    client.onClose(() => this.#onClose());
  }

  // T11b: implement #onClose (backoff + halt + transport-loss propagation)
  #onClose() { throw new Error("T11b"); }
}
```

- [ ] **Step 11a.4: Tests (skeleton scope only):**
  1. Fresh client per spawn (assert object identity differs after manual `client.handleClose()`).
  2. `broker.attachTo` called once per spawn (assert mock spy count).
  3. **No zombie listeners** — old client's `onClose` handler does not fire after new client is attached (suggested test from review §"Suggested additional tests").

- [ ] **Step 11a.5: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 11a.6: Commit.**

```bash
git commit -m "feat(daemon): Supervisor skeleton with ONE-SHOT lifecycle (P1.4 part 1)

Fresh client per spawn (object-identity-asserted). broker.attachTo
called once per spawn. Old-client listener does not zombify when new
client is attached. T11b adds backoff + halt + transport-loss
propagation."
```

**Exit criteria:** ONE-SHOT invariant proven by object-identity assertions; no zombie listener test passes; ci-check green.

---

### Task 11b: Supervisor edges + reviews (P1.4 part 2) **[lead session]**

**Files:**
- Modify: `packages/daemon/src/supervisor.ts`
- Modify: `packages/daemon/test/supervisor.test.ts`

- [ ] **Step 11b.1: Implement `#onClose` with bounded exponential backoff + halt-on-cascade.**

```ts
#onClose() {
  // D6: pending turns/approvals fail, no auto-resume
  this.opts.broker.failPendingAsTransportLost();   // T9b API
  this.#consecutiveFailures++;
  if (this.#consecutiveFailures >= 5) {
    this.opts.audit.emitFatal("supervisor halted: 5 consecutive transport closes");
    return;
  }
  setTimeout(() => this.#spawnFresh(), this.#backoff());
}
```

- [ ] **Step 11b.2: Tests:**
  1. Pending approvals from old client are marked `transport_lost` (D6) — wired through `broker.failPendingAsTransportLost()`.
  2. Pending turns from old runtime emit synthetic `turn_failed (transport_lost)` event.
  3. Exponential backoff bounded (500ms → 1s → 2s → 4s → 8s).
  4. 5 consecutive failures → halt + emit fatal audit; no further `#spawnFresh` calls.
- [ ] **Step 11b.3: Codex outside-voice review.** Specifically ask:
  1. "do we ever reuse a closed AppServerClient?"
  2. "does any branch leak the prior runtime reference?"
  3. "is `failPendingAsTransportLost` called exactly once per close, even under concurrent close events?"
  Capture in `docs/phase-1/supervisor-review.md`.
- [ ] **Step 11b.4: `bash scripts/ci-check.sh` — exit 0.**
- [ ] **Step 11b.5: Commit.**

```bash
git commit -m "feat(daemon): Supervisor edges + reviews (P1.4 part 2)

Bounded exponential backoff (500ms..8s) with 5-failure halt and
fatal audit. Pending approvals (D6) auto-fail as transport_lost
via broker.failPendingAsTransportLost(). Pending turns emit
synthetic turn_failed event. Outside-voice review captured."
```

**Exit criteria:** all supervisor tests pass including transport-loss propagation + halt cascade; outside-voice review captured.

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

- [x] Spec coverage: P1.1–P1.6 + CLI `runtime send` + 05-PROTOCOL §3/§4.1 doc maintenance — each maps to T7a/T7b (P1.3), T8 (P1.1), T9a/T9b (P1.2), T11a/T11b (P1.4), T1 (P1.5), T2+T4+T4.5 (P1.6), T10 (CLI), T12 (docs).
- [x] No placeholders: every step has either a code block, a command, or an unambiguous file path.
- [x] Type consistency: `ApprovalDecision` + `ApprovalActor` shape used identically in T5 (definition) and T9a/T9b (consumer); `CodexRichEvent` discriminated union introduced in T3 and consumed in T7a/T7b; `EventClass` classification table type-checked exhaustive in T7a.
- [x] No backwards-compat shims (Phase 0 contracts only extended, never refactored).
- [x] Every task has explicit verification commands (`bash scripts/ci-check.sh` after T3) and exit criteria.
- [x] Sequential vs parallel windows declared (4 phases: 1A parallel, 1B + 1B′ sequential, 1C parallel lanes with internal a→b sequencing, 1D sequential).
- [x] Subagent / outside-voice / `/plan-eng-review` assignments declared per task.
- [x] Plan-eng-review P0/P1 fixes applied inline (D5 revised, fixture path preserved, Node 20.10 preserved, ApprovalRecord.actor added, T4.5 gate inserted, T7/T9/T11 split, ci-check.sh + redact-fixture.mjs added).

---

## 12. Open questions — RESOLVED

Decisions reached after plan-eng-review (2026-04-30):

1. **Fixture-capture target dir** — **resolved**. Capture runs in `/tmp/codex-fixture-spike` (outside repo, to avoid sandbox writes during real codex spawn). Captured + redacted output lands in `packages/testkit/fixtures/codex-0.125.0/phase1-*.jsonl` (version-pinned dir preserved per P0-2; phase tracing via filename prefix).
2. **Node target for new packages** — **resolved**. Keep `engines.node >=20.10` to match Phase 0 contract. Any future bump to Node 24 happens in a standalone pre-Phase-3 PR with full Phase 0 gate re-run, not silently inside Phase 1 (P0-1).
3. **CI integration timing** — **resolved**. Phase 1 ships `scripts/ci-check.sh` (local subagent gate, P1-4) but defers GitHub Actions workflow to Phase 2 hygiene as TODOS already lists. The local gate is mandatory before any subagent claims a task done.

---

**Status:** P0 + P1 review fixes applied inline (2026-04-30). Plan now ready for:

1. gstack `/plan-eng-review` — already run; report in §9 / GSTACK REVIEW REPORT below
2. Codex outside-voice — capture report in §10
3. Begin execution per `superpowers:subagent-driven-development` (recommended) — fresh subagent per task with two-stage review

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run; Phase 1 is foundations, not a product/strategy change |
| Codex Review | `codex review` (outside voice) | Independent 2nd opinion | 0 | pending | scheduled after this plan revision |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | **APPROVE WITH CHANGES → CHANGES APPLIED** | 3 P0 (D5 revise, fixture path, Node target), 5 P1 (ApprovalRecord.actor, T4.5 gate, T7/T9/T11 split, ci-check.sh, redact script), 5 P2 — all P0+P1 applied inline |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI in Phase 1 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | n/a | no developer-facing surface in Phase 1 |

- **UNRESOLVED:** 0 (all P0+P1 applied; P2 deferred but tracked in review §"P2 improvements")
- **VERDICT:** ENG REVIEW CLEARED — ready to run Codex outside-voice on the revised plan, then begin execution.

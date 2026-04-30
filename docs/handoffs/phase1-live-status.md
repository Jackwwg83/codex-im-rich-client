# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-04-30 23:51 (overnight wake 1) — T9a Steps 9a.1 → 9a.3 done. Test count 251/251. HEAD `e8d5c1a`. Next wake handles 9a.4+9a.5+codex review.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9a in progress** — Steps 9a.1 (failing tests `fad862d`) + 9a.2 (broker impl `f274aae`) + 9a.3 (per-method dispatch + default-reject coverage `e8d5c1a`) all done. Next: 9a.4 (v2 response-shape — implicitly covered by 9a.3's typing; tiny explicit type-only block can be added to 9a.5's file) + 9a.5 (dispatch-coverage.test.ts).
- **Autonomous mode:** ON. ScheduleWakeup loop fires roughly every 20 min; loop prompt holds the per-wake protocol + hard-stop conditions. Scheduled tasks remaining: T9a → T9b → T10 → STOP before T11a.
- **Last completed task:** **Pre-3** (`AppServerClient` `JsonRpcResponseError` propagation) — both commits landed (`c96d36d` docs, `44e2623` code).
- **Prior tasks:** T8 (CodexRuntime typed wrappers) + T8 codex review fixes.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `e8d5c1a test(core): per-method dispatch + default-reject coverage (T9a Step 9a.3)`
- **Parent:** `f274aae feat(core): ApprovalBroker skeleton + exhaustive dispatch table (T9a Step 9a.2)`
- **Grandparent:** `fad862d test(core): T9a Step 9a.1 — failing skeleton tests for ApprovalBroker (TDD red)`
- **Main:** `main`

## 3. Completed tasks (Phase 1)

- Pre-1 (Node 24 bump) — landed
- Pre-2 (protocol facade expansion) — landed
- T1 (categorizeJsonRpcError) — landed + reviewed
- T2 (CLI capture flags) — landed
- T3 (codex-runtime skeleton + scripts) — landed
- T4 (real fixture capture) — landed + reviewed
- T4.5 (fixture acceptance gate) — landed + reviewed
- T5 (packages/core skeleton) — landed + reviewed (5/5 fixes applied)
- T6 (METHOD_CLASS + isServerNotificationMethod) — landed + reviewed (3/3 fixes applied)
- T7a (EventNormalizer skeleton) — landed + reviewed (6/6 fixes applied)
- T7b (T7b-1 + T7b-2 = exhaustive switch + walk-and-drop overflow) — landed + reviewed (2/2 fixes applied)
- T8 (CodexRuntime typed wrappers) — landed + reviewed (5/5 low+nit fixes applied)
- **Pre-3 (`AppServerClient` `JsonRpcResponseError` propagation) — landed (docs `c96d36d` + code `44e2623`).** No outside-voice review run on Pre-3; the change is purely additive (single new branch in catch arm; existing `-32603` path bit-identical). 231/231 tests pass.

## 4. Currently doing

**Autonomous overnight execution active.** First wake fires at 23:43; loop will continue waking every ~20 min. Each wake reads this doc + plan, runs gates, commits, updates status, schedules next wake. Hard-stops fire on: drift / red-line / blocker review finding / T11a boundary / all tasks complete.

User went to bed — interrupt anytime. To halt: send any message during a wake's response window or wait for the loop to hit a hard-stop and read the STOPPED status in §4 next morning.

## 5. Next exact action

**T9a Step 9a.5 (next wake)** — create `packages/core/test/dispatch-coverage.test.ts`:
1. Type-only assertion block satisfying Step 9a.4 (Codex required-test) — explicit `const _v2_<x>: <Generated>Response = { ... }` lines using v2 response types from the protocol facade. This proves at compile-time the broker's default-reject shapes are valid for the generated types and the broker is NOT assuming the legacy `{decision: ReviewDecision}` shape applies to v2 methods.
2. Runtime coverage test: instantiate `ApprovalBroker(client)`, call `broker.dispatchMethods()`, assert it equals (as a sorted set) the 9 string literals corresponding to `ServerRequest["method"]`. The plan §1752 phrases this as "covers every method seen in the captured fixture AND every method in the generated union" — but ground-truth is the generated union (the fixture has 1 method).

After 9a.5: ci-check 8/8 gates green; test count rises to ~252-253.

Then **Step 9a.6** — full ci-check (already green per gates above; just rerun for the record).
Then **Step 9a.7** — task functionally complete; the broker scope is closed for T9a.
Then **Step 9a.8 (added by autonomous protocol)** — codex outside-voice review on T9a diff range `c96d36d..HEAD` (covers all of T9a but NOT Pre-3 or earlier work). Capture findings to `docs/phase-1/codex-review-t9a.md`. Apply low/nit fixes inline. blocker/medium → STOP.
Then **Step 9a.9** — update live-status §1/§2/§3/§5/§7 to reflect T9a complete; commit `docs(phase1): sync live-status — T9a complete`.
Then **Step 9a.10** — ScheduleWakeup → next wake starts T9b at plan §1685.

T9a-authorized Files (CLAUDE.md "每个任务只改计划内文件"):
- `packages/core/src/approval-broker.ts` (committed at `f274aae`)
- `packages/core/test/approval-broker.test.ts` (committed at `fad862d`)
- `packages/core/test/approval-broker-dispatch.test.ts` (committed at `e8d5c1a`)
- `packages/core/test/dispatch-coverage.test.ts` (next wake)
- Plus housekeeping: `packages/core/src/index.ts` (re-export — committed at `f274aae`; mirrors T6/T8 pattern)

T9a may NOT touch `packages/app-server-client/` — Pre-3 owns that file.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `e8d5c1a`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **251 passed (251)**, 26 files (was 231 pre-T9a; +2 broker skeleton + +18 dispatch coverage)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (80 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `e8d5c1a`

## 8. Current key decisions (Phase 1, decided — do not relitigate)

- **D5 final:** EventNormalizer single FIFO + class-aware walk-and-drop overflow (delta-soft + total-hard caps, sanitized).
- **D6:** transport-loss path auto-fails pending approvals as `denied / actor=system / reason=transport_lost`. Idempotent (Codex B7).
- **D7:** ApprovalBroker is the **single owner** of `client.setServerRequestHandler`. Dispatch is via exhaustive `Record<ServerRequest["method"], DispatcherSpec>` (Codex B5/B6 — `Map`/`Set` are not exhaustive).
- **D8:** ts-rs `ServerNotification.method` is `string` at the wire-decoded level; narrow via `isServerNotificationMethod` derived from `Object.hasOwn(METHOD_CLASS, m)`.
- **D9:** Two close paths for the normalizer — `#cancelConsumer` (caller iterator.return → drop queue) vs `endOfStream` (source ended → drain queue, then close).
- **D10 (resolved by Pre-3, 2026-04-30):** server-request handlers may throw `JsonRpcResponseError` to signal an explicit JSON-RPC error envelope; `AppServerClient.dispatchServerRequest` preserves `code` / `rawMessage` / `data` verbatim. Generic `Error` throws still collapse to `-32603 "handler error: ..."`. The `-32601` vs `-32603` plan inconsistency between T9a §9a.1 and T9b §9b.3 is now settled: `-32601` is reserved for "method not in dispatch table" via the Pre-3 path; `-32603` is reserved for "registered handler crashed at runtime". Both T9a and T9b plan sections have been amended to make this explicit.

## 9. Current redlines (must hold every iteration)

Persistent (CLAUDE.md):
- No Codex CLI/TUI wrapper — JSONL on stdio only.
- No public WebSocket / public HTTP listener.
- Approvals never auto-approve; default-deny.
- Computer Use needs explicit `/cu` invocation (Phase 6 anyway).
- Logs redact secrets.
- No hardcoded approval / server-request method names outside `packages/core/`. T9b adds the build-time grep guard over `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`.
- Phase 0 modules (`AppServerClient`, `StdioTransport`, `JsonlDecoder`) are **contract** — extend, never rewrite.

Phase 1 specific:
- `AppServerClient` is **ONE-SHOT**. Supervisor (T11) constructs a fresh quartet per recovery; nothing is reused across the boundary.
- Method-name string literals exist **only** in `packages/codex-runtime/src/runtime.ts` (CodexRuntime wrappers) and `packages/core/src/approval-broker.ts` (when T9a lands). Nowhere else in `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`.
- Unknown ServerNotification arms must produce a `CodexRichEvent` of type `unknown` — never silently dropped.
- Each task only touches files in its plan-listed Files block (CLAUDE.md "每个任务只改计划内文件").

## 10. Not allowed to advance until resolved

T9a may not start until the user explicitly approves Step 9a.1. Once T9a starts, the binding rules are:

- T9a only touches files in its plan-listed Files (see §5 above).
- T9a may NOT touch `packages/app-server-client/` — Pre-3 owns that surface area.
- No new approval method-name string literals outside `packages/core/`. Test code uses synthetic method names (`future/unseen/method`); production code reads from generated `ServerRequest["method"]` union.
- The single-handler invariant on `client.setServerRequestHandler` is the broker's exclusive territory (D7).
- `ApprovalBroker` constructor must NOT subscribe to `client.onClose` or attempt restart (ONE-SHOT lifecycle; Supervisor T11 owns recovery).

Other Phase 1 non-goals from handoff (unchanged across all tasks):
- Any IM adapter (Phase 2+).
- Computer Use production path (Phase 6).
- SQLite storage (Phase 2).
- ChannelAdapter / SessionRouter / CommandRouter (Phase 2).
- Public WebSocket / public HTTP listener (Phase 8).
- Rewriting any Phase 0 module.
- Making `AppServerClient` restartable.
- Default-approving any approval; bypassing approvals; failing-open on errors.

## 11. First command for a new (post-compact) session

```bash
cat docs/handoffs/phase1-live-status.md && \
git status --short && \
git log --oneline -5
```

Then read `CLAUDE.md` "Compact / Resume Instructions" and follow the Context Recovery Mode flow before touching code.

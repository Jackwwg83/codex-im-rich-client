# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-04-30 (overnight) — T9a Step 9a.1 staged (failing tests committed as `fad862d`); autonomous loop scheduled to wake at 23:43 to do Step 9a.2. **Test count is 231 fails / 233 total at HEAD `fad862d` — this is intentional TDD-red; Step 9a.2 turns it green.**

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9a in progress** — Step 9a.1 done (failing tests committed `fad862d`); next step 9a.2 (broker skeleton implementation) is what the autonomous overnight loop wakes up to do.
- **Autonomous mode:** ON. ScheduleWakeup loop fires roughly every 20 min; loop prompt holds the per-wake protocol + hard-stop conditions. Scheduled tasks remaining: T9a → T9b → T10 → STOP before T11a.
- **Last completed task:** **Pre-3** (`AppServerClient` `JsonRpcResponseError` propagation) — both commits landed (`c96d36d` docs, `44e2623` code).
- **Prior tasks:** T8 (CodexRuntime typed wrappers) + T8 codex review fixes.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `fad862d test(core): T9a Step 9a.1 — failing skeleton tests for ApprovalBroker (TDD red)`
- **Parent:** `ea02ab3 docs(phase1): sync live-status — Pre-3 complete, T9a ready`
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

**T9a Step 9a.2** — implement `packages/core/src/approval-broker.ts` with:
- `DispatcherSpec<P, R>` type (handler + defaultReject)
- Exhaustive `DispatchTable` typed over the 9 generated `ServerRequest["method"]` arms
- Type-level `_ExhaustiveDispatch` guard (compiles iff `keyof DispatchTable === ServerRequest["method"]`)
- Constructor populates `#table` with all 9 entries; each `handler: null` initially; each `defaultReject` returns the wire-shape mandated by the per-method generated `*Response.ts`
- `attach()` enforces single-handler invariant (throws `/already attached/` on second call); calls `client.setServerRequestHandler(req => this.#handle(req))`
- `#handle(req)` looks up method; if NOT in table → `throw new JsonRpcResponseError({ code: -32601, message: \`unsupported method ${req.method}\` })`; if `handler === null` → `return spec.defaultReject()`; else `return await spec.handler(req as never)`
- `registerHandler<M>(method, handler)` — typed setter for per-method handler installation (used by 9a.3 dispatch tests and downstream callers)
- T9b stubs (`resolve` / `failPendingAsTransportLost` / `expirePending`) — throw "T9b" placeholder

After 9a.2: existing 2 tests turn green; ci-check (8 gates) green at 233/233.

Then proceed:
- **Step 9a.3** — per-method dispatcher tests in `packages/core/test/approval-broker-dispatch.test.ts` (one happy-path + one default-reject per method, 9+9 cases)
- **Step 9a.4** — v2 response-shape assertions (per-method response matches generated type)
- **Step 9a.5** — `packages/core/test/dispatch-coverage.test.ts` (runtime check that all 9 generated arms are covered)
- **Step 9a.6** — full ci-check
- **Step 9a.7** — single feat commit
- **Step 9a.8** (added by autonomous protocol) — codex outside-voice review on T9a diff range; fix low/nit findings; capture `docs/phase-1/codex-review-t9a.md`
- **Step 9a.9** — update this live-status, commit as separate `docs(phase1): sync live-status — T9a complete`
- **Step 9a.10** — schedule next wake → start T9b

T9a-authorized Files (CLAUDE.md "每个任务只改计划内文件"):
- `packages/core/src/approval-broker.ts`
- `packages/core/test/approval-broker.test.ts` (already committed at `fad862d`)
- `packages/core/test/approval-broker-dispatch.test.ts`
- `packages/core/test/dispatch-coverage.test.ts`

T9a may NOT touch `packages/app-server-client/` — Pre-3 owns that file.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `fad862d`)

- `pnpm test` → **231 pass / 2 fail / 233 total** (TDD red — failures in `packages/core/test/approval-broker.test.ts` are the failing skeleton tests committed by 9a.1; expected to turn green after 9a.2 lands the implementation)
- Other gates not re-run at HEAD `fad862d` because the source-only failure is by design; they were green at HEAD `ea02ab3` (one commit back, before the failing test was committed).
- After Step 9a.2 lands, expected green state: `pnpm test` → **233 passed (233)**; full 8-gate ci-check green.

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

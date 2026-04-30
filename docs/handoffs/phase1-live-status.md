# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 00:51 (overnight wake 3) — T9b Steps 9b.1 (reattach) + 9b.2 (timeout) + 9b.3 (throw distinction) done. Test count 262/262. HEAD `4798c02`. Next wake handles 9b.4+9b.5 (transport-loss D6 + resolve/expire/fail-pending implementations).

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9b in progress** — Steps 9b.1 (reattach `1ecb394`) + 9b.2 (timeout) + 9b.3 (throw distinction) done at `4798c02`. Next wake: 9b.4 (transport-loss D6) + 9b.5 (resolve/failPendingAsTransportLost/expirePending implementations).
- **Autonomous mode:** ON. ScheduleWakeup loop fires roughly every 20 min. Scheduled tasks remaining: T9b → T10 → STOP before T11a.
- **Last completed task:** **T9a** (`ApprovalBroker` skeleton + happy-path dispatch + dispatch coverage) — 5 implementation commits + codex outside-voice review with 4/4 findings resolved. Plan §1592.
- **Prior tasks:** Pre-3, T8, T7b, T7a, T6, T5, T4.5, T4, T3, T2, T1, Pre-2, Pre-1.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `4798c02 test(core): timeout + throw distinction (T9b Steps 9b.2 + 9b.3)`
- **Recent T9b chain:** `4798c02` (9b.2+9b.3) ← `1ecb394` (9b.1 reattach) ← T9a complete chain.
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
- **T9a (`ApprovalBroker` skeleton + happy-path dispatch + dispatch coverage) — landed.** 5 code commits (`fad862d` 9a.1 failing test, `f274aae` 9a.2 broker impl, `e8d5c1a` 9a.3 per-method dispatch + default-reject, `7a05598` 9a.4+9a.5 dispatch coverage + type-only response shapes, `7fe48c6` codex review fixes) + review doc `06d9e3c`. Codex outside-voice review: 4 findings (2 medium + 2 low), all resolved inline. 254/254 tests pass.

## 4. Currently doing

**Autonomous overnight execution active.** First wake fires at 23:43; loop will continue waking every ~20 min. Each wake reads this doc + plan, runs gates, commits, updates status, schedules next wake. Hard-stops fire on: drift / red-line / blocker review finding / T11a boundary / all tasks complete.

User went to bed — interrupt anytime. To halt: send any message during a wake's response window or wait for the loop to hit a hard-stop and read the STOPPED status in §4 next morning.

## 5. Next exact action

**T9b Step 9b.4** — transport-loss test (D6) in `packages/core/test/approval-broker.test.ts`:
- Construct broker on a client, attach, register a handler that **never** resolves (simulates an in-flight pending approval at the moment of transport close).
- Emit a server request through the fake; the handler starts but doesn't return.
- Stop the client (or close the transport) — this triggers `client.handleClose` → `rejectAllPending`. The broker's `#pending` Map should also be drained: each record gets `status: "transport_lost"`, `actor: { kind: "system", reason: "transport_lost" }`, `decision: { kind: "denied", reason: "transport_lost" }`.
- Assert that the pending approval record in the broker reflects the transport-lost terminal state.
- Assert that `failPendingAsTransportLost()` is **idempotent** — calling it twice doesn't double-process.

The test will require Step 9b.5 to actually implement the lifecycle, so 9b.4 + 9b.5 land together as a TDD red-green pair (or one combined test+impl commit).

**T9b Step 9b.5** — implementations on `ApprovalBroker`:
- `resolve(approvalId, decision, actor)`:
  - Look up the pending record by approvalId.
  - If not found: throw or no-op (decide: probably throw — caller error to resolve a nonexistent approval).
  - If already terminal: throw (caller error to double-resolve).
  - Otherwise: set `status: "resolved"`, `decidedAt: new Date()`, `decision`, `actor`. Emit the JSON-RPC response back to codex via `client.respond(appServerRequestId, ...mappedResponse)` where `mappedResponse` is per-method-shape mapping (see plan §1750 — v2 responses are NOT all `{decision: ReviewDecision}`).
- `failPendingAsTransportLost()`:
  - Idempotent: subsequent calls are a no-op.
  - For each pending record: set status/actor/decision per D6.
  - DO NOT call `client.respond` (the client is dead; transport is closed).
  - Clear `#pending` afterward to prevent re-processing.
- `expirePending(maxAgeMs?)`:
  - For each pending record older than `maxAgeMs` (default = some value, e.g. 10 minutes): set status `expired`, actor `{kind:"system", reason:"expired"}`, decision `{kind:"denied", reason:"expired"}`.
  - Emit a denied response to codex (which is still alive in this case — only `failPendingAsTransportLost` skips the wire response).

The pending Map needs to be populated by `#handle` BEFORE invoking the registered handler (so the broker can track in-flight approvals for transport-loss / expire). This means `#handle` becomes async-with-side-effect: insert pending → invoke handler → on resolve, remove from pending. That's a substantive change to T9a's pure-dispatch behavior; the test (9b.4) will drive what the implementation needs to do.

T9b-authorized Files (per plan §1773-1775):
- `packages/core/src/approval-broker.ts` (modify — add resolve/expire/failPending + pending tracking in #handle)
- `packages/core/test/approval-broker.test.ts` (modify)
- Create: `packages/core/test/approval-broker-fixture.test.ts` — additional fixture-driven tests
- Plus the build-time grep guard test file (T9b Step 9b.6 — location TBD inside packages/core/test/ or scripts/)

T9b may NOT touch `packages/app-server-client/` (Pre-3 owns) or `packages/codex-runtime/` (T8 owns) — only `packages/core/` and possibly `scripts/` for the grep guard.

After 9b.5 lands, remaining T9b steps: 9b.6 (grep guard) → codex review → fix → live-status sync → ScheduleWakeup → T10.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `4798c02`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **262 passed (262)**, 27 files (was 254 pre-T9b; +4 reattach + +4 timeout/throw)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (81 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `4798c02`

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

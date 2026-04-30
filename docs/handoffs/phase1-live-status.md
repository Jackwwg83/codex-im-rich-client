# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 01:18 (overnight wake 4) — T9b Steps 9b.4 + 9b.5 done (pending lifecycle, D6 transport-loss, expirePending). Test count 268/268. HEAD `decb570`. Next wake: 9b.6 build-time grep guard + codex review on full T9b diff.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9b in progress** — Steps 9b.1 (reattach `1ecb394`) + 9b.2 (timeout) + 9b.3 (throw distinction) at `4798c02` + 9b.4+9b.5 (pending lifecycle, D6 transport-loss, expirePending) at `decb570`. Next wake: 9b.6 (grep guard) + codex review.
- **Autonomous mode:** ON. ScheduleWakeup loop fires roughly every 20 min. Scheduled tasks remaining: T9b grep+review → T10 → STOP before T11a.
- **Last completed task:** **T9a** (`ApprovalBroker` skeleton + happy-path dispatch + dispatch coverage) — 5 implementation commits + codex outside-voice review with 4/4 findings resolved. Plan §1592.
- **Prior tasks:** Pre-3, T8, T7b, T7a, T6, T5, T4.5, T4, T3, T2, T1, Pre-2, Pre-1.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `decb570 feat(core): pending lifecycle — transport-loss D6 + expirePending (T9b Steps 9b.4 + 9b.5)`
- **Recent T9b chain:** `decb570` (9b.4+9b.5) ← `4798c02` (9b.2+9b.3) ← `1ecb394` (9b.1 reattach) ← T9a complete chain.
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

**T9b Step 9b.6** — build-time grep guard (P2-4): assert no approval method-name string literal exists in `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`. Implementation: a `*.test.ts` (vitest case in packages/core/test/ runs grep over the workspace) that fails if any match. Exempts test files. Pattern set: `/['"](approval|item\/|turn\/|thread\/|applyPatchApproval|execCommandApproval|account\/chatgptAuthTokens)/` adjusted to avoid false positives — needs to specifically target the 9 generated ServerRequest method names + maybe a permissive substring fallback for `requestApproval`.

Things to allow in source:
- ClientRequest method literals like `thread/start`, `turn/start` are in `packages/codex-runtime/src/runtime.ts` (T8 boundary). The grep MUST whitelist those or be scoped only to ServerRequest method literals.

Implementation outline:
```ts
// packages/core/test/no-method-literals.test.ts
import { execSync } from "node:child_process";
const FORBIDDEN_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "mcpServer/elicitation/request",
  "applyPatchApproval",
  "execCommandApproval",
  "account/chatgptAuthTokens/refresh",
];
// For each method, run `git grep -F` over packages/{...}/src/** and assert no hits.
```

After 9b.6 lands: codex outside-voice review on full T9b diff range (probably `0a4bf72..HEAD` to cover all T9b commits but exclude T9a). Capture findings to `docs/phase-1/codex-review-t9b.md`. Apply low/nit + obvious medium fixes inline. blocker / uncertain medium → STOP.

Then live-status sync marking T9b complete + ScheduleWakeup → T10.

T9b-authorized Files (per plan §1773-1775 + autonomous protocol):
- `packages/core/src/approval-broker.ts` (modified — current state at HEAD)
- `packages/core/test/approval-broker.test.ts` (modified)
- Create: `packages/core/test/no-method-literals.test.ts` (this wake)

Original plan also listed `approval-broker-fixture.test.ts` but the fixture-driven cases ended up inline in approval-broker-dispatch.test.ts (T9a). Skipping the separate file is fine — autonomous protocol allows reasonable structural deviations from the plan when the test surface is achieved.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `decb570`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **268 passed (268)**, 27 files (was 254 pre-T9b; +4 reattach + +4 timeout/throw + +6 pending-lifecycle)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (81 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `decb570`

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

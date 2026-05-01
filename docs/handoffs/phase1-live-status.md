# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 (post-decision) — User chose **B-clean** for T9b blocker 1 + fix blocker 2 in the same stage. Plan amended with `T9b blocker-fix` subsection. Next: failing tests first (Step 1), then implementation (Step 2), then codex review. Autonomous loop NOT resumed yet — staged execution with explicit STOPs between Steps. HEAD `0bae49b`. Test count 277/277.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9b blocker-fix in progress** — user-decided design: **B-clean** for blocker 1 (broker owns single completion promise per pending request, internal `PendingEntry` keeps `ApprovalRecord` data-only) + fix blocker 2 (`#transportLostFired = false` in `reattach`) in the same stage. Plan §"Task 9b blocker-fix" subsection added 2026-05-01 with full design.
- **Autonomous mode:** **STAGED, not free-running.** User specified an explicit Step 0 → Step 1 → Step 2 → codex review sequence with STOPs between. No ScheduleWakeup until the staged sequence completes.
- **Last completed task:** **T9a** + Pre-3 + T1-T8 (see §3).
- **Rejected alternatives** (do not relitigate): Option A (Pre-4 `AppServerClient` idempotent respond/reject) recorded as future backlog in `TODOS.md`, NOT implemented now. Option C (Phase 1 punt) declined.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `bf97a49 test(core): build-time grep guard for approval method-name literals (T9b Step 9b.6)`
- **Full T9b chain:** `bf97a49` (9b.6 grep guard) ← `e890c69` (live-status sync) ← `decb570` (9b.4+9b.5 pending lifecycle) ← `3e1a300` (live-status sync) ← `4798c02` (9b.2+9b.3 timeout/throw) ← `1ecb394` (9b.1 reattach) ← `0a4bf72` (T9a complete).
- **T9b code commits:** `1ecb394`, `4798c02`, `decb570`, `bf97a49` (4 logical chunks).
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

**Step 0 of T9b blocker-fix — docs only.** This commit adds:

- Plan §"Task 9b blocker-fix" subsection with full B-clean design + rejected alternatives + execution order.
- This live-status update (§1 / §4 / §5 / §10).
- TODOS.md entry recording AppServerClient idempotent respond/reject as future defensive guardrail (NOT this fix).

After this commit lands and gates are green: STOP for user review before Step 1.

Step 1: failing tests first (4 new tests). Step 2: B-clean implementation. Step 3: codex outside-voice review on the fix.

Total overnight session (closed): 5 wakes, 21 commits. T9a complete + Pre-3 + T9b code through Step 9b.6. The blocker fix opens a new staged sequence on top of HEAD `0bae49b`.

## 5. Next exact action

**Step 1 of T9b blocker-fix — write 4 failing tests** in `packages/core/test/approval-broker.test.ts`. Authorized files for the whole blocker-fix: `packages/core/{src,test}/...` only. Do NOT touch `packages/app-server-client/`.

The 4 tests:

1. **late-resolving handler after expirePending does not produce duplicate response**
   - broker attached, handler returns a manually-controlled Promise (not yet settled)
   - emit a server request → broker tracks pending
   - call `broker.expirePending(maxAgeMs)` while handler is still pending
   - assert the wire response is the per-method default-reject (one wire response total)
   - then resolve the original handler promise
   - assert NO second wire response is emitted; record stays terminal `expired`
2. **late-rejecting handler after expirePending also does not produce duplicate response**
   - same as #1 but the handler eventually rejects
   - the expire path is the only wire outcome
3. **failPendingAsTransportLost does not produce duplicate response on late handler resolution**
   - handler manually controlled, `failPendingAsTransportLost()` called, then handler settles
   - record terminal status `transport_lost`; no second wire response
4. **reattach resets transportLostFired (allows second-generation transport_lost)**
   - attach to clientA → emit hanging request → `failPendingAsTransportLost()` → assert clientA record is `transport_lost`
   - reattach to clientB → emit hanging request on clientB → `failPendingAsTransportLost()` → assert clientB record is ALSO `transport_lost` (current bug: second call no-ops because flag stays true)

Wire-frame counting: prefer using existing FakeAppServer / InMemoryTransport observability. If neither can count duplicate frames cleanly, do NOT fake the assertion silently — STOP and report. Modifying `packages/testkit/` is out of authorized scope unless explicitly approved.

Run targeted tests, expect fail-for-the-right-reason, report and STOP. Do NOT write implementation in Step 1.

**Step 2 of T9b blocker-fix — B-clean implementation** (only after user approves Step 1 report):

Per plan §"Task 9b blocker-fix" → "Design (B-clean)":
- Internal `PendingEntry` shape with `record` + `completion` + `settleOnce` + `settled` (private to `approval-broker.ts`; never leaks into `ApprovalRecord`)
- `#handle` kicks off handler in background, awaits `entry.completion`
- `expirePending` and `failPendingAsTransportLost` use `settleOnce` instead of direct `client.respond` / `client.reject`
- Late handler completion observes `record.status !== "pending"` and is dropped
- `reattach` resets `#transportLostFired = false` on success

Run targeted tests + full ci-check. Tests should turn green. Report and STOP. Do NOT commit until user approves.

**Step 3 — codex outside-voice review** on the fix diff (range parent-of-fix..HEAD-of-fix, filtered to `packages/core/`). Capture findings to `docs/phase-1/codex-review-t9b-blocker-fix.md`. Apply low/nit + obvious medium fixes inline; STOP on uncertain medium / blocker.

**Step 4** — live-status sync marking T9b complete; resume autonomous loop for T10 if user approves.

T9b blocker-fix authorized Files:
- `packages/core/src/approval-broker.ts` (modify)
- `packages/core/test/approval-broker.test.ts` (modify)
- May modify if needed: `packages/core/test/approval-broker-dispatch.test.ts`, `packages/core/test/dispatch-coverage.test.ts`

T9b blocker-fix forbidden:
- `packages/app-server-client/` (Pre-3 owns; Option A is future backlog only)
- `packages/codex-runtime/`, `packages/cli/`, `packages/testkit/`
- Any IM adapter / Computer Use prod / WebSocket listener / approval method-name hardcode

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `bf97a49`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **277 passed (277)**, 28 files (was 254 pre-T9b; +4 reattach + +4 timeout/throw + +6 pending-lifecycle + +9 grep guard)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (82 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `bf97a49`

Note: the green test count does NOT prove correctness on the 2 blockers. T9b's tests use never-resolving handlers which intentionally mask the duplicate-response race (codex review medium-4 explicitly calls this out — the late-resolving handler test is one of the missing tests).

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

**Staged blocker-fix sequence — STOPs are mandatory, NOT advisory.**

User specified gated execution on 2026-05-01:
- Step 0 (this commit) — docs only. STOP for user review.
- Step 1 — failing tests. STOP for user approval.
- Step 2 — B-clean implementation. STOP for user approval.
- Step 3 — codex outside-voice review on fix diff. Apply low/nit + obvious medium inline; STOP on uncertain medium/blocker.
- Step 4 — live-status sync; user decides whether to resume autonomous loop for T10.

While Step 0/1/2/3 are open:
- Do NOT modify `packages/app-server-client/` — Option A (Pre-4 idempotent respond) is future backlog only, NOT this fix.
- Do NOT modify `packages/codex-runtime/`, `packages/cli/`, `packages/testkit/`, or `packages/daemon/` (the latter doesn't exist yet anyway).
- Do NOT add `_resolveWire` / `_rejectWire` capability handles to `ApprovalRecord` — keep the public data shape clean. Use private internal `PendingEntry` instead.
- Do NOT call `client.respond` / `client.reject` directly from `expirePending` or `failPendingAsTransportLost` — both must go through `settleOnce` on the broker-owned completion promise.
- Do NOT skip the "late handler resolve/reject after terminal status" tests — those are the load-bearing coverage that catches the original race.

Other Phase 1 non-goals from handoff (unchanged across all tasks):
- Any IM adapter (Phase 2+).
- Computer Use production path (Phase 6).
- SQLite storage (Phase 2).
- ChannelAdapter / SessionRouter / CommandRouter (Phase 2).
- Public WebSocket / public HTTP listener (Phase 8).
- Rewriting any Phase 0 module beyond Pre-3's narrow extension.
- Making `AppServerClient` restartable.
- Default-approving any approval; bypassing approvals; failing-open on errors.

T11a / T11b still need explicit user approval after T9b blocker-fix lands. Plan §397 marks these "lead session lifecycle correctness critical".

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

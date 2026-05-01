# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 — **T9b complete.** Blocker-fix (B-clean) applied + codex review verdict: **APPROVE** (0 P0, 0 P1, 4 P2 — 3 resolved + 1 deferred-with-justification). HEAD `f9915f7`. Test count 283/283; all 8 ci-check gates green. Autonomous loop is paused awaiting your call on T10.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T10 — ready to start** (`codex-im runtime send` CLI per plan §1813). Has not started yet; awaiting user approval to resume the autonomous loop OR do it manually.
- **Autonomous mode:** **PAUSED.** The staged T9b blocker-fix sequence (Step 0 docs → Step 1 failing tests → Step 2 implementation → Step 3 codex review APPROVE → Step 4 live-status sync) completed at HEAD `f9915f7`. ScheduleWakeup loop is not active; resuming for T10 is a single-message decision.
- **Last completed task:** **T9b** (broker edges + B-clean lifecycle fix + reviews) — 4 T9b code commits (`1ecb394`, `4798c02`, `decb570`, `bf97a49`) + 2 codex reviews + 1 blocker-fix (`e814880` B-clean + `429fc2c` P2 follow-ups) + 2 review docs.
- **Prior tasks:** T9a + Pre-3 + T1-T8 (see §3).
- **Rejected alternatives** (do not relitigate): Option A (Pre-4 `AppServerClient` idempotent respond/reject) recorded as future backlog in `TODOS.md`, NOT implemented. Option C (Phase 1 punt) declined.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `f9915f7 docs(phase-1): codex outside-voice review report — T9b blocker-fix (APPROVE)`
- **T9b blocker-fix arc:** `f9915f7` (review doc) ← `429fc2c` (P2 follow-ups) ← `e814880` (B-clean fix) ← `8a14bbe` (Step 0 docs) ← `0bae49b` (STOPPED status from prior review).
- **T9b code commits (5 total):** `1ecb394`, `4798c02`, `decb570`, `bf97a49`, `e814880`, `429fc2c`.
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
- **T9b (`ApprovalBroker` edges + B-clean lifecycle fix + reviews) — landed.** Steps 9b.1-9b.6 (`1ecb394`, `4798c02`, `decb570`, `bf97a49`) + first codex review found 2 blockers + 2 medium + 1 low + 1 nit; user chose **B-clean** design. Blocker fix `e814880` (B-clean: broker owns single completion promise per pending request via internal `PendingEntry` + `settleOnce` race-free guard; `reattach()` resets `#transportLostFired`). Second codex review **APPROVE** (0 P0, 0 P1, 4 P2). P2 follow-ups `429fc2c` (comment polish + 2 missing tests). Review docs `06d9e3c` (T9b first review) + `f9915f7` (blocker-fix review). 283/283 tests pass.

## 4. Currently doing

**Nothing in flight.** T9b is fully landed with codex APPROVE. Awaiting your decision on T10.

T9b blocker-fix arc summary (this morning):
- Step 0 docs commit (`8a14bbe`) — plan + live-status + TODOS amendments.
- Step 1 failing tests (committed together with Step 2 — TDD red-green pair).
- Step 2 B-clean implementation (`e814880`) — `PendingEntry` + `settleOnce` + conditional delete + reattach reset.
- Step 3 codex outside-voice review **APPROVE** with 3 P2 + 1 risky-assumption infos.
- Step 3a P2 follow-ups (`429fc2c`) — comment polish + 2 missing tests.
- Step 3b review doc (`f9915f7`).
- Step 4 (this commit) — live-status sync.

Total Phase 1 work to date: 6 wakes worth of autonomous + 1 staged session. T1-T9b + Pre-1/2/3 all complete. Test count 231 → 283.

## 5. Next exact action

**T10 Step 10.1** (per plan §1813-1816, "`codex-im runtime send` CLI"):

Plan files:
- Create: `packages/cli/src/runtime-send.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/README.md`
- Create: `packages/cli/test/runtime-send.test.ts`

Plan steps:
- 10.1: failing test — `runtimeSend` with `InMemoryTransport` completes one turn and prints final summary.
- 10.2: implement using `CodexRuntime` + `EventNormalizer.events()` + `ApprovalBroker.attach()`.
- 10.3: subcommand wiring + README + safety rails (read-only sandbox + default-reject through ApprovalBroker — same as smoke).
- 10.4: test, typecheck, lint, commit.

Exit criteria (plan §1759): `pnpm runtime:send -- --prompt 'Reply OK'` runs end-to-end against real codex with same safety rails as smoke.

**User decision needed before T10 starts:** resume the autonomous overnight loop (ScheduleWakeup) OR drive T10 manually in this session. T10 is small and autonomous-safe per the original task table.

After T10:
- T11a / T11b — explicit user approval per the autonomous-mode hard stop. Plan §397 marks these "lead session lifecycle correctness critical".
- T12 — docs + roadmap update + Phase 1→2 handoff.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `f9915f7`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **283 passed (283)**, 28 files (was 277 pre-blocker-fix; +4 blocker-fix tests + +2 codex P2 follow-up tests)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (82 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `f9915f7`

Codex T9b blocker-fix review verdict: **APPROVE** (0 P0, 0 P1, 4 P2 — 3 resolved + 1 deferred-with-justification, 2 risky-assumption infos acknowledged for T11b).

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

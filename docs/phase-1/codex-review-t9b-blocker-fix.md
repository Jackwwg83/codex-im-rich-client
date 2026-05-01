# Codex outside-voice review — T9b blocker-fix (B-clean)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `8a14bbe..e814880` filtered to `packages/core/`
(B-clean implementation; 2 files; 743 lines of diff).

**Date:** 2026-05-01.

**Mode:** staged execution per user's 2026-05-01 directive (Step 0
docs / Step 1 failing tests / Step 2 implementation / Step 3 codex
review). User decided **B-clean** (broker owns single completion
promise per pending request, internal `PendingEntry` keeps
`ApprovalRecord` data-only) and explicitly **rejected Option A**
(extend `AppServerClient` with idempotent respond/reject). Option A
recorded as future backlog in `TODOS.md`.

---

## Verdict

> **APPROVE**
>
> P0 Blockers: None.
> P1 Required Fixes: None.
>
> The B-clean fix does prevent duplicate wire responses. The
> load-bearing path is `settleOnce`: the `settled` check, flag write,
> and promise resolve/reject all happen synchronously in one JS turn.
> Handler continuations and `#handle` await continuations run as
> microtasks, so `expirePending()` / `failPendingAsTransportLost()`
> cannot interleave inside a `settleOnce` call. First settler wins;
> late handler resolution/rejection is dropped.

## Codex's positive findings (worth recording)

> I confirmed `expirePending()` and `failPendingAsTransportLost()`
> no longer call `client.respond` / `client.reject` directly; both
> route through `entry.settleOnce`. `ApprovalRecord` remains data-only
> in `types.ts`, and the capability handles stay module-private inside
> `createPendingEntry`.
>
> `reattach()` resets `#transportLostFired` at the end of the success
> path, after the new handler is installed and `#client` is swapped.

## P2 improvements (codex)

> 1. Comments in a few places say late handlers observe
>    `record.status !== "pending"` and bail, but the actual guard is
>    `settleOnce`; the behavior is correct, the wording is just
>    slightly misleading.
> 2. Add a focused test for registered
>    `account/chatgptAuthTokens/refresh` plus `expirePending()` to
>    prove the `JsonRpcResponseError(-32601)` envelope is preserved
>    through the new completion path.
> 3. The fixed `setTimeout(30)` waits in the new tests match existing
>    style but remain mildly timing-sensitive; a poll helper would
>    make them sturdier.

## Missing tests (codex)

> - Late reject after `failPendingAsTransportLost()`. You cover late
>   resolve there, and late reject after expire, so this is low-risk
>   but completes the matrix.
> - Auth-refresh lifecycle error envelope after expire/transport-lost,
>   as above.

## Risky assumptions (codex)

> - Terminal records retained in `#pending` can grow for long sessions
>   until T11b prune lands. Not a Phase 1 blocker, but real under
>   prolonged use.
> - `#pending` is keyed by JSON-RPC id. If a future reattached codex
>   process reuses ids while old terminal records are retained, a new
>   request can overwrite old audit state. That is more of a
>   T11b/prune/audit design concern than a blocker in this diff.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | P2 | ✅ resolved | Comment wording in `failPendingAsTransportLost` and `expirePending` JSDoc updated to accurately describe the `settleOnce` guard (settled flag) instead of the previous "observe record.status !== 'pending' and bail" phrasing. The behavior was always correct; only the wording was misleading. |
| 2 | P2 missing-test | ✅ resolved | Added `"expirePending of auth-refresh preserves -32601 wire envelope"`. Hangs an `account/chatgptAuthTokens/refresh` handler, calls `expirePending(5)`, asserts `respP.rejects.toMatchObject({ code: -32601, message: /auth refresh not supported/ })` and exactly one wire frame for the request id. |
| 3 | P2 | ⏸ deferred | Timing-sensitive `setTimeout(30)` waits. Adding a poll helper would harden tests but touches the existing T9b test style across multiple files; out of this fix's scope. Re-evaluate if any test goes flaky in CI. |
| 4 | P2 missing-test | ✅ resolved | Added `"late-rejecting handler after failPendingAsTransportLost does not produce duplicate wire response"`. Completes the `{late-resolve, late-reject} × {expire, transport-lost}` matrix. Drives a manually-controlled reject after `failPendingAsTransportLost()`, asserts settleOnce no-ops on already-settled entry; exactly one wire frame stays for id 740. |
| risky-1 | risky-assumption (info) | 📋 acknowledged | Terminal records grow in `#pending` over long sessions. T11b adds `prunePending()` if monitoring shows growth. Phase 1 broker lifetime is bounded by supervisor session. |
| risky-2 | risky-assumption (info) | 📋 acknowledged | Reattached codex generation reusing JSON-RPC ids could overwrite stale terminal audit state. T11b's prune sweep + per-generation id-namespacing (if needed) would address. Not a Phase 1 blocker. |

4 of 4 actionable findings resolved (3 ✅ + 1 ⏸ deferred-with-justification). 2 risky-assumptions acknowledged. Test count: 281 → 283.

## Notes for the human reviewer

- The autonomous-loop's "blocker/medium → STOP" gate triggered correctly on the first T9b review (2 blockers found). User's manual decision (B-clean + reject Option A) drove this fix. Codex's APPROVE on the fix diff signals the lifecycle race is well-and-truly closed.
- Codex couldn't run the Vitest slice in its read-only sandbox (Vite needs to write `node_modules/.vite-temp/...`). Local `bash scripts/ci-check.sh` ran the full suite and all 8 gates passed at HEAD `429fc2c` (post-P2 commit) with 283/283 tests.
- The two risky-assumption flags are tracked but explicitly NOT in T9b's scope — they're T11b prune-design concerns. Recording here so they don't get lost.
- Total T9b sequence (this whole arc): T9b code Steps 9b.1-9b.6 → first codex review (2 blockers + 4 minor) → STOPPED → user design decision (B-clean) → docs amendment → failing tests → B-clean implementation → codex review APPROVE → P2 follow-ups → this doc. T9b is now functionally complete.

## Recommended forward path

1. Live-status sync: T9b complete (HEAD `429fc2c` for the P2 follow-ups; `e814880` for the main B-clean fix).
2. T10 (CLI runtime send) — small, autonomous-safe; user's call whether to resume the autonomous loop or do it manually.
3. T11a / T11b — explicit user approval per autonomous-mode hard stop. Plan §397 marks these "lead session lifecycle correctness critical".

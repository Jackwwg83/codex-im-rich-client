# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 01:50 (overnight wake 5) — **STOPPED** on T9b codex outside-voice review (2 blockers found). Autonomous loop halted; no further wakes scheduled. Awaiting human review. HEAD `bf97a49`. Test count 277/277.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9b STOPPED** — code Steps 9b.1-9b.6 all committed (`bf97a49` is HEAD); codex outside-voice review on T9b returned 2 blockers + 2 medium + 1 low + 1 nit. Per autonomous protocol, blockers without obvious low-risk fixes → STOP. Findings captured in `docs/phase-1/codex-review-t9b.md`. **Awaiting human review and design decision before any further work.**
- **Autonomous mode:** **HALTED**. Loop did NOT schedule next wake. Wake 5 was the last.
- **Last completed task:** **T9a** + Pre-3 + T1-T8 (see §3).
- **What needs human input:** see §10 for the open design question (blocker 1 — duplicate-response race needs Pre-4 AppServerClient extension OR a #handle refactor; blocker 2 — `#transportLostFired` reset on reattach is a one-liner but bundled with blocker 1 because the user should look at both together).

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

**STOPPED — codex review finding needs review.**

Wake 5's codex outside-voice review on T9b returned 2 blockers + 2 medium + 1 low + 1 nit. Both blockers have non-obvious fixes (one needs a Phase 0 contract change, the other is a one-liner but the design discussion should be unified). Per the autonomous protocol's blocker rule, the loop halted and did NOT schedule wake 6.

Findings full text + suggested fixes + recommended forward path: `docs/phase-1/codex-review-t9b.md`.

Total wake count: 5. Total commits this overnight session: ~20 (most code, several docs syncs, two reviews).

## 5. Next exact action

**User approval required before next wake.** Reason: 2 blockers in `docs/phase-1/codex-review-t9b.md` need design decision (the loop deliberately did not auto-fix because both fixes have subtle implications):

**Blocker 1** — duplicate-response race in `expirePending` / `failPendingAsTransportLost` interacting with in-flight `#handle` await. Three design options laid out in the review doc's "Recommended forward path":

- **(A) Pre-4 AppServerClient idempotence:** track responded ids in AppServerClient, drop duplicate respond/reject calls. Phase 0 contract change; ships as Pre-4 PR mirroring Pre-1/Pre-2/Pre-3 discipline.
- **(B) #handle refactor:** broker owns a per-record completion promise; `expirePending` settles the promise instead of calling client.respond directly. Stays inside packages/core/. Substantive change to #handle's contract.
- **(C) Phase 1 punt:** accept the race, document, push real fix to Phase 2 IM. Risky — 10-min default cutoff is operator-tunable.

**Blocker 2** — `#transportLostFired` not reset on `reattach()`. Trivial fix (one line in reattach's success path) but bundled with blocker 1 because the right answer might be "rework the lifecycle holistically" depending on which option you pick for blocker 1.

After your decision on blocker 1, the morning sequence:
1. Decide A / B / C for blocker 1 → apply fix
2. Apply blocker 2 + medium fixes + missing tests in same commit (the design unifies the lifecycle)
3. Re-run codex review on the fix commit. If clean → T9b complete.
4. Then T10 (CLI runtime send) — small, autonomous-safe.
5. T11a/T11b — explicit user approval per autonomous-mode hard stops.

T9b code Files (already committed at HEAD):
- `packages/core/src/approval-broker.ts`
- `packages/core/test/approval-broker.test.ts`
- `packages/core/test/no-method-literals.test.ts`

The grep guard test (Step 9b.6, `bf97a49`) is correct and unrelated to the blockers — it can land independently if you want to lock the boundary while designing the lifecycle fix.

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

**T9b's blocker 1 design decision required before any further loop work.**

The blocker is a real correctness bug (codex outside-voice analysis is sound — see review doc for the manual repro steps). The autonomous loop deliberately did NOT apply a fix because the right design depends on a tradeoff the user owns:

- Option A (Pre-4 AppServerClient idempotence) — cleanest semantically, smallest local change, but expands T9b's scope into Phase 0 contract.
- Option B (#handle refactor with completion promise) — stays inside packages/core/ but requires a non-trivial rewrite of #handle's contract. Higher risk of subtle bugs.
- Option C (Phase 1 punt) — fastest, but leaves a known-broken edge case in production.

Once a path is chosen, T9b's fix-up commit lands the chosen approach + blocker 2 + medium fixes + the missing tests, then we re-run codex review. After that:

- T10 (CLI runtime send) — small, autonomous-safe; can resume autonomous mode for it.
- T11a / T11b — explicit user approval per the autonomous-mode hard stop. Plan §397 marks these "lead session lifecycle correctness critical".

Other Phase 1 non-goals from handoff (unchanged across all tasks):
- Any IM adapter (Phase 2+).
- Computer Use production path (Phase 6).
- SQLite storage (Phase 2).
- ChannelAdapter / SessionRouter / CommandRouter (Phase 2).
- Public WebSocket / public HTTP listener (Phase 8).
- Rewriting any Phase 0 module.
- Making `AppServerClient` restartable.
- Default-approving any approval; bypassing approvals; failing-open on errors.

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

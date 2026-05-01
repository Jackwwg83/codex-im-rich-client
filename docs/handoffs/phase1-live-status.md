# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 — **TAG GATE FIX IN PROGRESS.** Codex integrated review returned NO-GO on `phase-1-runtime-complete`: 2 blockers (Supervisor spawn-failure cleanup hole, method-literal boundary not holding end-to-end) + M4 handoff overstating + L5 README staleness. User approved fix scope (per plan §"Tag gate"); fix passes are docs-first / code-second / metadata-third. Test count 315/315 still green at HEAD `814550d`.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core (T1-T12 committed; tag GATED on integrated-review fixes)
- **Active task:** **Phase 1 tag-gate fix pass.** Codex integrated review returned NO-GO; fixing 2 blockers + M4 + L5 inline.
- **Tag candidate:** `phase-1-runtime-complete` — applied AFTER all tag-gate fixes land + re-run codex review returns GO.
- **Next phase:** Phase 2 — Telegram MVP. Entry: `docs/handoffs/2026-05-01-phase1-to-phase2.md` (already updated to soften M4 wording + record M3 risk).
- **Last completed task:** **T12** (Phase 1 docs + roadmap + handoff). Tag-gate fix pass is post-T12.
- **Prior tasks (full Phase 1 chain):** Pre-1 → Pre-2 → T1 → T2 → T3 → T4 → T4.5 → T5 → T6 → T7a → T7b → T8 → Pre-3 → T9a → T9b code → T9b blocker-fix (B-clean) → T10 → T11a → T11b → T12.
- **Autonomous mode:** off. Hand-fixing tag-gate concerns under user staged-execution discipline.
- **Rejected alternatives** (do not relitigate): Option A (Pre-4 `AppServerClient` idempotent respond/reject) recorded as future backlog in `TODOS.md`, NOT implemented. Option C (Phase 1 punt) declined.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `f070a3d docs(phase-1): codex outside-voice review report — T10 (APPROVE WITH CHANGES, all P1 resolved)`
- **T10 chain:** `f070a3d` (review doc) ← `64c397f` (review fixes) ← `107af4a` (initial T10) ← `4f1821d` (T9b live-status).
- **T9b blocker-fix arc:** `f9915f7` (review doc) ← `429fc2c` (P2 follow-ups) ← `e814880` (B-clean fix) ← `8a14bbe` (Step 0 docs).
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
- **T10 (`codex-im runtime send` CLI) — landed.** 2 code commits (`107af4a` initial + `64c397f` review fixes) + review doc `f070a3d`. `runRuntimeSendCore` exercises the full Phase 1 runtime kernel end-to-end against FakeAppServer; CLI outer (`run(argv)`) spawns real codex via StdioTransport with sandbox=read-only + ApprovalBroker default-deny. Codex outside-voice review **APPROVE WITH CHANGES**: 0 P0, 2 P1 (forbidden method literal in JSDoc + pino routed to stderr), 2 P2 — all fixed inline. 12 missing tests added (parseRuntimeSendArgs matrix + turn_failed/turn_interrupted/timeout terminal variants). 299/299 tests pass.

## 4. Currently doing

**Tag-gate fix pass.** Codex integrated review on Phase 1 returned NO-GO. User decided 2026-05-01 to fix both blockers + M4 + L5 inline before tagging. Sequence:

1. Step 1 (this commit) — docs-first: method-literal policy in CLAUDE.md + plan tag-gate § + handoff M4 wording + Phase 2 risk recording for M3.
2. Step 2 — Blocker 2: Supervisor spawn-failure cleanup. `#spawnFresh`'s post-reattach steps wrap in try/catch; on failure, stop half-started client/transport, detach close subscription, set `#halted = true`, audit fatal. Tests for both initial-`start()` failure and recovery-spawn failure.
3. Step 3 — Blocker 1: refactor `packages/cli/src/smoke-real-turn.ts` to use `CodexRuntime.threadStart` / `CodexRuntime.turnStart` instead of raw `client.request("thread/start"/"turn/start", ...)`. Method-literal boundary now holds end-to-end in production src.
4. Step 4 — M4 (handoff softening, in this commit) + L5 (README quick-start metadata refresh in a later docs commit).
5. Step 5 — re-run codex outside-voice integrated review. If GO, apply tag.

T1-T12 are committed. This is purely tag-gate hardening. Test count stays 315/315 except Blocker 2 fix will add tests.

## 5. Next exact action

**T11a Step 11a.1** (per plan §1975-1986, "Daemon Supervisor skeleton") — needs explicit user approval before starting.

Plan files (T11a):
- Create: `packages/daemon/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`
- Create: `packages/daemon/src/supervisor.ts`
- Create: `packages/daemon/test/supervisor.test.ts`

Plan steps:
- 11a.1: skeleton (mirror T3 — package.json/tsconfig/index/types/README/vitest.config) — commit separately.
- 11a.2: failing test — `Supervisor.start()` constructs transport+client; on transport close, constructs a NEW transport+client (object identity differs).
- 11a.3: implement supervisor — owns spawn + transport subscription (Codex B7).

Why this is a hard stop:
- Plan §397 explicitly marks T11a + T11b as "lead session lifecycle correctness critical".
- Supervisor owns the transport spawn AND `transport.onClose` subscription (Codex B7 — `AppServerClient` has no public `onClose`; supervisor wraps the lifecycle).
- The supervisor swaps the entire `{transport, client, runtime, broker}` quartet on every recovery — bugs here are systemic and silent.
- T11b adds the lifecycle edges (codex restart loop, pending approval handoff via `broker.reattach()`, audit on fatal). The B-clean changes from T9b's blocker-fix make `broker.reattach()` race-free, but the supervisor needs to call it correctly.

Recommended starting question for the user: does the autonomous loop resume here, or is this hands-on lead-session work?

T12 (Phase 1 docs + roadmap update + Phase 1→2 handoff) depends on T11a+T11b. Also needs user approval.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD `f070a3d`)

- `pnpm typecheck` → exit 0 (6 packages)
- `pnpm test` → **299 passed (299)**, 29 files (was 283 pre-T10; +4 T10 happy-path + +9 parseRuntimeSendArgs + +3 terminal-variants/timeout)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (84 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green at `f070a3d`

Codex T10 review verdict: **APPROVE WITH CHANGES** (0 P0, 2 P1, 2 P2, several missing-tests — both P1s + 1 P2 + 3 of 5 missing tests resolved; 1 P2 + 2 missing tests deferred-with-justification).

T9b blocker-fix review verdict (prior): **APPROVE** (0 P0, 0 P1, 4 P2).

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

# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 — **TAG GATE FIX READY FOR RE-REVIEW.** Codex integrated review returned NO-GO on `phase-1-runtime-complete` (2 blockers + M4 handoff overstating + L5 README staleness). All 4 in-scope fix steps landed (`0232dc1` docs / `9096cca` Blocker 2 / `6059644` Blocker 1 / this commit metadata refresh). Test count 320/320 (was 315; +5 from Blocker 2 cleanup tests + grep guard test). Awaiting Codex outside-voice re-review before applying tag.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core (T1-T12 committed; tag GATED on integrated-review re-run)
- **Active task:** **Phase 1 tag-gate fix pass — fix steps complete.** All 4 in-scope steps landed: docs-first (`0232dc1`), Blocker 2 supervisor cleanup (`9096cca`), Blocker 1 smoke refactor (`6059644`), metadata refresh (this commit). Next: re-run Codex outside-voice integrated review on full fix diff; apply tag if GO.
- **Tag candidate:** `phase-1-runtime-complete` — applied AFTER re-run codex review returns GO.
- **Next phase:** Phase 2 — Telegram MVP. Entry: `docs/handoffs/2026-05-01-phase1-to-phase2.md` (already updated to soften M4 wording + record M3 risk).
- **Last completed task:** **T12** (Phase 1 docs + roadmap + handoff). Tag-gate fix pass is post-T12.
- **Prior tasks (full Phase 1 chain):** Pre-1 → Pre-2 → T1 → T2 → T3 → T4 → T4.5 → T5 → T6 → T7a → T7b → T8 → Pre-3 → T9a → T9b code → T9b blocker-fix (B-clean) → T10 → T11a → T11b → T12.
- **Autonomous mode:** off. Hand-fixing tag-gate concerns under user staged-execution discipline.
- **Rejected alternatives** (do not relitigate): Option A (Pre-4 `AppServerClient` idempotent respond/reject) recorded as future backlog in `TODOS.md`, NOT implemented. Option C (Phase 1 punt) declined.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD (pre-this-commit):** `6059644 fix(cli): route real smoke turn through CodexRuntime` (Blocker 1 / Step 3).
- **Tag-gate fix arc (4 commits):** `0232dc1` Step 1 docs-first ← `9096cca` Step 2 Blocker 2 supervisor cleanup ← `6059644` Step 3 Blocker 1 smoke refactor + ClientRequest grep guard ← *this commit* Step 4 README/package.json/handoff metadata refresh.
- **Pre-tag-gate baseline:** `814550d docs(phase1): T12 — Phase 1 close-out, roadmap update, Phase 1→2 handoff`.
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

**Tag-gate fix pass — fix steps complete; awaiting Codex re-review.** Codex integrated review on Phase 1 returned NO-GO 2026-05-01. User decided to fix both blockers + M4 + L5 inline before tagging. All in-scope steps now landed:

1. **Step 1 — `0232dc1` docs-first:** method-literal policy in CLAUDE.md + plan tag-gate § + handoff M4 wording + Phase 2 risk recording for M3.
2. **Step 2 — `9096cca` Blocker 2:** Supervisor spawn-failure cleanup. `#spawnFresh` wraps steps 1-7 in try/catch + new `#cleanupFailedGeneration` helper. On failure: stops half-started client/transport, detaches close subscription, sets `#halted = true`, audits fatal. +4 tests covering initial-`start()` failure paths (`client.start` / `performHandshake` / `broker.reattach`) and recovery-spawn failure (no further recovery cycle).
3. **Step 3 — `6059644` Blocker 1:** refactored `packages/cli/src/smoke-real-turn.ts` to use `CodexRuntime.threadStart` / `CodexRuntime.turnStart` and `ApprovalBroker.attach()`; removed pre-T8 `client.setServerRequestHandler` throwing handler. Added `packages/codex-runtime/test/no-raw-client-request.test.ts` build-time grep guard for ClientRequest method literals over `packages/{app-server-client,daemon,cli}/src/`. Method-literal boundary now holds end-to-end in production src.
4. **Step 4 — *this commit* metadata refresh:** README package count `5 → 7`, test count `67 → 320`, added `pnpm runtime:send` line; root `package.json` version `0.1.0-phase0 → 0.1.0-phase1`; CLI `clientVersion` defaults bumped to `0.1.0-phase1` in `runtime-send.ts` / `smoke-app-server.ts` / `smoke-real-turn.ts`; `phase1-live-status.md` synced.

**Step 5 (next):** re-run Codex outside-voice integrated review on the full tag-gate fix diff (`0232dc1..HEAD`). If GO, apply tag `phase-1-runtime-complete`. M3 (runtime-send vs Supervisor integration) stays a Phase 2 risk per user decision — not blocking the tag.

## 5. Next exact action

**Re-run Codex outside-voice integrated review on `0232dc1..HEAD`.**

Scope:
- Verify both blockers are actually fixed (Supervisor cleanup observable; smoke-real-turn no longer holds raw method literals).
- Verify M4 handoff wording now says "ApprovalBroker.resolve() remains a throwing stub; Phase 2 likely needs additional broker public surface".
- Verify L5 README metadata reflects current 7-package / 320-test reality.
- Confirm test count 320/320 + all 8 ci-check gates green at HEAD.

If GO: `git tag -a phase-1-runtime-complete -m "..."`. If conditional GO with low-severity nits: apply inline + commit as `fix(phase1): tag-gate review nits`. If NO-GO again: reopen the fix scope, do not tag.

After tag: Phase 2 (Telegram MVP) per `docs/handoffs/2026-05-01-phase1-to-phase2.md`.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty. The autonomous loop's recovery scan treats anything beyond this exact list as drift and triggers a hard stop.

## 7. Current test results (at HEAD = pre-this-commit `6059644` + Step 4 metadata refresh)

- `pnpm typecheck` → exit 0 (7 packages)
- `pnpm test` → **320 passed (320)**, 31 files (was 315 pre-tag-gate-fix; +4 Blocker 2 supervisor cleanup tests + 1 ClientRequest grep guard test)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (91 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green

Codex Phase 1 integrated review verdict (pre-fix): **NO-GO** (2 blockers + M4 + L5). Awaiting re-review on tag-gate fix diff `0232dc1..HEAD`.

T11b review verdict (prior): **APPROVE WITH CHANGES** (0 P0, all P1s resolved). T10 review verdict: **APPROVE WITH CHANGES** (0 P0, 2 P1 resolved).

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

**Tag-gate fix sequence — fix steps complete; tag GATED on Codex re-review.**

Cannot apply `phase-1-runtime-complete` tag until:
- Codex outside-voice integrated re-review on `0232dc1..HEAD` returns GO (or conditional GO with low-severity nits applied inline).
- All 8 ci-check gates green at HEAD (currently green).

Out-of-scope for this fix pass (do NOT relitigate):
- Option A (Pre-4 `AppServerClient` idempotent respond/reject) — future backlog in `TODOS.md`, never part of the tag-gate fix.
- M3 (runtime-send vs Supervisor integration) — recorded as Phase 2 integration risk per user decision; not a tag blocker.
- T1-T12 implementation work — committed and reviewed.

If Codex re-review surfaces new blockers, reopen the fix scope under user direction; do not auto-extend.

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

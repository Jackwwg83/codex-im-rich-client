# Phase 2 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 — **PLAN POLISH APPLIED (v2.2). T2 authorized after commit + green gates. No implementation has started.**

---

## 1. Current phase / task

- **Phase:** Phase 2 — Approval & IM Surface (planning + polish only; no implementation work yet)
- **Active task:** Phase 2 plan v2.2 — round-2 polish applied (14 items: 3 tension resolutions + 3 Codex P1 + 4 gstack P1 + 4 P2). Awaiting commit.
- **Tag candidate:** `phase-2-approval-im-surface-complete` — applied AFTER T1 → T24 implementation completes + final Codex outside-voice integrated review returns GO.
- **Next phase:** Phase 2 implementation. First task: **T2 — `approval-request-kind.ts` classifier in core**. Authorized files: `packages/core/src/approval-request-kind.ts` (create), `packages/core/test/approval-request-kind.test.ts` (create).
- **Last completed plan-level milestone:** plan v2.2 polish applied (this commit).
- **Prior plan milestones:**
  - 2026-05-01: plan v1 drafted → combined review REJECT (Codex P0×7, P1×7)
  - 2026-05-01: plan v2 (= v1.5) applied full P0+P1 fix arc
  - 2026-05-01: plan v2 round-2 review → APPROVE_WITH_CHANGES, 0 P0, T2 authorized after polish (Codex explicit)
  - 2026-05-01: plan v2.2 applied round-2 polish (this revision)
- **Autonomous mode:** off. Plan-edit work proceeded under user staged-execution discipline.
- **Rejected alternatives** (do not relitigate):
  - "First actor wins" approval semantics (Codex round-1 P0-5).
  - `decision-mapper.ts` as a method-literal home (Codex round-2 C1; mapper switches on `ApprovalRequestKind`).
  - `Function.prototype.toString()` as the settleOnce-bit-identical guard (Codex round-2 T3; uses `git show` source-range instead).
  - "approve" as a Codex wire decision (Codex round-1 P1-1; v2 = "accept", legacy = "approved").

## 2. Branch / HEAD

- **Branch:** `phase-2-approval-im-surface`
- **HEAD (pre-this-commit):** `23cbca7 fix(phase1): tag-gate review nits` = `phase-1-runtime-complete` tag.
- **Pending commit:** `docs(phase2): apply approval surface plan review polish` (plan v2.2 + this status file).
- **Main:** `main`.

## 3. Completed work (Phase 2 planning)

- Step 0 — Context recovery from repo files (CLAUDE.md, README.md, 01–13 docs, handoffs, codex-review-tag-gate-rerun, TODOS.md). Verified Phase 1 tag at HEAD.
- Step 1 — Baseline diagnostics: 8/8 ci-check gates green; 320/320 tests; typecheck/lint/protocol-check clean.
- Step 2 — Phase 2 Context Report emitted.
- Step 3 — Branch `phase-2-approval-im-surface` created off Phase 1 tag.
- Step 4 — Plan v1 drafted (1557 lines).
- Step 5 — gstack `/plan-eng-review` round 1 → APPROVE_WITH_CHANGES (8 architecture, 5 code-quality, 3 test gaps).
- Step 5 — Codex outside-voice round 1 → REJECT (Codex P0×7, P1×7).
- Step 6 — Plan v2 (= v1.5) applied full P0+P1 fix arc (1764 lines; F1–F14 mapped to body changes).
- Step 7 — gstack `/plan-eng-review` round 2 → APPROVE_WITH_CHANGES (4 P1 + 4 P2 polish).
- Step 7 — Codex outside-voice round 2 → APPROVE_WITH_CHANGES, **0 P0 blockers**, T2 authorized after polish.
- Step 8 — Plan v2.2 round-2 polish applied (this commit): 14 items.

## 4. Currently doing

**Plan polish committed; awaiting user authorization to begin T2.**

Plan v2.2 file: `docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md` (~1900 lines after polish).

## 5. Next exact action

**Begin T2 — `approval-request-kind.ts` classifier in core** per plan §5 Task T2.

Authorized files for T2:
- Create: `packages/core/src/approval-request-kind.ts`
- Create: `packages/core/test/approval-request-kind.test.ts`

T2 step sequence:
- T2.1 Write failing test (10 method→kind assertions per the table in T2.1).
- T2.2 Run test, expect FAIL — module not found.
- T2.3 Implement classifier.
- T2.4 Run test + `pnpm typecheck`. PASS.
- T2.5 Commit `feat(core): T2 ApprovalRequestKind classifier (D18 / F1 / Codex P0-1)`.

## 6. Currently modified files (working tree)

After plan polish commit, working tree should contain only:

```
?? .claude/scheduled_tasks.lock     # gstack runtime lock — allowed
```

`git stash list` is empty.

## 7. Current test results

- `pnpm typecheck` → exit 0 (7 packages)
- `pnpm test` → **320 passed (320)**, 31 files (Phase 1 baseline preserved; no Phase 2 tests added yet)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (91 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green

## 8. Current key decisions (Phase 2 — do not relitigate)

- **D11 (REVISED v2):** Per-`ApprovalRequestKind` wire mapper; takes pending record context; uses real generated wire values (v2 `accept`/`acceptForSession`/`decline`/`cancel`; legacy `approved`/`approved_for_session`/`denied`/`abort`; permissions/tool-input/tool-call/elicitation/auth-refresh non-decision shapes per protocol evidence).
- **D12 (REVISED v2):** Public read API filters by status; internal `#pendingById` lookup used by resolve/expire/transport-lost without status filter; emitters fire at `#settleEntry` boundary.
- **D13 (REVISED v2):** In-memory ring (default 1000, **hard MAX 100_000**) + structured pino + redact applied at emit; **12 audit event kinds** enumerated.
- **D14 (REVISED v2):** ChannelAdapter closed for Phase 2; future change is reviewed plan amendment.
- **D15 (REVISED v2):** Stable id `approval-${appServerRequestId}`; secondary index lock-step invariants.
- **D16 (APPROVED both rounds):** runtime-send stays direct; Supervisor integration test adds runtime invariant `broker.isAttached()` at `#spawnFresh` head.
- **D17 (CONFIRMED both rounds):** Telegram MVP **Option C** (`TelegramShapeFakeChannelAdapter`); real Telegram is Phase 3.
- **D18 (NEW v2):** `enablePendingMode<M>(method)` — three-mode dispatcher (default-reject/handler/pending); pending-mode creates PendingEntry without IIFE.
- **D19 (NEW v2):** `bindActorPolicy(approvalId, policy)` per-card binding; resolve validates actor+target+nonce. Round-2 strengthening: bindActorPolicy MUST be called synchronously in `onPendingCreated` callback before adapter.sendCard. Failure mode named **`binding_required`** (operator-precondition violation).
- **D20 (NEW v2):** Expiry checked inside `resolve()` itself; `expirePending` is memory hygiene only, NOT safety. `resolve` uses `entry.spec.defaultReject()` (PendingEntry stores its DispatcherSpec at creation time per Phase 1).
- **D21 (NEW v2):** `#settleEntry(entry, outcome, audit)` private helper; ALL settle call sites route through it; **`entry.settleOnce` body is byte-for-byte unchanged from Phase 1**. Win → original audit kind; Loss → `approval.duplicate_attempt`.

## 9. Current redlines (must hold every iteration)

Persistent (CLAUDE.md + Phase 0/1):
- No Codex CLI/TUI wrapper.
- AppServerClient is ONE-SHOT.
- Method literals confined to approved homes.
- ApprovalBroker single-handler invariant (D7).
- B-clean settleOnce body byte-for-byte unchanged.
- Unknown server-request methods → -32601 fail-closed.
- Approvals never auto-approve; default-deny.
- Computer Use needs explicit `/cu` (Phase 6).
- Logs redact secrets.

Phase 2 specific (added by §0.4):
- Wrong-actor / wrong-target / stale-callback / binding_required / expired / transport_lost / unknown_approval_id / unsupported_decision MUST fail closed via `broker.resolve` returning `{kind:"error"}` AND emitting an audit event.
- "First actor wins" REMOVED — replaced by `bindActorPolicy` per-card binding.
- Expired approvals MUST fail closed inside `resolve()` itself (not dependent on `expirePending` sweeper).
- Wire-unknown ServerRequest method → broker `#handle` -32601 + `approval.unsupported_method` + NO PendingEntry. Renderer-defensive unknown kind → decline-only ApprovalCard.
- `decision-mapper.ts` is NOT exempt from the method-literal grep guard — switches on `ApprovalRequestKind` only.
- "production = Supervisor; runtime-send = dev/operator only" stated in JSDoc, README, handoff, and T22 test names.
- Bot tokens via env or macOS Keychain ONLY; never in repo.
- Implementation code MUST NOT start until plan v2.2 is committed and gates pass.

## 10. Not allowed to advance until resolved

**Plan v2.2 polish committed; gates green; user authorization to begin T2.** All three conditions must hold.

After T2 begins, only T2-authorized files (`packages/core/src/approval-request-kind.ts` + its test) may be touched. Any other file is a scope violation; surface immediately.

## 11. First command for a new (post-compact) session

```bash
cat docs/handoffs/phase2-live-status.md && \
git status --short && \
git log --oneline -5
```

Then read `CLAUDE.md` "Compact / Resume Instructions" and follow the Context Recovery Mode flow before touching code.

---

**Status: PLAN POLISH READY FOR COMMIT.** Phase 2 implementation can begin from this point after the plan polish commit lands.

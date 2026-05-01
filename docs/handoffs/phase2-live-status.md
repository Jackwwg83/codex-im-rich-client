# Phase 2 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-05-01 — **T2 + T3 LANDED. PLAN v2.3 ROUND-3 DEEP-REVIEW POLISH APPLIED. T4 AUTHORIZED.**

---

## 1. Current phase / task

- **Phase:** Phase 2 — Approval & IM Surface (implementation in progress; serial spine T2→T3 done)
- **Active task:** Plan v2.3 polish committed (this commit). T4 (redact relocation to core) authorized to begin after gates re-confirm.
- **Tag candidate:** `phase-2-approval-im-surface-complete` — applied AFTER all of T1 → T24 implementation completes + final Codex outside-voice integrated review returns GO.
- **Next task:** **T4 — `redact.ts` relocated to core; expanded patterns.** Authorized files per plan §5 line ~927: `packages/core/src/redact.ts` (create), `packages/core/test/redact.test.ts` (create).
- **Last completed implementation milestone:** T3 audit skeleton (commit `bd99dd1`).
- **Plan milestones:**
  - 2026-05-01: plan v1 drafted → combined review REJECT (Codex P0×7, P1×7)
  - 2026-05-01: plan v2 (= v1.5) applied full P0+P1 fix arc
  - 2026-05-01: plan v2 round-2 review → APPROVE_WITH_CHANGES, 0 P0, T2 authorized after polish
  - 2026-05-01: plan v2.2 applied round-2 polish (commit `bfeb3dc`)
  - 2026-05-01: T2 ApprovalRequestKind classifier landed (commit `89968ee`)
  - 2026-05-01: T3 AuditEmitter skeleton landed (commit `bd99dd1`)
  - 2026-05-01: Codex deep review on Phase 2 to date → APPROVE_T4_AFTER_FIXES, 0 P0, 6 P1 + 7 P2
  - 2026-05-01: plan v2.3 round-3 polish (Option B+ — 6 P1 + 2 docs-P2; 5 test-hardening P2 deferred to TODOS.md backlog) — **THIS COMMIT**
- **Autonomous mode:** off. Implementation continues under user staged-execution discipline; each task: TDD-first → targeted test FAIL → impl → all gates → user-approved commit → next task.
- **Rejected alternatives** (do not relitigate):
  - "First actor wins" approval semantics (Codex round-1 P0-5)
  - `decision-mapper.ts` as a method-literal home (Codex round-2 C1; mapper switches on `ApprovalRequestKind`)
  - `Function.prototype.toString()` as the settleOnce-bit-identical guard (Codex round-2 T3; uses `git show` source-range instead)
  - "approve" as a Codex wire decision (Codex round-1 P1-1; v2 = "accept", legacy = "approved")
  - pino as a runtime dep of `@codex-im/core` (round-3 P2-7b; duck-typed `AuditLogger` instead, approved T3 decision)
  - T9 testing through resolve() before T10 mapper exists (round-3 P1-5; reordered: T9 = bind storage only, T10 = mapper, T11 = resolve)

## 2. Branch / HEAD

- **Branch:** `phase-2-approval-im-surface`
- **HEAD (pre-this-commit):** `bd99dd1 feat(core): T3 AuditEmitter skeleton + 12 event kinds + ring hard MAX 100_000 (D13)`
- **Phase 2 commits to date (3, plus this one in flight):**
  - `bfeb3dc docs(phase2): apply approval surface plan review polish` (plan v2.2)
  - `89968ee feat(core): add approval request kind classifier` (T2)
  - `bd99dd1 feat(core): T3 AuditEmitter skeleton + 12 event kinds + ring hard MAX 100_000 (D13)` (T3)
  - **THIS COMMIT (in flight):** `docs(phase2): apply codex deep-review polish` (plan v2.3 + this status update)
- **Phase 1 tag:** `phase-1-runtime-complete = 23cbca7` (immutable contract)
- **Main:** `main` (untouched since Phase 1)

## 3. Completed work (Phase 2 implementation)

- ✅ **T1** Protocol evidence inspection — done as part of plan v2 header (12 generated TS files cited with line numbers).
- ✅ **T2** `approval-request-kind.ts` classifier (commit `89968ee`):
  - 10-arm `ApprovalRequestKind` union (9 known kinds + `unknown` fail-closed default)
  - `classifyApprovalRequest(method)` with `as const satisfies Record<ServerRequest["method"], ...>` compile-fail guard
  - `Object.hasOwn` prototype-chain defense
  - Exported via `packages/core/src/index.ts`
  - 13 tests; gates 8/8 green
- ✅ **T3** `audit.ts` AuditEmitter skeleton (commit `bd99dd1`):
  - 12-arm `AuditEventKind` union (D13)
  - `AuditEvent` shape (target field deferred to T6)
  - `AuditEventInput = Omit<AuditEvent, "id" | "createdAt">`
  - Duck-typed `AuditLogger` interface (no pino runtime dep on core; approved T3 decision)
  - `AuditEmitter` with constructor validation (RangeError on invalid ringSize), FIFO ring, `emit()` auto-fills id+createdAt, `recent({limit, kind?})`, `_auditRingForTest()`
  - `AUDIT_RING_HARD_MAX = 100_000` (Codex round-2 Q4)
  - 21 tests; gates 8/8 green
- ✅ **Plan v2.3 round-3 polish** (this commit):
  - 6 P1 fixes: T2 file list, T2 Record typing, "10 event kinds" → 12, D20 unknown-id audit kind, T9/T10/T11 reorder + T9 split, phase2-live-status update
  - 2 P2 docs fixes: D13/§3 AuditLogger doc, §10A wording
  - 5 P2 test-hardening items deferred to TODOS.md backlog

## 4. Currently doing

**Plan v2.3 polish about to commit. After commit + green gates, T4 starts.**

## 5. Next exact action

**Begin T4 — `redact.ts` relocated to core; expanded patterns** per plan §5 line ~927.

Authorized files for T4:
- Create: `packages/core/src/redact.ts`
- Create: `packages/core/test/redact.test.ts`

T4 step sequence per plan:
- T4.1 Write failing tests for redact patterns (Telegram tokens, GitHub tokens, Slack/OpenAI tokens, generic Bearer, abs paths, SSH/PEM keys, AWS/GCP keys, env-var values, contextual base64).
- T4.2 Run, FAIL.
- T4.3 Implement `redact(text)` using pre-compiled regex array; single pass.
- T4.4 Run, PASS.
- T4.5 Commit `feat(core): T4 redact relocated from render; expanded patterns (F10 / Codex Q5)`.

## 6. Currently modified files (working tree)

After this plan-polish commit, working tree should contain only:

```
?? .claude/scheduled_tasks.lock     # gstack runtime lock — allowed
```

`git stash list` is empty.

## 7. Current test results (post-T3 baseline; pre-T4)

- `pnpm typecheck` → exit 0 (7 packages)
- `pnpm test` → **354 passed (354)**, 33 files (Phase 1 baseline 320 + T2 13 + T3 21 = 354)
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (95 files biome)
- `pnpm protocol:check` → exit 0
- `bash scripts/ci-check.sh` → all 8 gates green

## 8. Current key decisions (Phase 2 — do not relitigate)

- **D11 (REVISED v2):** Per-`ApprovalRequestKind` wire mapper; takes pending record context; uses real generated wire values.
- **D12 (REVISED v2):** Public read API filters by status; internal `#pendingById` lookup used by resolve/expire/transport-lost without status filter; emitters fire at `#settleEntry` boundary.
- **D13 (REVISED v2):** In-memory ring (default 1000, **hard MAX 100_000**) + structured emit via duck-typed `AuditLogger` (approved T3 decision; no pino runtime dep on core) + redact applied at emit; **12 audit event kinds** enumerated.
- **D14 (REVISED v2):** ChannelAdapter closed for Phase 2; future change is reviewed plan amendment.
- **D15 (REVISED v2):** Stable id `approval-${appServerRequestId}`; secondary index lock-step invariants.
- **D16 (APPROVED both rounds):** runtime-send stays direct; Supervisor integration test adds runtime invariant `broker.isAttached()` at `#spawnFresh` head.
- **D17 (CONFIRMED both rounds):** Telegram MVP **Option C** (`TelegramShapeFakeChannelAdapter`); real Telegram is Phase 3.
- **D18 (NEW v2):** `enablePendingMode<M>(method)` — three-mode dispatcher (default-reject/handler/pending).
- **D19 (NEW v2):** `bindActorPolicy(approvalId, policy)` per-card binding; resolve validates actor+target+nonce. Failure mode named **`binding_required`** (operator-precondition violation).
- **D20 (NEW v2):** Expiry checked inside `resolve()` itself; `expirePending` is memory hygiene only. resolve() emits `approval.unknown_approval_id` (NOT `unsupported_method`) for missing-id branch (round-3 P1-4 fix).
- **D21 (NEW v2):** `#settleEntry(entry, outcome, audit)` private helper; ALL settle call sites route through it; **`entry.settleOnce` body byte-for-byte unchanged from Phase 1**.
- **Round-3 task ordering (NEW v2.3):** T10 = decision-mapper + action-to-decision; T11 = broker.resolve. T9 trimmed to bind-storage-only; resolve()-invoking actor-validation tests live in T11.4.

## 9. Current redlines (must hold every iteration)

Persistent (CLAUDE.md + Phase 0/1):
- No Codex CLI/TUI wrapper.
- AppServerClient is ONE-SHOT.
- Method literals confined to approved homes (Phase 1: `runtime.ts` REQUEST_METHODS, `approval-broker.ts` DispatchTable; Phase 2 NEW: `approval-request-kind.ts` only).
- `decision-mapper.ts` is NOT a method-literal home — must remain method-string-free.
- ApprovalBroker single-handler invariant (D7).
- B-clean settleOnce body byte-for-byte unchanged (verified post-T3 by codex deep review).
- Unknown server-request methods → -32601 fail-closed.
- Approvals never auto-approve; default-deny.
- Computer Use needs explicit `/cu` (Phase 6).
- Logs redact secrets.

Phase 2 specific (added by §0.4):
- Wrong-actor / wrong-target / stale-callback / binding_required / expired / transport_lost / unknown_approval_id / unsupported_decision MUST fail closed via `broker.resolve` returning `{kind:"error"}` AND emitting an audit event.
- "First actor wins" REMOVED — replaced by `bindActorPolicy` per-card binding.
- Expired approvals MUST fail closed inside `resolve()` itself.
- Wire-unknown ServerRequest method → broker `#handle` -32601 + `approval.unsupported_method` + NO PendingEntry. Renderer-defensive unknown kind → decline-only ApprovalCard.
- "production = Supervisor; runtime-send = dev/operator only" stated in JSDoc, README, handoff, and T22 test names.
- Bot tokens via env or macOS Keychain ONLY.
- `@codex-im/core` is logger-implementation-agnostic — no pino runtime dep (round-3 P2-7b / approved T3 decision).

## 10. Not allowed to advance until resolved

**This plan-polish commit landing + green gates re-confirm.** Then T4 starts.

After T4 begins, only T4-authorized files (`packages/core/src/redact.ts` + its test) may be touched. Any other file is a scope violation; surface immediately.

## 11. First command for a new (post-compact) session

```bash
cat docs/handoffs/phase2-live-status.md && \
git status --short && \
git log --oneline -8
```

Then read `CLAUDE.md` "Compact / Resume Instructions" and follow the Context Recovery Mode flow before touching code.

---

**Status: PLAN POLISH READY FOR COMMIT. T4 AUTHORIZED AFTER THIS COMMIT LANDS.**

# Phase 3 Live Status

> Single source of truth for Phase 3 implementation. Read first on compact / resume / context loss.
> **Last updated:** 2026-05-02 — Phase 3 active; storage-sqlite skeleton + database lifecycle + migrations + first repository slices landed (T1.1 → T4b) + docs convergence (`f4e1b69`) + handoff checkpoint (`f493360`) + autonomous-loop runbook (`084aab8`).
> **Handoff status:** T4b complete locally in the current implementation commit: `BindingRepository.list/delete` + two focused tests. All 5 gates green. Next exact issue: JAC-31 / T4c.

---

## 1. Current phase / task

- **Phase:** Phase 3 — Telegram MVP + production daemon wire-up + SecurityPolicy ACL + persistent SessionRouter (SQLite) + launchd integration. **Plan:** `docs/superpowers/plans/2026-05-02-phase-3-plan.md` v2.4.
- **Active task:** None at this checkpoint. Last completed: **T4b / JAC-30** (`BindingRepository.list` + `delete` + two focused tests).
- **Next exact task:** **T4c / JAC-31** — `BindingRepository` durable write-through failure semantics (D38). Prove SQLite write failure surfaces to caller and no optimistic in-memory state is populated.
- **Phase 3 mission scope** (per plan §1): real Telegram adapter, production daemon wire-up, SecurityPolicy ACL, persistent SessionRouter backed by SQLite, durable audit log, callback_tokens (D34), launchd. Phase 3 plan went through 4 codex outside-voice rounds + 2 gstack `/plan-eng-review` rounds; v2.4 approved with T1 implementation gate authorized.

## 2. Branch / HEAD

- **Branch:** `phase-3-implementation`
- **HEAD:** current T4a implementation commit (run `git log --oneline -1`); prior checkpoint `084aab8` added the autonomous-loop runbook.
- **Tag distance:** `phase-2-codex-reviewed` plus current Phase 3 implementation commits (run `git describe --tags`)
- **Origin:** local branch may be ahead until the operator/agent pushes; verify with `git rev-list --left-right --count origin/phase-3-implementation...HEAD`
- **Base tag:** `phase-2-codex-reviewed` (annotated, at `0d4dfc3`) — Phase 2 close + codex backfill review fix arc complete
- **Branch genealogy:** `phase-2-codex-reviewed` → `chore/codex-upgrade-0.128` → `phase-3-planning` → `phase-3-implementation`

### Phase 3 implementation commits (6 since branch base, in order)

| Commit | T-task | Scope |
|---|---|---|
| `3ada728` | T1.1 | `@codex-im/storage-sqlite` package skeleton + boundary tests |
| `826fdfc` | T2a | `openDatabase` + WAL + `foreign_keys = ON` pragmas (3 tests) |
| `f6972de` | T2b | `runMigrations` + `schema_version` bootstrap + filename regex (3 tests) |
| `d891960` | T2c | Idempotency test (corrupt-file-between-runs trick) |
| `04a92fe` | codex P1+P2 fix | Boundary tightening + atomic-rollback test + BEGIN/COMMIT JSDoc |
| `c06813e` | T3a | `001-init.sql` owns schema_version DDL + real-dir runner test + PRAGMA shape pin |
| `f4e1b69` | docs convergence | Phase 3 live-status doc + README/ROADMAP/TODOS/phase2-live-status banners (no source code) |
| `f493360` | handoff checkpoint | Refresh this live-status HEAD + add §10 handoff to Codex section (no source code) |
| `084aab8` | autonomous-loop runbook | Add `docs/automation/codex-app-autonomous-loop-runbook.md` + AGENTS/CLAUDE pointer |
| `b25cb78` | T4a | `002-thread-bindings.sql` + `BindingRepository.upsert/findByTarget` + round-trip test |
| current T4b commit | T4b | `BindingRepository.list/delete` + two focused tests |

## 3. Versions / pins

- **Root `package.json` `version`:** `0.1.0-phase2` — **correct as-is**. Per plan §19 item 28, version bumps to `0.1.0-phase3-draft` at Phase 3 tag time, NOT during implementation.
- **`codexIm.codexVersion`:** `0.128.0`
- **`CODEX_VERSION` file:** `0.128.0`
- **Local `codex --version`:** `codex-cli 0.128.0`
- **`pnpm protocol:check`:** green (three-way version gate aligned)

## 4. Test count + gate matrix (at HEAD)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | green (10 packages strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess) |
| Test typecheck | `pnpm typecheck:tests` | green |
| Tests | `pnpm test` | **742 passing + 1 skipped** across 66 test files (Phase 2 close: 720; +22 from storage-sqlite) |
| Lint | `pnpm lint` | green (153 files, biome) |
| Protocol gate | `pnpm protocol:check` | green (codex 0.128.0; 234 schema files canonical) |
| D27 storage boundary | `packages/storage-sqlite/test/no-upward-imports.test.ts` | 8 packages forbidden, type-only included, `import|export ... from` predicate, multi-line aware |
| F13 channel-core boundary | inherited from Phase 2 | green |
| Method-literal boundary | `packages/core/test/no-method-literals.test.ts` | green (storage-sqlite confined; only `approval-broker.ts` + `approval-request-kind.ts` may hold method literals) |

## 5. Codex outside-voice review status

- **Phase 3 plan v2.4:** APPROVE_WITH_CHANGES at codex round 4 (4 P1 + 2 P2, all absorbed). Plan-of-record under `docs/superpowers/plans/2026-05-02-phase-3-plan.md`. Round-by-round records under `docs/phase-3/plan-v{1,2.1,2.2,2.3}-codex-{review,round2,round3,round4}.md`.
- **Implementation T1.1+T2a+T2b+T2c review (impl-t1-t2c):** APPROVE_WITH_CHANGES, 0 P0 + 1 P1 + 2 P2. All findings cleared by commit `04a92fe`. Per-task scope verdict: clean across all 4 commits. Record at `docs/phase-3/impl-t1-t2c-codex-review.md`.
- **Next planned codex review:** mid-Phase-3 implementation review after the storage repository tasks (T4a-T6f) land, OR end-of-Phase-3 integrated review at tag time. Cadence is at-discretion, not per-task.

## 6. Active redlines (carry forward into all future Phase 3 tasks)

Inherits everything from CLAUDE.md + Phase 1 + Phase 2 redlines. Phase 3 adds:

- ❌ **D27** — `@codex-im/storage-sqlite` is the LOWEST layer. NO upward import (runtime OR type-only) of `@codex-im/core`, `@codex-im/codex-runtime`, `@codex-im/app-server-client`, `@codex-im/channel-core`, `@codex-im/protocol`, `@codex-im/render`, `@codex-im/daemon`, `@codex-im/im-telegram`. Storage stores opaque strings, not protocol shapes. Enforced by `no-upward-imports.test.ts`.
- ❌ **D38** — sync write-through. SessionRouter's `/use` command MUST fail on SQLite write error; in-memory state MUST NOT be optimistically populated. better-sqlite3's sync API is the load-bearing primitive.
- ❌ **D33 step ordering** — every callback validation step is read-only BEFORE `broker.resolve`. CAS bound→used fires only on `result.kind === "ok"` (i.e. broker accepted). Validation MUST NOT burn the token before the broker decides.
- ❌ **D34** — `callback_tokens` stores ONLY the SHA-256 hash of the raw token; the raw bytes never reach SQLite. Action enum is `'allow_once' | 'allow_session' | 'decline' | 'abort'` (NOT `'cancel'`).
- ❌ **D36** — SecurityPolicy auto-decline is NOT `binding_required`. The broker returns `ok` with `decision = decline`; codex sees the standard decline shape.
- ❌ **D40** — broker single-approval extension is the ONLY API. No first-actor-wins fallback; no `expirePending()` as security boundary.
- ❌ **D41** — `ApprovalUiAction.wirePayload` + `InboundAction.rawCallbackData` are the production callback contract. `callbackNonce` is legacy fallback only; production daemon code MUST NOT use it.
- ❌ **D42** — `EventNormalizer.endWithSynthetic` orders synthesized events FIFO before stream end via `#enqueue → #drain → endOfStream`. Bare `endOfStream()` follow-up is a no-op.
- ❌ **No method literals outside the 2 approved tables** — `approval-broker.ts` `DispatchTable` + `approval-request-kind.ts` `METHOD_TO_KIND` are the SOLE homes for ServerRequest method strings. Storage / render / channel-core / im-telegram / daemon source code carries zero literals. `decision-mapper.ts` switches on `ApprovalRequestKind`, never on method strings (T20.3 explicit assertion).
- ❌ **bot token never rendered into plist / logs / fixtures / SQLite / audit** (D Op-1). launchd plist references a Keychain entry; daemon resolves at startup.
- ❌ **No public listener** — daemon binds to nothing.
- ❌ **No premature Computer Use / Lark / DingTalk** — Phase 6 / Phase 4 / Phase 5 respectively.

Plan §19 lists 29 exit criteria; this status doc is not the place to enumerate them. Source: plan §6 + §7 + §16.

## 7. Rejected alternatives (do not relitigate)

- "First actor wins" approval semantics — same as Phase 2 redline; carried.
- `callback_tokens.target_key TEXT` — replaced with 4 explicit columns (`target_platform`, `target_chat_id`, `target_thread_key`, `target_topic_id`) + hydration contract (codex round 4 P1).
- `cancel` as the action enum value — replaced with `abort` to match `ApprovalUiAction.kind` (codex round 3 P1).
- CAS bound→used burning the token before broker.resolve — reordered: validation read-only, then broker, then CAS only on ok (codex round 2 P0).
- `MIGRATIONS_DIR` exported from storage-sqlite at T3a — deferred until daemon wire-up (T15-T19) actually needs it; current scope is plan-strict.
- `import type` carve-out in storage boundary tests — removed as P1 fix (codex impl review). Storage's D27 boundary is strict; channel-core's F13 type-only carve-out does not apply.

## 8. Documentation companions

- **Phase 3 plan-of-record:** `docs/superpowers/plans/2026-05-02-phase-3-plan.md` (v2.4)
- **Phase 2 → Phase 3 handoff:** `docs/handoffs/2026-05-02-phase2-to-phase3.md`
- **Phase 2 frozen status:** `docs/handoffs/phase2-live-status.md` (frozen — see banner there)
- **Plan reviews:** `docs/phase-3/plan-v{1,2.1,2.2,2.3}-codex-*.md` + `plan-v2-gstack-round2-review.md`
- **Implementation review:** `docs/phase-3/impl-t1-t2c-codex-review.md`
- **Project rules:** `CLAUDE.md` (root) — contains the generic compact-recovery rules; this file is the Phase 3 live-status anchor those rules land readers on.

## 9. Compact / resume context

If you are resuming after `/compact`, `/resume`, or context loss:

1. Read this file FIRST (you are here).
2. Read `CLAUDE.md` for project-wide rules + redlines.
3. Read `docs/superpowers/plans/2026-05-02-phase-3-plan.md` §16.2 for the next T-task body. The next task is **T4c** (`BindingRepository` durable write-through failure semantics).
4. Run `git status --short` + `git log --oneline -10` to confirm branch state matches §2 above.
5. Run `pnpm test` + `pnpm typecheck` to confirm gates green.
6. STOP and output a Context Recovery Report. Do NOT modify code until the user approves the recovery.

## 10. Handoff to Codex (2026-05-02)

Active developer at this checkpoint: previous session was Claude Code; subsequent T-task implementation is being handed to Codex CLI. **No work in flight.** No uncommitted code. Origin synced.

For the Codex agent picking this up:

1. **Verify clean state:**
   - Historical expectation at `f493360`: `git status --short --untracked-files=all` showed only `.claude/scheduled_tasks.lock`, `AGENTS.md`, and six `*.stderr` review logs. Current expectation: `AGENTS.md` is tracked by the autonomous-loop runbook commit; only `.claude/scheduled_tasks.lock` + review `*.stderr` files should remain untracked.
   - Historical checkpoint: `git log --oneline -1` showed `f493360 docs(phase3): handoff checkpoint — bump live-status to f4e1b69 + add §10 codex handoff section`. Current HEAD is documented in §2.
   - Use `git rev-list --left-right --count origin/phase-3-implementation...HEAD` to verify local-vs-origin sync.
2. **Verify gates green at the checkpoint:**
   - `pnpm test` → 65 files, 739 pass + 1 skip.
   - `pnpm typecheck` + `pnpm typecheck:tests` → both clean.
   - `pnpm lint` → 151 files clean.
   - `pnpm protocol:check` → codex 0.128.0, schema unchanged.
3. **Out-of-scope, do NOT touch in normal T-task work:**
   - `AGENTS.md` (untracked duplicate of CLAUDE.md) — flagged in convergence audit; deferred until intentional cleanup pass.
   - `docs/{phase-2,phase-3}/*.stderr` — leftover codex review-run stderr; deferred until intentional cleanup or `.gitignore` decision.
   - `.claude/scheduled_tasks.lock` — runtime artifact, never committed.
4. **Read order on first session:**
   1. This file (you are here).
   2. `CLAUDE.md` — generic redlines + compact-recovery rules.
   3. `docs/superpowers/plans/2026-05-02-phase-3-plan.md` §16.2 (T4a body) + §17 (dep graph) + §6 (Phase 3 redlines) + §7 (decisions D22+).
   4. `packages/storage-sqlite/src/database.ts` (current implementation surface).
   5. `packages/storage-sqlite/test/migrations.test.ts` (existing test pattern to extend for T4a).
5. **Cadence expectations carried forward from prior sessions:**
   - One T-task per commit. Don't bundle T4a + T4b + T4c into one commit.
   - Run all 5 gates (typecheck / typecheck:tests / test / lint / protocol:check) before each commit.
   - Stop after every T-task and output a completion report. Wait for "ok 开始 T<next>" before proceeding to the next T-task. (User explicitly preferred per-task pacing throughout T1.1 → T3a.)
   - Codex outside-voice impl review cadence is at-discretion, not per-task. Past pattern: review after a coherent batch (e.g. T1.1 → T2c was reviewed together). Suggest a review batch around T4a–T6c (storage repositories) when those land.
   - When the user says "做一次 codex review", produce a prompt under `docs/phase-3/impl-<scope>-codex-review-prompt.md`, invoke `cat <prompt> | codex exec --sandbox read-only -c model_reasoning_effort=xhigh > <output>.md 2> <output>.stderr` in the background.
   - Don't bump `package.json` `version`. Plan §19 item 28 ties `0.1.0-phase3-draft` to Phase 3 tag time.
   - Don't run repo-wide format. Per-file `pnpm format` after edits is fine; biome auto-formats minor whitespace differences.

This section is the historical Claude-to-Codex handoff. The next live task has advanced: **T4a and T4b are complete**. Continue with **T4c / JAC-31** only (`BindingRepository` durable write-through failure semantics), and do not start ApprovalRepository yet.

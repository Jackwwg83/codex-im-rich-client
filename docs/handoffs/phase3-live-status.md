# Phase 3 Live Status

> Single source of truth for Phase 3 implementation. Read first on compact / resume / context loss.
> **Last updated:** 2026-05-02 — Phase 3 active; storage-sqlite block complete, config package + env secret resolver landed, broker/render/runtime prerequisites complete, JAC-18 / T9-T13 core policy/router foundation complete, JAC-19 / D41 channel-core callback payload boundary complete, JAC-39 / T15 daemon strict start order complete, and JAC-40 through JAC-45 daemon approval callback flow complete.
> **Handoff status:** JAC-45 complete: inbound actions decode `rawCallbackData`, hash lookup callback token rows, and fail closed for malformed / missing / expired / revoked / used / issued tokens without calling `broker.resolve`. All 5 gates green. Next exact issue: JAC-46 / T17.2 `MessageRef` validation before `broker.resolve`.

---

## 1. Current phase / task

- **Phase:** Phase 3 — Telegram MVP + production daemon wire-up + SecurityPolicy ACL + persistent SessionRouter (SQLite) + launchd integration. **Plan:** `docs/superpowers/plans/2026-05-02-phase-3-plan.md` v2.4.
- **Active task:** None at this checkpoint. Last completed: **JAC-45 / T17.1** (decode `action.rawCallbackData`, hash lookup callback token record, and fail closed for malformed / no record / expired / revoked / used / issued without calling `broker.resolve`).
- **Next exact task:** **JAC-46 / T17.2** — validate callback token `messageRef` against inbound action `messageRef` before `broker.resolve`; mismatch and unknown message fail closed with no token mutation.
- **Phase 3 mission scope** (per plan §1): real Telegram adapter, production daemon wire-up, SecurityPolicy ACL, persistent SessionRouter backed by SQLite, durable audit log, callback_tokens (D34), launchd. Phase 3 plan went through 4 codex outside-voice rounds + 2 gstack `/plan-eng-review` rounds; v2.4 approved with T1 implementation gate authorized.

## 2. Branch / HEAD

- **Branch:** `phase-3-implementation`
- **Latest code commit:** `a448ecc` (`feat(daemon): T17.1 fail closed callback lookup`)
- **Tag distance at latest code commit:** `phase-2-codex-reviewed-66-ga448ecc`
- **Origin:** synced after each pushed checkpoint; verify with `git rev-list --left-right --count origin/phase-3-implementation...HEAD`
- **Base tag:** `phase-2-codex-reviewed` (annotated, at `0d4dfc3`) — Phase 2 close + codex backfill review fix arc complete
- **Branch genealogy:** `phase-2-codex-reviewed` → `chore/codex-upgrade-0.128` → `phase-3-planning` → `phase-3-implementation`

### Phase 3 implementation commits (in order)

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
| `89742a3` | T4b | `BindingRepository.list/delete` + two focused tests |
| `2904b36` | T4c | D38 write-failure surfaces to caller; no optimistic repository state |
| `931ad5f` | T5a | `003-approvals.sql` + `ApprovalRepository.upsert/findById` + round-trip test |
| `d50e705` | T5b | Injected `ApprovalRepository` redactor + redaction round-trip test |
| `baeb3f5` | T6a | `004-audit-log.sql` + `AuditRepository.insert/findById` + round-trip test |
| `0c4fd23` | T6b | Injected `AuditRepository` redactor + redaction round-trip test |
| `d6620f8` | T6c | `AuditRepository.insertBestEffort` + rate-limited SQLite failure marker + dropped counter |
| `2891a9f` | T6d | `007-callback-tokens.sql` + `CallbackTokenRepository.insert/findByHash/casUpdate/pruneExpired` |
| `3d9d30c` | T6e | `hashCallbackToken()` + raw-token absence assertion across SQLite row columns |
| `6ae48d6` | T6f | Callback token action enum round-trip guard; `cancel` excluded |
| `d549e92` | T7-T8 | `@codex-im/config` package + TOML/zod schema + env secret resolver |
| `2118cea` | docs automation | Record unattended autonomous-loop operator directive |
| `de39ac9` | T6.5 | `ApprovalBroker.failPendingApprovalAsTransportLost(approvalId)` + single-approval tests |
| `a0cdf64` | T6.6 | `ApprovalUiAction.wirePayload?: string` + render type round-trip test |
| `260e23f` | T6.7 | `EventNormalizer.endWithSynthetic(events)` + FIFO/done/idempotence/parked-waiter tests |
| `ec68bc7` | T9.1 | `SecurityPolicy` skeleton/types + default fail-closed behavior |
| `1d35bec` | T9.2 | `SecurityPolicy.checkUserAndChat` allowlist enforcement |
| `7eb7406` | T9.3 | `SecurityPolicy.checkApprovalDestination` auto-decline destination gate |
| `82320e7` | T9.4 | `SecurityPolicy.checkCommand` deny/admin pattern handling |
| `3901c7e` | T9.5 | Atomic `SecurityPolicy.reload()` validation/swap semantics |
| `7d2ab81` | T12 | Pure `CommandRouter` for slash commands, prompts, attachments, and Phase 3 `/cu` rejection |
| `f7c3c90` | T13a | `SessionRouter` interface + platform-neutral skeleton |
| `b25d912` | T13b | `SessionRouter.bind` / `bindThread` sync write-through behavior tests |
| `d0fce55` | T13c | `SessionRouter.resolve` cache hit + repository fallback cache population |
| `a105f35` | T13d | Startup cache rebuild from injected binding repository `list()` |
| `064db18` | T13e | Write-failure guard: no optimistic SessionRouter cache updates |
| `ad44918` | docs checkpoint | Refresh live-status for JAC-18 completion |
| `10e898e` | T-D41a-d / JAC-19 | `InboundAction.rawCallbackData`, `wirePayload` passthrough/fallback, fake adapter update, JSDoc guard |
| `c2648f3` | docs checkpoint | Refresh live-status for JAC-19 completion |
| `6d1b4ae` | T14 / JAC-38 | `Daemon` skeleton + `DaemonOptions` injection bag + no-public-listener boundary test |
| `cb67afd` | T15.1 / JAC-124 | `Daemon.start()` strict steps 1-3: load config, open storage, construct + attach broker |
| `ccbeab6` | T15.2 / JAC-125 | Enable pending mode for all IM-routable approval methods after broker attach |
| `e7b7dc7` | T15.3 / JAC-126 | Construct SecurityPolicy, SessionRouter, and Supervisor after pending-mode setup |
| `608cb5c` | T15.4 / JAC-127 | Create adapter and subscribe pending/action/message wires before adapter start |
| `db86a9e` | T15.5 / JAC-128 | Best-effort partial-start cleanup: unsubscribe wires, stop adapter/supervisor, close storage |
| `97e1b00` | T15.6 / JAC-129 | Start adapter only after action subscription; immediate action callback reachable |
| `202df6d` | T15.7 / JAC-130 | Prove message subscription is registered before adapter start |
| `82c1967` | T15.8 / JAC-131 | Inject SIGTERM/SIGINT handlers before adapter start; adapter start remains last |
| `404f71c` | docs checkpoint | Refresh live-status for JAC-39 completion |
| `cca958a` | T16.1 / JAC-40 | Policy-denied approvals resolve through `ApprovalBroker.resolve()` as system-actor decline |
| `5906541` | T16.2 / JAC-41 | Allowed approvals issue hash-only callback token rows before any remote send |
| `2145c57` | T16.3 / JAC-42 | `bindActorPolicy` lands after token issue and before any remote send |
| `ed1f7fb` | T16.4 / JAC-43 | Rendered approval card actions receive per-action D41 `wirePayload = "v1:" + rawToken` |
| `a2df6bb` | docs checkpoint | Refresh live-status for JAC-43 completion |
| `602e68f` | T16.5-T16.7 / JAC-44 | Send card, attach returned `MessageRef` to token rows, and preserve issued rows on send failure |
| `4e6dd62` | docs checkpoint | Refresh live-status for JAC-44 completion |
| `a448ecc` | T17.1 / JAC-45 | Decode `rawCallbackData`, look up callback token records, and fail closed for invalid statuses |

## 3. Versions / pins

- **Root `package.json` `version`:** `0.1.0-phase2` — **correct as-is**. Per plan §19 item 28, version bumps to `0.1.0-phase3-draft` at Phase 3 tag time, NOT during implementation.
- **`codexIm.codexVersion`:** `0.128.0`
- **`CODEX_VERSION` file:** `0.128.0`
- **Local `codex --version`:** `codex-cli 0.128.0`
- **`pnpm protocol:check`:** green (three-way version gate aligned)

## 4. Test count + gate matrix (at HEAD)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | green (11 packages strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess) |
| Test typecheck | `pnpm typecheck:tests` | green |
| Tests | `pnpm test` | **829 passing + 1 skipped** across 76 test files (Phase 2 close: 720; +109 from Phase 3 storage/config/core/channel/daemon prereqs) |
| Lint | `pnpm lint` | green (173 files, biome) |
| Protocol gate | `pnpm protocol:check` | green (codex 0.128.0; 234 schema files canonical) |
| D27 storage boundary | `packages/storage-sqlite/test/no-upward-imports.test.ts` | 8 packages forbidden, type-only included, `import|export ... from` predicate, multi-line aware |
| F13 channel-core boundary | inherited from Phase 2 | green |
| Method-literal boundary | `packages/core/test/no-method-literals.test.ts` | green (storage-sqlite confined; only `approval-broker.ts` + `approval-request-kind.ts` may hold method literals) |

## 5. Codex outside-voice review status

- **Phase 3 plan v2.4:** APPROVE_WITH_CHANGES at codex round 4 (4 P1 + 2 P2, all absorbed). Plan-of-record under `docs/superpowers/plans/2026-05-02-phase-3-plan.md`. Round-by-round records under `docs/phase-3/plan-v{1,2.1,2.2,2.3}-codex-{review,round2,round3,round4}.md`.
- **Implementation T1.1+T2a+T2b+T2c review (impl-t1-t2c):** APPROVE_WITH_CHANGES, 0 P0 + 1 P1 + 2 P2. All findings cleared by commit `04a92fe`. Per-task scope verdict: clean across all 4 commits. Record at `docs/phase-3/impl-t1-t2c-codex-review.md`.
- **Next planned codex review:** after the daemon approval callback flow (T16/T17) lands, or at the T19 daemon mid-review gate before real Telegram adapter work. Cadence is at-discretion, not per-task.

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
3. Read `docs/superpowers/plans/2026-05-02-phase-3-plan.md` §16.5 Daemon wire-up and §17 dependency graph. The next task is **JAC-46 / T17.2**.
4. Run `git status --short` + `git log --oneline -10` to confirm branch state matches §2 above.
5. Run `pnpm test` + `pnpm typecheck` to confirm gates green.
6. Output a Context Recovery Report. In autonomous-loop sessions, continue only if the recovered state is clean and the next Linear issue is unambiguous; otherwise consult GPT Pro rather than asking the operator for technical direction.

## 10. Handoff to Codex (2026-05-02)

Active developer at this checkpoint: previous session was Claude Code; subsequent T-task implementation is being handed to Codex CLI. **No work in flight.** No uncommitted code. Origin synced.

For the Codex agent picking this up:

1. **Verify clean state:**
   - Historical expectation at `f493360`: `git status --short --untracked-files=all` showed only `.claude/scheduled_tasks.lock`, `AGENTS.md`, and six `*.stderr` review logs. Current expectation: `AGENTS.md` is tracked by the autonomous-loop runbook commit; only `.claude/scheduled_tasks.lock` + review `*.stderr` files should remain untracked.
   - Historical checkpoint: `git log --oneline -1` showed `f493360 docs(phase3): handoff checkpoint — bump live-status to f4e1b69 + add §10 codex handoff section`. Current HEAD is documented in §2.
   - Use `git rev-list --left-right --count origin/phase-3-implementation...HEAD` to verify local-vs-origin sync.
2. **Verify gates green at the checkpoint:**
   - Historical JAC-39 checkpoint: `pnpm test` → 76 files, 816 pass + 1 skip. Current gate count is in §4.
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
   3. `docs/superpowers/plans/2026-05-02-phase-3-plan.md` §16.5 (T16.1 body) + §17 (dep graph) + §6 (Phase 3 redlines) + §7 (decisions D22+).
   4. `packages/daemon/src/daemon.ts` (current implementation surface).
   5. `packages/daemon/test/daemon.test.ts` (current daemon wire-up test pattern).
5. **Cadence expectations carried forward from prior sessions:**
   - One T-task per commit. Don't bundle T16.1 + T16.2 + T16.3 into one commit.
   - Run all 5 gates (typecheck / typecheck:tests / test / lint / protocol:check) before each commit.
   - Current autonomous-loop directive: keep one focused issue per commit, update Linear/docs, push regularly, and continue through technical decisions without waiting for routine human approval. Escalate only for actions the tooling cannot perform safely.
   - Codex outside-voice impl review cadence is at-discretion, not per-task. Past pattern: review after a coherent batch (e.g. T1.1 → T2c was reviewed together). Next good review gate is after T16/T17 approval callback flow or at the T19 daemon mid-review gate.
   - When the user says "做一次 codex review", produce a prompt under `docs/phase-3/impl-<scope>-codex-review-prompt.md`, invoke `cat <prompt> | codex exec --sandbox read-only -c model_reasoning_effort=xhigh > <output>.md 2> <output>.stderr` in the background.
   - Don't bump `package.json` `version`. Plan §19 item 28 ties `0.1.0-phase3-draft` to Phase 3 tag time.
   - Don't run repo-wide format. Per-file `pnpm format` after edits is fine; biome auto-formats minor whitespace differences.

This section is the historical Claude-to-Codex handoff. The next live task has advanced through **JAC-45 / T17.1**. Continue with **JAC-46 / T17.2**, then the rest of **JAC-20** dependency order.

# Codex outside-voice integrated re-review — Phase 1 tag gate

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check --sandbox read-only` with the user-authored review prompt piped via stdin (`/tmp/phase1-tag-gate-rereview-prompt.txt`).

**Diff under review:** `814550d..a484014` (4 commits = full tag-gate fix arc).

| # | Commit | Step |
|---|--------|------|
| 1 | `0232dc1` | Step 1 docs-first — method-literal policy in CLAUDE.md, plan tag-gate §, handoff M4 wording, M3 Phase 2 risk recording |
| 2 | `9096cca` | Step 2 Blocker 2 — Supervisor `#spawnFresh` cleanup on failed generations + 4 tests |
| 3 | `6059644` | Step 3 Blocker 1 — `smoke-real-turn.ts` refactored to CodexRuntime + ApprovalBroker; new ClientRequest grep guard |
| 4 | `a484014` | Step 4 M4 + L5 — README quickstart + `package.json` version + CLI clientVersion bumps + handoff sync |

**Date:** 2026-05-01.

**Mode:** integrated re-review on the full fix arc (NOT a per-commit review). Pre-fix integrated review at `814550d` returned NO-GO with 2 blockers + M4 + L5; the tag is gated on this re-review returning GO or GO_WITH_LOW_NITS.

---

## Verdict

> **GO_WITH_LOW_NITS**
>
> P0 Blockers: None — Blocker 1 and Blocker 2 substantively fixed.
> P1 Required Fixes: None.
> Low-severity nits: 2 docs-only.
> Optional missing tests: 1 (`runtimeFactory`-throws cleanup; not required because existing `#spawnFresh` try/catch already covers it).

---

## Remaining blockers

None. Blocker 1 (method-literal boundary) and Blocker 2 (Supervisor spawn-failure cleanup) are substantively fixed.

## Required fixes before tag

None.

## Low-severity nits only

1. `README.md` top summary still says test count `73 → 315`, while quickstart and live-status say `320`. Stale handoff metadata, not a runtime blocker.
2. `docs/internal/handoffs/2026-05-01-phase1-to-phase2.md` snapshot also still references `315`. Same stale-metadata category as nit #1.

Both nits are docs-only and clearly mechanical. Per user-defined `GO_WITH_LOW_NITS` flow: apply inline as `fix(phase1): tag-gate review nits`, run full gates, then re-confirm before tagging. Do not introduce new features or modify Supervisor / ApprovalBroker / AppServerClient / CodexRuntime wrappers in this fixup.

## Optional tests that may be added before tag

- One targeted `runtimeFactory`-throws cleanup test in `packages/daemon/test/supervisor.test.ts`. Codex notes the implementation already handles it through the same `#spawnFresh` try/catch wrap, so this is a defensive belt-and-suspenders test, not a tag blocker.

## Whether `phase-1-runtime-complete` can be created

Yes, after the two doc nits are fixed and final gates pass in a writable environment.

## Final gate commands to run before tagging

```bash
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm test:cli-smoke
pnpm lint
pnpm protocol:check
pnpm exec tsx scripts/verify-phase1-fixtures.mts
bash scripts/ci-check.sh
CODEX_SMOKE=1 pnpm smoke:app-server
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn
CODEX_REAL_SMOKE=1 pnpm runtime:send -- --prompt 'Reply OK'
```

The last 3 (env-gated real smokes) are operator-judgement: each consumes a real codex turn (~$0.01) and requires `codex login` + quota; recommend running at least `CODEX_SMOKE=1 pnpm smoke:app-server` (no model call) before tagging.

## Reviewer-verified gate state (read-only sandbox)

Codex independently verified inside the sandbox:

- `pnpm typecheck` — pass.
- `pnpm typecheck:tests` — pass.
- `pnpm lint` — pass.
- `pnpm check:codex-version` — `OK: 0.125.0`.
- T4.5 fixture gate via `node --import tsx scripts/verify-phase1-fixtures.mts` — pass.

Vitest full reruns and `protocol:check` were blocked by the read-only sandbox's `/tmp` write restriction, not by repo failures. Implementation report (320 passing / 31 files / all 8 ci-check gates green) is therefore credible from the partial independent verification.

## Regression check (no scope creep, fail-closed posture preserved)

Codex confirmed:

- No real IM adapters added.
- No Computer Use production flow introduced.
- No public WebSocket / public HTTP listener added.
- No Codex CLI/TUI wrapper introduced.
- No terminal output parsing as product protocol.
- No approval method names guessed or hard-coded.
- `AppServerClient` not changed in this fix arc (Pre-3 work pre-existed).
- Unknown App Server events still surface as `unknown` rich events (not silently dropped).
- Approval / security paths remain fail-closed.

## M3 / M4 / L5 disposition

- **M3** (runtime-send vs Supervisor integration) — recorded as Phase 2 risk in `docs/internal/handoffs/2026-05-01-phase1-to-phase2.md`. Not hidden, not a tag blocker. ✅
- **M4** (Phase 2 hooks overstated) — handoff softened to say `ApprovalBroker.resolve()` remains a throwing stub; Phase 2 likely needs additional broker public surface for IM rendering and user-decision mapping. ✅
- **L5** (README/package metadata staleness) — partially fixed (quickstart + version bumps + clientVersion bumps); residual nits in this report (README top summary + handoff snapshot test counts).

---

## What this re-review does NOT cover

- Future operator-judgement smokes (`CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` etc.). Codex confirmed they are still gated and safe by construction.
- The Phase 2 plan / Telegram MVP scope. That is a fresh review at the start of Phase 2.
- Any Pre-4 / `AppServerClient` idempotency work. Recorded as future-defensive backlog in `TODOS.md` at Phase 1 close-out, not part of the tag-gate fix arc.

## Tag-gate disposition

Tag `phase-1-runtime-complete` is **eligible** to be applied AFTER:

1. Both doc nits land as `fix(phase1): tag-gate review nits`.
2. Full local gate matrix re-runs green at the post-nit HEAD (typecheck / typecheck:tests / test / test:cli-smoke / lint / protocol:check / verify-phase1-fixtures / ci-check).
3. User explicit approval to tag (per session-defined Phase 1 staged-execution discipline).

No further Codex review is required for the doc-only nits (per user-defined `GO_WITH_LOW_NITS` flow: docs/metadata/mechanical fixes do not require re-review; only code changes do).

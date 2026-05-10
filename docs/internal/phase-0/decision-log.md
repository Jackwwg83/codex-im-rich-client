# Phase 0 Decision Log

This is the canonical record of decisions made during Phase 0. Mirrors
the header in `docs/internal/superpowers/plans/2026-04-29-phase-0-bootstrap.md` plus
runtime adjustments made during execution.

## Plan-stage decisions (D1–D4)

| ID | Decision | Resolution | Commits |
|----|----------|-----------|---------|
| **D1** | `performInitializeHandshake` module placement | Extracted to `packages/app-server-client/src/handshake.ts` from Phase 0 — shared by smokes + Phase 1 `CodexRuntime` | `2d4b149` |
| **D2** | `InMemoryTransport` package location | `packages/testkit` (NOT `app-server-client` — production package shouldn't ship test scaffolding) | `78fc803` |
| **D3** | Codex CLI outside-voice review on Phase 0 plan | Ran 2026-04-29 on plan v2; 10 findings, 9 adopted | (incorporated into plan v2; later Section B review applied separately) |
| **D4** | Phase 0 smoke includes real harmless turn | Yes, gated by `CODEX_REAL_SMOKE=1`. Runs under `sandbox=read-only` + `approval_policy=on-request` + client default-rejects all server requests + fixed harmless prompt + no output assertion | `72d328f` (impl), `fa05a5e` (verified end-to-end PASS) |

## Empirical decisions made during execution

### `--experimental` flag (Section A Task 0.2) — REVERSED to STABLE

**Plan preliminary stance**: default to `--experimental` because Computer Use / approval / rich events were assumed to be experimental-only.

**Empirical reality**: diff between stable and experimental shows experimental adds only realtime voice, fuzzy-session lifecycle, memory mode, elicitation counters, background terminals, collaboration mode, and a `mock` method — **all out of Phase 0–6 scope**. Everything Phase 0–6 actually needs (initialize, thread/turn lifecycle, command exec, approvals, MCP, auth, Tool generic, ServerNotification) is in stable. Computer Use is a runtime `Tool` instance, not a type-level distinction; `--experimental` does NOT add a ComputerUse type.

**Decision**: stable, no `--experimental`. See `docs/internal/phase-0/codex-gen-diff.md` for full evidence and "Switching to --experimental later" recipe (Phase 7+).

**Commits**: `dacbb29` (decision + plan amendments), `c1a1a08` (`protocol:generate` script wired without flag), `67d7928` (committed generated artifacts).

### `vitest@^2` → `vitest@^4` (Section B Task 1.3) — UPGRADED

**Plan**: `vitest@^2`.

**Reality**: vitest 2.x's `test.projects` API is vitest 3+ syntax. Vitest 4.1.5 is the current LTS line; the plan was written before 4 was released.

**Decision**: bump to `vitest@^4`, also explicitly add `vite@^6` to satisfy vitest 4's peer dep, and enable `passWithNoTests: true` so empty workspace exits 0 during incremental development.

**Commit**: `34119a0`.

### `@types/node@^22` → `@types/node@^20` (Section B Codex review) — DOWNGRADED

**Plan**: `@types/node@^22`.

**Codex review #6 finding**: types should align with `engines.node>=20.10.0`. Using Node 22 type APIs in code that engines say should run on Node 20 invites runtime breakage on real Node 20 deployments.

**Decision**: downgrade `@types/node` to `^20` (resolved 20.19.39).

**Commit**: `719a859`.

## Codex outside-voice findings — disposition table

10 findings raised on the plan; 9 adopted, 1 (P0 init-only insufficient) resolved by D4 with safety rails.

| # | Sev | Subject | Status | Where addressed |
|---|-----|---------|--------|-----------------|
| 1 | P0 | Init-only smoke insufficient | ✅ Adopted with rails (D4: A) | Section J Tasks 9.3/9.4 |
| 2 | P1 | Version pin + upgrade gate | ✅ Adopted (custom `codexIm.codexVersion` field, NOT `engines.codex`) | Section B Task 1.5 |
| 3 | P1 | `--experimental` flag decision | ✅ REVERSED to STABLE (empirical) | Section A Task 0.2 |
| 4 | P1 | Wire spike underspecified | ✅ Adopted, 5 cases run, 7 fixtures committed | Section A Tasks 0.3 + 0.4 |
| 5 | P1 | Default-reject server request | ✅ Adopted, 4 paths covered (no-handler / throw / timeout / multiple) | Section F Task 5.6 |
| 6 | P1 | `StdioTransportOptions` shape | ✅ Adopted full signature with `configOverrides` translation | Section G Task 6.1 |
| 7 | P1 | Handshake returns `InitializeResponse` | ✅ Adopted (typed result, not `void`) | Section H Task 7.1 |
| 8 | P2 | Don't hardcode approval method names | ✅ Adopted — Phase 0 production code has zero approval string literals (Task 10.3 audit confirms) | enforced repo-wide |
| 9 | P2 | Wire fixtures in repo | ✅ Adopted, 7 fixtures + metadata + replayFixture | Sections A.0.4 + I.8.4 |
| 10 | P3 | `tsx` in tech stack | ✅ Adopted | Section B Task 1.3 |

## Codex final review (end-of-Phase-0) — disposition

See `docs/internal/phase-0/codex-review.md` for full findings. Summary:

- **0 P0** — no hard-rule violations (no CLI parsing, no public exposure, no implicit Computer Use, etc.)
- **4 P1** — all fixed in commit `1c81023` (request leak on send throw, missing onError sub, server-request timer leak, loose JSON-RPC guards) with 10 regression tests added
- **4 P2** — deferred to Phase 1 (typed protocol bindings, ApprovalBroker dispatcher, async event stream, restart lifecycle)
- **3 P3** — noted (roadmap wording overlap, fixture note staleness, FakeAppServer.emitServerRequest needs own timeout)

**Verdict**: CLEARED FOR TAG.

## Tagging

After this commit, the branch will be tagged `phase0-bootstrap-complete`.

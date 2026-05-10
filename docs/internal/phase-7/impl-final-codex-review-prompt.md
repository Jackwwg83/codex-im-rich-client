# Phase 7 Final Implementation Codex Review Prompt

You are an outside-voice reviewer for Phase 7 of Codex IM Rich Client. Review
the implementation slice from `phase-6-computer-use-complete` through current
HEAD on branch `codex/phase-7-planning`.

## Source Of Truth

- Project rules: `AGENTS.md`, `CLAUDE.md`
- Phase 7 plan: `docs/internal/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`
- Phase 7 live status: `docs/internal/handoffs/phase7-live-status.md`
- Phase 6 -> Phase 7 handoff: `docs/internal/handoffs/2026-05-03-phase6-to-phase7.md`
- Capability matrix: `docs/internal/phase-7/capability-matrix.md`
- Feasibility spikes:
  - `docs/internal/phase-7/satori-koishi-feasibility.md`
  - `docs/internal/phase-7/chat-sdk-feasibility.md`

## Review Scope

Commits after `phase-6-computer-use-complete`:

- `ce1e5f5` JAC-164 Phase 7 plan gate
- `f0febb0` JAC-104 capability matrix
- `51eadbe` JAC-102 Satori/Koishi feasibility
- `04e4362` JAC-103 Chat SDK feasibility
- `8739a24` JAC-105 fallback renderer
- `9f84c3e` JAC-106 read-only web status surface
- `b5516bb` JAC-109 team/operator policy
- `ef478f0` JAC-107 web approval decision gate
- `7cb58ef` JAC-108 policy-bound session handoff

Important implementation files:

- `packages/render/src/plain-text.ts`
- `packages/render/test/plain-text-capability-matrix.test.ts`
- `packages/daemon/src/status.ts`
- `packages/daemon/src/web-approval.ts`
- `packages/daemon/test/web-status.test.ts`
- `packages/daemon/test/web-approval.test.ts`
- `packages/core/src/team-operator-policy.ts`
- `packages/core/src/session-handoff.ts`
- `packages/core/test/team-operator-policy.test.ts`
- `packages/core/test/session-handoff.test.ts`
- `packages/core/src/index.ts`
- `packages/daemon/src/index.ts`

## Current Gate Evidence

At `7cb58ef`:

- `pnpm exec vitest run packages/core/test/session-handoff.test.ts` — green, 4 passed
- `pnpm exec vitest run packages/core/test/session-handoff.test.ts packages/core/test/session-router.test.ts packages/core/test/team-operator-policy.test.ts` — green, 19 passed
- `pnpm --filter @codex-im/core typecheck` — green
- `pnpm typecheck` — green, 14 of 15 workspace projects
- `pnpm typecheck:tests` — green
- `pnpm test` — green, 136 files, 1237 passing, 1 skipped
- `pnpm lint` — green, 308 files checked
- `pnpm protocol:check` — green, Codex 0.128.0, 234 schema files canonical

## Redlines To Check

- Native Codex App Server IM rich client boundary remains intact.
- No OpenClaw plugin.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No public listener, including web console.
- No approval bypass or first-actor-wins.
- No raw callback token persistence or display.
- Fallback renderer must not expose raw approval ids, callback tokens, or
  actionable text commands in low-capability channels.
- Web status must be loopback-only/read-only, expose no secrets, and start no
  listener.
- Web approval decisions must go through `ApprovalBroker.resolve()` only after
  `TeamOperatorPolicy` allows the actor and messageRef/target proof validates.
- Multi-channel handoff must fail unless `TeamOperatorPolicy` permits source and
  destination target transition; writes must go through `SessionRouter.bind()`.
- Satori/Koishi and Chat SDK remain spike-only; no runtime adapter/network or
  credential auto-detection.
- No live external calls, no Computer Use provider work, no secret leakage.

## Output

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped as P0/P1/P2/P3 with file/line references.
3. Required fixes before Phase 7 tag gate, if any.
4. Whether JAC-165 may proceed to handoff/version/tag.

# Phase 7 Live Status

> Single source of truth for Phase 7 while extended platform / web-console
> planning and implementation are active.
> **Last updated:** 2026-05-03 - JAC-109 team/operator policy model
> implemented; JAC-107 web-console approval UI is next.

---

## 1. Current State

- **Phase:** Phase 7 - extended platforms and web console.
- **Plan:** `docs/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`.
- **Parent Linear issue:** JAC-12 - Phase 7+ backlog / extended platforms and
  web console.
- **Current Linear issue:** JAC-107 - web console approval UI.
- **Branch:** `codex/phase-7-planning`.
- **Base tag:** `phase-6-computer-use-complete`.
- **Version:** `0.1.0-phase6`; do not bump until Phase 7 tag gate.
- **Next exact action:** implement the first web-console approval UI slice as a
  policy-gated projection only. It must consume `TeamOperatorPolicy`, expose no
  direct storage mutation, and must not call `ApprovalBroker.resolve()` unless
  the plan-reviewed messageRef/target proof is present.

## 2. Current Decision State

- Capability matrix comes before fallback renderer or adapter implementation.
- Satori/Koishi is a compatibility-layer candidate, not a native adapter
  replacement.
- Vercel Chat SDK is an adapter-layer candidate, not the Codex core.
- Lower-capability approval rendering now produces non-actionable text with no
  raw approval ids, callback tokens, or slash-command decision hints.
- Web status now has a pure loopback-only, read-only status surface in
  `@codex-im/daemon`; it renders no mutation controls, exposes no secrets, and
  starts no listener.
- Team/operator authorization now exists as a pure `@codex-im/core`
  `TeamOperatorPolicy`; viewer/operator/admin/auditor roles are still scoped by
  configured project and target lists.
- Web console starts as docs or loopback-only read-only status; public listener
  and approval UI require separate reviewed issues.
- Team/operator policy must exist before shared approval UI can resolve actions.
- Lower-capability channels fail closed or render non-actionable fallback when
  approval safety cannot be proven.

## 3. Active Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No public App Server listener.
- No public web-console listener by default.
- No approval bypass or first-actor-wins.
- No raw callback token persistence or display.
- No adapter import of broker/runtime/client/storage/daemon/render/protocol.
- No live external platform calls in planning/spike tasks.
- No real Computer Use provider work in Phase 7.
- Unknown, unauthorized, ambiguous, low-capability, or security-uncertain paths
  fail closed or degrade to non-actionable text.

## 4. Review Status

| Review | Status |
|---|---|
| Phase 7 plan v1 Codex review | APPROVE_WITH_CHANGES: P1 ordering, loopback, fallback fixes required |
| Phase 7 plan v1.1 Codex closure review | GO_WITH_LOW_NITS: P0/P1/P2 clear; JAC-104 may start |
| JAC-104 capability matrix Codex review | GO_WITH_LOW_NITS: P0/P1/P2 clear; JAC-102 may start |

## 5. Linear Execution Queue

| Issue | Scope | Status |
|---|---|---|
| JAC-164 | plan review gate | complete; closure review recorded |
| JAC-104 | capability matrix | complete; review recorded |
| JAC-102 | Satori/Koishi feasibility spike | complete; verdict `spike-only` |
| JAC-103 | Vercel Chat SDK feasibility spike | complete; verdict `spike-only` |
| JAC-105 | fallback renderer | complete; non-actionable approval fallback implemented in render |
| JAC-106 | web console read-only status | complete; pure loopback-only/read-only status view implemented |
| JAC-109 | team/operator model | complete; pure role/project/target policy exported from core |
| JAC-107 | web console approval UI | current; gated by team/operator policy |
| JAC-108 | multi-channel session handoff | pending, gated by team/operator policy |

## 6. Gate Status

Latest JAC-109 code gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run packages/core/test/team-operator-policy.test.ts` | green: 6 passed |
| `pnpm exec vitest run packages/core/test/security-policy.test.ts packages/core/test/team-operator-policy.test.ts` | green: 24 passed |
| `pnpm --filter @codex-im/core typecheck` | green |
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 134 files, 1230 passing, 1 skipped |
| `pnpm lint` | green: 304 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |

Previous JAC-106 code gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run packages/daemon/test/web-status.test.ts` | green: 11 passed |
| `pnpm exec vitest run packages/daemon/test/status.test.ts packages/daemon/test/web-status.test.ts` | green: 12 passed |
| `pnpm --filter @codex-im/daemon typecheck` | green |
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 133 files, 1224 passing, 1 skipped |
| `pnpm lint` | green: 302 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |

Previous JAC-105 code gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run packages/render/test/plain-text-capability-matrix.test.ts` | green: 12 passed |
| `pnpm --filter @codex-im/render typecheck` | green |
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 132 files, 1213 passing, 1 skipped |
| `pnpm lint` | green: 301 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |

Previous JAC-103 docs-only gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 301 files checked |
| `git diff --check` | green |

Previous JAC-102 docs-only gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 301 files checked |
| `git diff --check` | green |

Previous JAC-104 docs-only gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 301 files checked |
| `git diff --check` | green |

Previous JAC-164 docs-only gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 301 files checked |
| `git diff --check` | green |

Latest pre-Phase-7 baseline from Phase 6 tag gate:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 132 files, 1212 passing, 1 skipped |
| `pnpm lint` | green: 301 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |
| `pnpm smoke:computer-use-live` | green default skip |

## 7. Compact / Resume

If resuming during Phase 7:

1. Read this file first.
2. Read the Phase 7 plan under `docs/superpowers/plans/`.
3. Read `docs/handoffs/2026-05-03-phase6-to-phase7.md`.
4. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
5. Run `git status --short` and `git log --oneline -8`.
6. Continue from the current Linear issue when recovered state is clearly safe;
   use GPT Pro/Codex outside-voice for technical ambiguity.

# Phase 7 Live Status

> Single source of truth for Phase 7 extended platforms and web console.
> **Last updated:** 2026-05-03 - Phase 7 complete; release tag
> `phase-7-extended-platforms-web-console-complete` ready to push at this
> closeout state.

---

## 1. Current State

- **Phase:** Phase 7 - extended platforms and web console.
- **Plan:** `docs/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`.
- **Parent Linear issue:** JAC-12 - Phase 7+ backlog / extended platforms and
  web console.
- **Final Linear issue:** JAC-165 - Phase 7 review, handoff, and tag gate.
- **Branch:** `codex/phase-7-planning`.
- **Base tag:** `phase-6-computer-use-complete`.
- **Release tag:** `phase-7-extended-platforms-web-console-complete`.
- **Version:** `0.1.0-phase7`.
- **HEAD:** closeout commit `chore(release): JAC-165 close phase 7 tag gate`.
- **Next exact action:** Phase 7 is frozen. Future work should start from a
  new reviewed phase plan and Linear parent/children before implementation.

## 2. Shipped Behavior

- Capability matrix records native and candidate channel surfaces, including
  `implementable`, `spike-only`, `docs-only`, and `blocked` verdicts.
- Satori/Koishi remains `spike-only`; no `im-satori` package, live server,
  credentials, WebSocket, webhook, or listener shipped in Phase 7.
- Vercel Chat SDK remains `spike-only`; it may inform future adapter-layer
  research but does not replace Codex core/runtime semantics.
- Lower-capability approval rendering now produces non-actionable text with no
  raw approval ids, callback tokens, or slash-command decision hints.
- Web status has a pure loopback-only, read-only status surface in
  `@codex-im/daemon`; it starts no listener, renders no mutation controls, and
  uses the core redactor for fatal-message snapshots/status HTML.
- Team/operator authorization exists as pure `@codex-im/core`
  `TeamOperatorPolicy` with viewer/operator/admin/auditor roles scoped by
  configured project and target lists, including audit access.
- Web approval decision helper requires a server-side bound approval proof
  before calling an injected `ApprovalBroker.resolve()` surface.
- Multi-channel handoff has a pure core helper that copies an existing bound
  session to a destination target only after source and destination
  `TeamOperatorPolicy` checks pass, and writes only through
  `SessionRouter.bind()`.

## 3. Carry-Forward Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No public App Server listener.
- No public web-console listener by default.
- No approval bypass or first-actor-wins.
- No raw callback token persistence, display, docs, logs, or Linear leakage.
- No raw approval id or callback token in low-capability fallback text.
- IM adapters do not call broker/runtime/client/storage/daemon/render/protocol
  directly.
- Candidate platform spikes do not instantiate clients, probe credentials, open
  WebSocket/HTTP connections, or start listeners.
- No real Computer Use provider work in Phase 7.
- Unknown, unauthorized, ambiguous, low-capability, or security-uncertain paths
  fail closed or degrade to non-actionable text.

## 4. Review Status

| Review | Status |
|---|---|
| Phase 7 plan v1 Codex review | APPROVE_WITH_CHANGES: P1 ordering, loopback, fallback fixes required |
| Phase 7 plan v1.1 Codex closure review | GO_WITH_LOW_NITS: P0/P1/P2 clear; JAC-104 may start |
| JAC-104 capability matrix Codex review | GO_WITH_LOW_NITS: P0/P1/P2 clear; JAC-102 may start |
| Phase 7 final implementation review | APPROVE_WITH_CHANGES: 1 P1 + 2 P2 + 1 P3 |
| JAC-165 final review follow-up | GO_WITH_LOW_NITS: prior P1/P2/P3 closed; no new P0/P1 |

Review reports:

- `docs/phase-7/impl-final-codex-review.md`
- `docs/phase-7/impl-final-codex-review-followup.md`

## 5. Linear Execution Queue

| Issue | Scope | Status |
|---|---|---|
| JAC-164 | plan review gate | complete |
| JAC-104 | capability matrix | complete |
| JAC-102 | Satori/Koishi feasibility spike | complete |
| JAC-103 | Vercel Chat SDK feasibility spike | complete |
| JAC-105 | fallback renderer | complete |
| JAC-106 | web console read-only status | complete |
| JAC-109 | team/operator model | complete |
| JAC-107 | web console approval decision gate | complete |
| JAC-108 | multi-channel session handoff | complete |
| JAC-165 | review, handoff, tag gate | complete |

## 6. Gate Status

Latest Phase 7 tag-gate candidate gates for the closeout state:

| Gate | Result |
|---|---|
| `pnpm vitest run --project unit packages/daemon/test/web-status.test.ts packages/daemon/test/web-approval.test.ts packages/core/test/team-operator-policy.test.ts` | green: 3 files, 20 passing |
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 136 files, 1237 passing, 1 skipped |
| `pnpm lint` | green: 308 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |
| `git diff --check phase-6-computer-use-complete` | green |

`protocol:check` must run serially because it regenerates protocol files before
diffing.

## 7. Compact / Resume

If resuming after Phase 7:

1. Read this file first.
2. Read the Phase 7 plan under `docs/superpowers/plans/`.
3. Read `docs/handoffs/2026-05-03-phase7-to-future.md`.
4. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
5. Run `git status --short` and `git log --oneline -8`.
6. Start any future phase from a reviewed plan and Linear issue split before
   implementation.

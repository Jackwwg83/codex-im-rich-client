# Phase 7 Plan v1.1 Codex Closure Review Prompt

You are the outside-voice reviewer for Phase 7 of Codex IM Rich Client.

Review scope:

- `docs/internal/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`
- `docs/internal/handoffs/phase7-live-status.md`
- `06-IM-ADAPTERS.md`
- `docs/internal/phase-7/plan-v1-codex-review.md`

Context:

- Phase 6 is complete at tag `phase-6-computer-use-complete`.
- Current branch is `codex/phase-7-planning`.
- Current Linear issue is JAC-164, the Phase 7 plan review gate.
- Phase 7 must not regress the native Codex App Server IM rich client boundary.

The previous review returned APPROVE_WITH_CHANGES with P1 findings:

1. Web approval and multi-channel handoff sequencing must put JAC-109
   team/operator policy before JAC-107 or JAC-108 implementation.
2. Web read-only status must test loopback-only binding and forbid public
   listener defaults.
3. Fallback renderer safety must forbid raw approval ids and actionable
   `/approve <id>` text commands unless a separately reviewed secure command
   path exists.

It also had P2/P3 hardening:

1. T2/T3 spikes should forbid credential/env auto-detection and adapter/network
   instantiation.
2. JAC-104 capability matrix should include a `Phase 7 verdict` column.
3. T0 exit wording should require recording the closure review/result.

Please review whether these findings are closed and whether JAC-104 may start.

Output:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Remaining P0/P1/P2/P3 findings.
3. Required fixes before JAC-104, if any.
4. Whether JAC-104 may start.

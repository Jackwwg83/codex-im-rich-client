# Phase 6 Plan v1 Codex Review Prompt

You are an outside-voice reviewer for the Codex IM Rich Client repo.

Review scope:

- Base tag: `phase-5-dingtalk-adapter-complete`
- Current branch: `codex/phase-6-computer-use`
- Current plan: `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`
- Live status: `docs/handoffs/phase6-live-status.md`
- Capability evidence: `docs/phase-6/computer-use-capability-evidence.md`
- Linear parent: JAC-11
- Current issue: JAC-91

Source-of-truth docs:

- `AGENTS.md`
- `docs/automation/codex-app-autonomous-loop-runbook.md`
- `docs/handoffs/2026-05-02-phase5-to-phase6.md`
- `07-SECURITY-AND-COMPUTER-USE.md`
- `18-HOOKS-AND-GUARDRAILS.md`
- `11-TESTING-AND-QA.md`
- generated protocol under `packages/codex-protocol/src/generated/**`

Please review the Phase 6 Computer Use plan for architecture, security, and
implementation sequencing.

Key plan intent:

- Only explicit `/cu` or `/computer-use` may create Computer Use intent.
- Normal prompts must not create Computer Use context.
- `item/tool/call` is denied unless tied to an active scoped `/cu` session for
  the same target/thread/turn/actor.
- Denied apps fail closed before approval.
- Sensitive steps require explicit approval and do not support allow-session.
- Real desktop provider implementation is blocked until capability evidence is
  collected and reviewed; fake/unsupported providers are allowed first.

Questions:

1. Does the two-gate design close the prompt-injection path where a normal
   prompt causes a dynamic tool call?
2. Is `item/tool/call` the right boundary for Computer Use based on generated
   protocol, or does the plan need a stronger capability spike before JAC-92?
3. Is `ComputerUseSessionRegistry` appropriately placed in daemon/provider
   boundary, or should more live in core?
4. Are denied apps policy-denied before approval and sensitive steps ask-always
   correct?
5. Are JAC-92, JAC-93, JAC-94, JAC-95, JAC-96, JAC-163, JAC-97, JAC-98,
   JAC-99, JAC-100, and JAC-101 sequenced safely?

Required output:

1. Verdict: `GO`, `GO_WITH_LOW_NITS`, `APPROVE_WITH_CHANGES`, or `REJECT`.
2. P0/P1/P2 findings, if any.
3. Required plan changes before implementation.
4. Whether JAC-92 may start after those changes.


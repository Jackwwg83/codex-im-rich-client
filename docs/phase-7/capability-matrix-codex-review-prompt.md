# Phase 7 Capability Matrix Codex Review Prompt

You are the outside-voice reviewer for JAC-104 of Codex IM Rich Client.

Review scope:

- `docs/phase-7/capability-matrix.md`
- `docs/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`
- `docs/handoffs/phase7-live-status.md`
- `06-IM-ADAPTERS.md`
- `packages/channel-core/src/adapter.ts`
- `packages/channel-core/src/types.ts`
- `packages/channel-core/src/capabilities.ts`
- `packages/im-telegram/src/capabilities.ts`
- `packages/im-lark/src/capabilities.ts`
- `packages/im-dingtalk/src/capabilities.ts`

Context:

- JAC-164 plan gate passed with v1.1 closure review `GO_WITH_LOW_NITS`.
- JAC-104 is docs-only. It must not authorize runtime changes.
- The matrix must decide which Phase 7 child issues are `implementable`,
  `spike-only`, `docs-only`, or `blocked`.

Check:

1. Does the matrix accurately reflect the shipped adapter capabilities and the
   closed `ChannelAdapter` interface?
2. Does it preserve the Phase 7 redlines: no public listener, no generic chat
   core substitution, no approval bypass, no raw callback/approval id fallback,
   no live external calls, no credential auto-detection?
3. Are the child issue verdicts safe enough for the loop to continue into
   JAC-102 and JAC-103?

Output:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Remaining P0/P1/P2/P3 findings.
3. Required fixes before committing JAC-104, if any.
4. Whether JAC-102 may start after JAC-104 commits.

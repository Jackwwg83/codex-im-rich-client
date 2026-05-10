# Phase 7 Plan v1 Codex Review Prompt

Review scope:

- Plan: `docs/internal/superpowers/plans/2026-05-03-phase-7-extended-platforms-web-console-plan.md`
- Live status: `docs/internal/handoffs/phase7-live-status.md`
- Phase 6 handoff: `docs/internal/handoffs/2026-05-03-phase6-to-phase7.md`
- Adapter design: `06-IM-ADAPTERS.md`
- Security: `07-SECURITY-AND-COMPUTER-USE.md`
- Loop runbook: `docs/internal/automation/codex-app-autonomous-loop-runbook.md`

You are an outside-voice reviewer for Phase 7 of Codex IM Rich Client.
Review the draft plan for architecture drift, unsafe sequencing, missing
redlines, and whether implementation may start after plan fixes.

## Mission

Phase 7 should extend the product toward long-tail platforms and web-console
surfaces while preserving the native Codex App Server rich-client architecture:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

The plan currently proposes capability matrix first, then Satori/Koishi and
Vercel Chat SDK feasibility spikes, then gated fallback renderer, local
read-only web status, team/operator model, web approval UI, and multi-channel
handoff.

## Must-Check Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public App Server listener.
- No public web-console listener by default.
- No approval bypass or first-actor-wins.
- No raw callback token persistence or display.
- Future adapters must stay behind `ChannelAdapter`.
- Satori/Koishi and Chat SDK must not replace native Telegram/Lark/DingTalk or
  core/runtime state.
- Web approval UI must not resolve approvals before policy-bound actor/target
  validation exists.
- Multi-channel handoff must be explicit and policy-bound.
- Live external platform calls and real Computer Use provider work remain out of
  scope for Phase 7 planning/spikes.

## Questions

1. Is the plan safe to approve as the Phase 7 implementation source of truth?
2. Should fallback renderer and local read-only web status be allowed in Phase 7,
   or should Phase 7 remain docs/spike-only?
3. Are Satori/Koishi and Chat SDK correctly scoped as adapter-layer feasibility
   work?
4. Is the web-console sequencing safe enough, especially read-only before
   approval UI and team/operator policy before shared approval resolution?
5. Are any P0/P1/P2 findings missing from the plan before JAC-104 may start?

## Output Format

Return Markdown with:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped by P0/P1/P2/P3 with file references.
3. Required plan fixes before implementation, if any.
4. Whether JAC-104 may start after those fixes.

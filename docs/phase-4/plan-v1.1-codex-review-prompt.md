# Phase 4 Lark Plan v1.1 Codex Review Prompt

You are an outside-voice reviewer for the Codex IM Rich Client repository.

Run in read-only mode. Do not modify files. Do not run network commands (`npm view`, `curl`, web search, package installs). Review only the local repo documents below and the cited source summary already captured in the plan/decision record.

Review:

- `docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`
- `docs/phase-4/lark-action-transport-decision.md`

Required context:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/handoffs/2026-05-02-phase3-to-phase4.md`
- `docs/handoffs/phase3-live-status.md`
- `06-IM-ADAPTERS.md`
- `07-SECURITY-AND-COMPUTER-USE.md`

Review focus:

1. Does the plan preserve the native Codex App Server rich-client architecture?
2. Does it correctly avoid public App Server exposure, CLI/TUI parsing, OpenClaw, and premature Computer Use?
3. Is the `card.action.trigger` long-connection decision strong enough before `im-lark` implementation?
4. Are package boundaries for `@codex-im/im-lark` correct?
5. Are task slices small enough for Linear/Codex autonomous execution?
6. Are there missing P0/P1 constraints for Lark secrets, callback payloads, messageRef validation, action ack, and approval flow?

Return:

- Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT
- P0 blockers
- P1 required fixes
- P2 nits
- Whether JAC-65 may close after fixes
- Whether implementation may begin after this plan review

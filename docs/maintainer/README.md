# Maintainer Documentation

These documents are retained for open-source transparency, development history,
review evidence, release readiness, and live acceptance proof. They are not the
first-use customer onboarding path.

User-facing docs start at [../user/README.md](../user/README.md).

## Original Design Notes

The numbered design documents (`01-PRD.md` through `18-HOOKS-AND-GUARDRAILS.md`)
that used to live at the repository root were moved under
[`../internal/design/`](../internal/design/). The agent guidance file
`AGENTS.md` and the backlog `TODOS.md` moved to
[`../internal/`](../internal/). Open-source release made repository-root
internal notes confusing; the user-facing layout is now `README.md`,
`SECURITY.md`, `LICENSE`, and `docs/user/`.

## Evidence And Handoffs

- [Phase and live-status handoffs](../internal/handoffs/)
- [Release readiness status](../internal/handoffs/release-readiness-live-status.md)
- [Live IM acceptance status](../internal/handoffs/live-im-acceptance-status.md)
- [Direct-use live status](../internal/handoffs/direct-use-live-status.md)

## Plans And Reviews

- [Superpowers plans](../internal/superpowers/plans/)
- [Phase 0 evidence](../internal/phase-0/)
- [Phase 1 reviews](../internal/phase-1/)
- [Phase 2 reviews](../internal/phase-2/)
- [Phase 3 reviews](../internal/phase-3/)
- [Phase 4 reviews](../internal/phase-4/)
- [Phase 5 reviews](../internal/phase-5/)
- [Phase 6 reviews](../internal/phase-6/)
- [Phase 7 reviews](../internal/phase-7/)
- [Release-readiness review evidence](../internal/release-readiness/)

## Maintainer Runbooks

- [Launch scope](../ops/launch-scope.md)
- [Production launch runbook](../ops/production-launch.md)
- [Release readiness preflight](../ops/release-readiness.md)
- [Live IM acceptance runbook](../internal/ops-smoke/live-im-acceptance.md)
- [Computer Use, Telegram, Lark, DingTalk, Slack smoke runbooks](../internal/ops-smoke/)
- [Autonomous loop runbook](../internal/automation/codex-app-autonomous-loop-runbook.md)

## Maintainer Rules

- Do not paste real token, chat id, user id, message id, app id, Keychain output,
  cookie, or raw private payload values into docs, Linear, GitHub, or review
  packets.
- Keep live smoke commands explicit and gated.
- Do not present smoke or phase-gate docs as customer quickstart docs.
- Do not claim binary installers, hosted SaaS onboarding, cloud token storage,
  Docker production, Linux production, or Windows production until those paths
  exist and are accepted.
- Keep capability claims bounded, especially for Slack and Computer Use.

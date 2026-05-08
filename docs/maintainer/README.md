# Maintainer Documentation

These documents are retained for open-source transparency, development history,
review evidence, release readiness, and live acceptance proof. They are not the
first-use customer onboarding path.

User-facing docs start at [../user/README.md](../user/README.md).

## Evidence And Handoffs

- [Phase and live-status handoffs](../handoffs/)
- [Release readiness status](../handoffs/release-readiness-live-status.md)
- [Live IM acceptance status](../handoffs/live-im-acceptance-status.md)
- [Direct-use live status](../handoffs/direct-use-live-status.md)

## Plans And Reviews

- [Superpowers plans](../superpowers/plans/)
- [Phase 0 evidence](../phase-0/)
- [Phase 1 reviews](../phase-1/)
- [Phase 2 reviews](../phase-2/)
- [Phase 3 reviews](../phase-3/)
- [Phase 4 reviews](../phase-4/)
- [Phase 5 reviews](../phase-5/)
- [Phase 6 reviews](../phase-6/)
- [Phase 7 reviews](../phase-7/)
- [Release-readiness review evidence](../release-readiness/)

## Maintainer Runbooks

- [Launch scope](../ops/launch-scope.md)
- [Production launch runbook](../ops/production-launch.md)
- [Release readiness preflight](../ops/release-readiness.md)
- [Live IM acceptance runbook](../ops/live-im-acceptance.md)
- [Telegram/Lark/DingTalk/Slack/Computer Use smoke runbooks](../ops/)
- [Autonomous loop runbook](../automation/codex-app-autonomous-loop-runbook.md)

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

# Operations And Acceptance Runbooks

These files are maintainer/operator runbooks and acceptance evidence. They are
not the first-use customer documentation path.

For user setup and daily use, start at [../user/README.md](../user/README.md).

Use this directory when you are maintaining the project, validating a release,
running live smoke gates, operating launchd, or collecting redacted acceptance
evidence.

Important boundaries:

- live smoke commands must remain explicit and gated;
- token and secret values must stay out of docs, logs, SQLite, plist, GitHub,
  Linear, and review packets;
- Computer Use acceptance is bounded and must not be described as arbitrary
  desktop automation;
- platform-specific acceptance evidence does not expand the common product
  boundary without a reviewed plan.

Key docs:

- [Launch scope](launch-scope.md)
- [Production launch runbook](production-launch.md)
- [Release readiness preflight](release-readiness.md)
- [Live IM acceptance](../internal/ops-smoke/live-im-acceptance.md)
- [Slack live smoke](../internal/ops-smoke/slack-live-smoke.md)
- [Lark live smoke](../internal/ops-smoke/lark-live-smoke.md)
- [DingTalk live smoke](../internal/ops-smoke/dingtalk-live-smoke.md)
- [Computer Use smoke](../internal/ops-smoke/computer-use-smoke.md)
- [Keychain + launchd smoke](../internal/ops-smoke/keychain-launchd-smoke.md)
- [Install upgrade runbook](install-upgrade-runbook.md)

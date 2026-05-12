# Codex-IM User Documentation

This directory is the user-facing entry point for Codex IM Rich Client.

Use these docs when you want to install and run Codex-IM on your own Mac. The
older phase, review, handoff, and smoke-test documents remain in the repository
for maintainer evidence, but they are not the normal setup path.

Current install mode is source-based local install: you clone the repo and run a
single local installer command. You do not need to modify the code.

## Read In This Order

1. [Quick start](quickstart.md) - run `pnpm codex-im:install` and send the
   first IM message. You can pass `--platform telegram` for non-interactive
   Telegram setup.
2. [Customer alpha checklist](customer-alpha-checklist.md) - the same flow
   in checklist form; use this when you are testing as a customer.
3. [Platform setup fields](platform-setup.md) - what to collect from Telegram,
   Feishu/Lark, DingTalk, or Slack before running setup.
4. [IM commands](commands.md) - how to use Codex from IM after the daemon is
   running.
5. [Admin guide](admin-guide.md) - local config, Keychain, launchd, logs,
   backups, upgrades, and uninstall.
6. [Troubleshooting](troubleshooting.md) - diagnose common setup and runtime
   failures.
7. [Bug-report template](customer-bug-report-template.md) - copy this when
   filing a GitHub issue.

## Current Product Boundary

- Codex-IM runs locally on macOS.
- IM credentials stay in macOS Keychain.
- Codex App Server stays local and must not be exposed publicly.
- Start with one IM platform, not all platforms at once.
- Computer Use requires explicit `/cu`; ordinary prompts cannot trigger it.
- Current Computer Use support is bounded local Chrome behavior, not arbitrary
  desktop automation.

## For Maintainers

Development plans, phase handoffs, live acceptance evidence, and smoke runbooks
are indexed at [../maintainer/README.md](../maintainer/README.md).

# Codex IM Rich Client

> ⚠️ **Early Access (alpha)** — security hardening in progress. Not for production deployments.

Codex IM Rich Client lets you use Codex App from IM. A local daemon runs on
your Mac, connects to Codex App Server, and projects Codex-native threads,
turns, approvals, files, diffs, status, and bounded Computer Use events into
Telegram, Feishu/Lark, DingTalk, or Slack.

This is not a generic chatbot, not an OpenClaw plugin, and not a Codex CLI/TUI
screen parser. The runtime path stays:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

## Current Support

> **"Live-accepted" means in this alpha:** smoke-tested on the maintainer's
> personal Mac with one IM tenant per platform. Customer setup requires you
> to register your own bot/app per platform (see the per-platform sections
> in [docs/user/platform-setup.md](docs/user/platform-setup.md)). Expect
> alpha-grade breakage; please file bugs using
> [docs/user/customer-bug-report-template.md](docs/user/customer-bug-report-template.md).

| Area | Status |
|---|---|
| Telegram | Primary personal entry. Text, approvals, files/images, and direct Codex use are live-accepted. See [platform-setup.md#telegram](docs/user/platform-setup.md#telegram). |
| Feishu/Lark | Primary team entry. Text, cards/approvals, files/images, and direct Codex use are live-accepted. See [platform-setup.md#feishu--lark](docs/user/platform-setup.md#feishu--lark). |
| DingTalk | Compatibility entry. Text, CardKit approvals, files/images, and direct Codex use are live-accepted. See [platform-setup.md#dingtalk](docs/user/platform-setup.md#dingtalk). |
| Slack | Bounded workspace support. Socket Mode, slash command, approvals, files, and exact-output UX are live-accepted for the tested workspace path. See [platform-setup.md#slack](docs/user/platform-setup.md#slack). |
| Computer Use | Explicit `/cu` only. Current accepted scope is bounded local macOS Chrome provider behavior, not arbitrary desktop automation. |

## Installation Mode

Current public setup is a source-based local install. You do not need to modify
the code, but this release installs from a local checkout so it can build the
daemon bundle, generate local config, store IM secrets in macOS Keychain, and
install the current-user launchd service.

Supported scope:

- officially supported production target: macOS local daemon;
- secrets live in macOS Keychain;
- background service uses launchd under the current macOS user;
- Node.js `>=24` and pnpm `>=10 <11` are required;
- Codex generated protocol is pinned by `CODEX_VERSION`; user installs run a
  schema-based runtime compatibility check so newer compatible Codex CLIs do
  not fail solely because their version number differs;
- Linux and Windows are not production deployment targets for this release.

There is no hosted SaaS credential store, no binary installer, and no automated
IM-platform app provisioning in this version.

## Quick Start

Start with one platform.

```bash
git clone https://github.com/Jackwwg83/codex-im-rich-client.git
cd codex-im-rich-client
pnpm install
pnpm codex-im:install
```

Then open the configured IM chat and send:

```text
/projects
/use 1
Reply exactly: OK
```

For the full user path, read [docs/user/README.md](docs/user/README.md).

The install command asks which first platform to configure, then remains a
transparent wrapper around the safety boundaries: Codex version check,
`setup:im`, `im:doctor`, bridge build/install, and launchd install/status.
To run those steps manually, follow
[docs/user/quickstart.md](docs/user/quickstart.md).

## User Documentation

- [Quick start](docs/user/quickstart.md)
- [Customer alpha checklist](docs/user/customer-alpha-checklist.md) — one-page first-time flow
- [Platform setup fields](docs/user/platform-setup.md)
- [IM commands](docs/user/commands.md)
- [Admin guide](docs/user/admin-guide.md)
- [Troubleshooting](docs/user/troubleshooting.md)
- [Bug-report template](docs/user/customer-bug-report-template.md)

## Security Model

- IM credentials stay local in macOS Keychain.
- `config.toml` stores non-secret settings only.
- Codex App Server is local; do not expose it publicly.
- Every IM actor and chat must be allowlisted.
- Approval buttons/cards are the primary approval path.
- `/approve` is only a fallback for already-bound pending approvals.
- Computer Use cannot be triggered by ordinary prompt text; it requires `/cu`.
- The daemon redacts tokens, private payloads, and sensitive tool arguments.

## Maintainer Documentation

The repository keeps detailed development history, phase plans, review reports,
live acceptance evidence, and smoke-test runbooks for open-source transparency.
Those documents are useful for maintainers, but they are not the first-use
customer path.

Start here:

- [Maintainer documentation index](docs/maintainer/README.md)
- [Launch scope](docs/ops/launch-scope.md)
- [Production launch runbook](docs/ops/production-launch.md)
- [Release readiness preflight](docs/ops/release-readiness.md)

Common maintainer checks:

```bash
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm lint
pnpm protocol:check
pnpm release:check
```

Live smoke commands are explicit maintainer gates. They are not part of the
default quick start.

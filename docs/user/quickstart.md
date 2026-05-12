# Quick Start

This guide takes a fresh source checkout to one working IM bot/app.

## 1. Requirements

Supported production target for this release:

- macOS user account that will own the daemon;
- Node.js `>=24`;
- pnpm `>=10 <11`;
- local Codex App / `codex` CLI installed and logged in;
- one IM bot/app credential set.

Linux and Windows are not production deployment targets for this release. The
project may contain portable TypeScript packages, but the supported always-on
bridge uses macOS Keychain and launchd.

## 2. Source-Based Local Install

You do not need to modify the code. The current release installs from a local
checkout so the installer can build the daemon bundle, write local config, store
IM secrets in macOS Keychain, and install the current-user launchd service.

```bash
git clone <repo-url>
cd codex-im-rich-client
pnpm install
```

Normal users do not need to run test, lint, protocol-generation, or release
checks. Those are contributor and maintainer checks.

## 3. Create One IM Bot Or App

Pick one platform first. Do not configure every platform during first setup.

Collect the fields listed in [platform-setup.md](platform-setup.md). Keep token
and secret values local. Do not paste them into GitHub issues, docs, Linear,
chat transcripts, screenshots, or review packets.

## 4. Run Install

Run the local installer for your platform:

```bash
pnpm codex-im:install
```

The default installer asks which platform to configure first. If you already
know the platform, pass it explicitly:

```bash
pnpm codex-im:install --platform lark
pnpm codex-im:install --platform dingtalk
pnpm codex-im:install --platform slack
```

The install command:

- checks Node, pnpm, and the pinned Codex version;
- writes `~/.codex-im-bridge/config.toml`;
- backs up an existing config before replacing it;
- writes IM secrets to macOS Keychain;
- stores only non-secret settings in config;
- runs `pnpm im:doctor`;
- builds and installs the local daemon bundle;
- installs and checks the current-user launchd service.

During setup, choose the local project directory you actually want to control
from IM. The default prompt value is your shell's current directory; if you run
setup from inside `codex-im-rich-client`, change it to your application repo
unless you are deliberately testing this bridge project. The generated config
uses normal IM output by default so customer chats do not show internal status,
token usage, skill-loading commands, or command-log attachments.

## 5. Manual Install Steps

If you want to see each boundary separately, run the expanded sequence:

```bash
pnpm check:codex-version
pnpm setup:im --platform telegram
pnpm im:doctor
pnpm bridge:build
pnpm bridge:install
pnpm launchd:install
pnpm launchd:status
```

## 6. Check Readiness

```bash
pnpm codex-im:status
```

`codex-im:status` is local-only by default. To check whether a newer tagged
release is available, run:

```bash
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
```

> Alpha caveat: a real `pnpm codex-im:upgrade --apply` (without `--dry-run`)
> is not yet implemented in this release; it is rejected with an explanatory
> error. The three commands above are the supported upgrade-related
> operations today. `pnpm codex-im:rollback` is similarly rejected; to roll
> back, check out the previous tag and re-run `pnpm codex-im:install`.

You can also preview the install without making changes:

```bash
pnpm codex-im:install --platform telegram --dry-run
```

`im:doctor` does not send live IM traffic by default. It checks local config,
Keychain secret presence, allowlists, platform capability flags, and installed
bridge status.

Proceed only when the platform you configured reports `ready`.

Expected result:

- launchd target is loaded;
- daemon status is present;
- `pendingApprovals=0` before your first test;
- no token or secret value appears in command output.

## 7. Send The First Message

Open the configured IM chat and send:

```text
/projects
/use 1
Reply exactly: OK
```

You should receive an exact `OK` response. `/projects` shows the configured
Codex projects without exposing local paths; choose by number. To create a
fresh conversation and start immediately, you can also send
`/new 1 Reply exactly: OK`.

`/new <task>` creates a new conversation and immediately sends `<task>` as the
first prompt. Use `/new --title <title>` only when you want an empty titled
conversation without starting a turn.

Project selection is optional. Sending `Reply exactly: OK` or
`/new Reply exactly: OK` before `/use` creates a Codex default conversation
using the App Server's native default context. Normal IM output does not show
the local cwd path.

After that, try a normal development request such as asking Codex to inspect the
current repo status.

## 8. Next Steps

After your first turn works, try these IM commands:

- `/rename <title>` — rename the current thread (synced to Codex when supported).
- `/archive` and `/unarchive` — manage thread lifecycle.
- `/fork [--exclude-turns]` — fork the current thread; opt in to a
  metadata-only fork with the flag.
- `/status` — see binding, pending approvals, and Codex remote-control status.

Then:

- Learn the full command list in [commands.md](commands.md).
- Learn local operations in [admin-guide.md](admin-guide.md).
- Diagnose failures in [troubleshooting.md](troubleshooting.md).

For first-time customer testing, the
[customer alpha checklist](customer-alpha-checklist.md) walks the full
pre-install / install / first-message path on one page.

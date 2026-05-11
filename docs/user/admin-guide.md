# Admin Guide

This guide covers local administration after the first setup.

## Local Paths

| Path | Purpose |
|---|---|
| `~/.codex-im-bridge/config.toml` | Non-secret local config. |
| `~/.codex-im-bridge/app/` | Installed daemon bundle. |
| `~/.codex-im-bridge/logs/` | Local daemon logs. |
| `~/.codex-im-bridge/state.db` | Local SQLite state. |
| `~/Library/LaunchAgents/io.codex-im-bridge.plist` | Current user's launchd agent. |

Do not put IM token values in config, plist, docs, logs, SQLite, GitHub, Linear,
or review packets.

## Project Paths In `config.toml`

Each `[projects.<name>]` entry has two filesystem fields:

- `cwd` — the working directory the daemon hands to Codex when this
  project is the active session. The daemon resolves this with
  `fs.realpath` at config load time. If the path does not exist, is
  not a directory, or symlinks somewhere unreachable, the daemon
  refuses to start with `CodexImConfigPathError`. Fix the path in
  `config.toml` and reload.
- `writable_roots` — every entry must be an existing directory; the
  daemon refuses to start otherwise. **Currently treated as metadata
  only**: the daemon validates these paths exist but does not yet
  forward them to Codex via `additionalWritableRoot` permission
  modifications. Use them to document intent for now; sandbox
  enforcement on Codex's side is tracked for a later release.

If you need a writable scope outside `cwd` enforced today, configure
that on Codex's side directly (per-codex `~/.codex/config.toml`
sandbox configuration) — the IM bridge does not override it.

## Install Modes

| Mode | Status |
|---|---|
| Source-based local install | Supported user path for this release. |
| Combined local installer | `pnpm codex-im:install --platform <platform>`. |
| Manual local steps | Supported for debugging: `setup:im`, `im:doctor`, bridge install, launchd install. |
| Homebrew, npm global CLI, prebuilt binary | Future packaging options only; not currently supported. |
| Docker production, cloud-hosted daemon, public Codex App Server listener | Not supported. |

## Keychain Services

| Platform | Keychain service |
|---|---|
| Telegram | `codex-im-bridge` |
| Feishu/Lark | `codex-im-bridge-lark` |
| DingTalk | `codex-im-bridge-dingtalk` |
| Slack bot token | `codex-im-bridge-slack-bot` |
| Slack app-level token | `codex-im-bridge-slack-app` |

Prefer `pnpm setup:im --platform <platform>` to write these values. If you use
`security add-generic-password` manually, do it in a local shell and never paste
real values into docs or issue trackers.

## Readiness

```bash
pnpm codex-im:status
```

`im:doctor` reports local readiness without sending live IM traffic by default.
It names missing config, secret, allowlist, or installed-bridge problems.

## Start Or Restart

```bash
pnpm codex-im:install --platform telegram
```

For manual rebuild/restart:

```bash
pnpm bridge:build
pnpm bridge:install
pnpm launchd:install
launchctl kickstart -k gui/$(id -u)/io.codex-im-bridge
pnpm launchd:status
```

Use `kickstart` after rebuilding the daemon bundle or changing runtime config.

## Logs

```bash
tail -n 120 ~/.codex-im-bridge/logs/daemon.log
tail -n 120 ~/.codex-im-bridge/logs/daemon.err.log
```

Logs should show secret presence only as redacted values and lengths. Treat any
token-shaped output as a stop condition.

## Backup

```bash
pnpm db:backup
```

Back up before risky local changes, upgrades, or platform reconfiguration.

## Upgrade From Source

```bash
git pull
pnpm install
pnpm check:codex-version
pnpm im:doctor
pnpm bridge:build
pnpm bridge:install
launchctl kickstart -k gui/$(id -u)/io.codex-im-bridge
pnpm launchd:status
```

If `CODEX_VERSION` changed, upgrade Codex first and let maintainers review
protocol-generation changes before using the new runtime.

## Uninstall Local Daemon

```bash
pnpm codex-im:uninstall
```

This removes the local bridge install path and LaunchAgent. It does not need to
delete your repository checkout. Delete Keychain services only when you intend
to remove saved IM credentials.

## Rollback Is Not Yet Wired

In this alpha, `pnpm codex-im:rollback` is rejected with an explanatory
error. The combined upgrade-and-restart flow under `codex-im:upgrade --apply`
is also not yet implemented (a real `--apply` without `--dry-run` is
rejected). To roll back today:

```bash
git checkout v0.1.0-alpha.3   # or whichever previous tag
pnpm install
pnpm codex-im:install --platform <your-platform>
```

This re-runs the local installer against the older tag. Your config and
Keychain entries are preserved across the reinstall.

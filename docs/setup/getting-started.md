# Codex-IM Quick Setup

Status: first-use setup guide for the local Mac bridge.

Codex-IM runs on your Mac. IM bot tokens and app secrets stay in macOS
Keychain; `config.toml` stores only non-secret settings such as enabled
platforms, allowlists, project entries, and environment-variable names.

Start with one platform. Do not configure all platforms at once.

## 1. Prepare

Install the local baseline:

```bash
node --version
pnpm --version
codex --version
pnpm install
```

Expected Codex pin: `0.128.0`.

Normal users do not need to run `pnpm test`, `pnpm lint`, `pnpm typecheck`, or
`pnpm protocol:check`. Those commands are for contributors and maintainers.

## 2. Create One IM Bot Or App

Create the bot/app in the IM platform's own console. Codex-IM does not create
remote IM apps for you and does not store tokens in a cloud service.

Collect only the fields for the platform you will enable first:

| Platform | Fields to collect |
|---|---|
| Telegram | bot token, your Telegram user id, chat or group id |
| Feishu/Lark | app id, app secret, domain (`feishu` or `lark`), allowed user id, allowed chat id |
| DingTalk | client id/app key, client secret, card template id, allowed user id, allowed chat id |
| Slack | bot token (`xoxb-...`), app-level token (`xapp-...`), Socket Mode enabled, allowed user id, allowed channel or DM id |

## 3. Install

Run the combined local installer:

```bash
pnpm codex-im:install
```

The default installer prompts for one platform. For non-interactive setup, pass
the platform explicitly:

```bash
pnpm codex-im:install --platform telegram
pnpm codex-im:install --platform lark
pnpm codex-im:install --platform dingtalk
pnpm codex-im:install --platform slack
```

The installer runs the setup wizard, writes `~/.codex-im-bridge/config.toml`,
backs up an existing config to `config.toml.bak-YYYYMMDD-HHMMSS`, writes
secrets to macOS Keychain, checks readiness, builds and installs the daemon
bundle, then installs and checks launchd.

Use `pnpm codex-im:install --platform telegram --dry-run` to preview the command
sequence without writing files, Keychain entries, bridge artifacts, or launchd.

## 4. Why There Are Several Steps

The combined installer keeps these safety boundaries visible:

- `pnpm install` installs local JavaScript and native dependencies.
- `setup:im` writes config and Keychain secrets.
- `im:doctor` checks config, Keychain, allowlists, and installed bridge state
  without live IM traffic.
- `bridge:build` and `bridge:install` create the daemon runtime bundle.
- `launchd:install` makes the daemon a current-user background service.

If you need to run the boundaries manually:

```bash
pnpm check:codex-version
pnpm setup:im --platform telegram
pnpm im:doctor
pnpm bridge:build
pnpm bridge:install
pnpm launchd:install
pnpm launchd:status
```

`setup:im` by itself configures IM credentials and prints next commands; it does
not install launchd by itself.

## 5. Check

Run:

```bash
pnpm codex-im:status
```

Status does not contact the network by default. Use these commands when you
want to check for a newer tagged release or preview the upgrade path:

```bash
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
```

> Note: `--apply` without `--dry-run` (i.e. a real upgrade-and-restart flow)
> is not yet implemented and is planned for a later release. The three
> commands above (`--check` for a remote-version probe, `--plan` for a local
> readiness summary, and `--apply --dry-run` for a no-op preview of the
> apply steps) are the supported upgrade-related operations today.

If a secret is missing, the doctor prints a repair command and points back to
the setup wizard. The repair command uses a placeholder such as
`<SLACK_APP_TOKEN>`; replace it locally and do not paste real tokens into git,
docs, Linear, or GPT/Codex review packets.

For launch scope, rollback, and release checks, use
`docs/ops/production-launch.md`.

## 6. First Message

In the configured IM chat:

```text
/projects
/use 1
Reply exactly: OK
```

You can also skip `/use` for the first test. A normal message or
`/new Reply exactly: OK` creates a Codex default conversation through App
Server native `thread/start({})`; the daemon stores the returned cwd locally
without printing the path in normal IM output.

If approvals appear, use the IM approval card first. `/approve <id> <action>` is
only a fallback for already-bound pending approvals.

## 7. Troubleshooting

- `pnpm im:doctor` is the first diagnostic command.
- Keep tokens in Keychain, not in `config.toml`, plist, logs, docs, SQLite, or
  Linear.
- Live IM smoke commands are explicit gates; default commands do not send live
  network traffic.
- Computer Use requires explicit `/cu` and is bounded to the launch scope in
  `docs/ops/launch-scope.md`.

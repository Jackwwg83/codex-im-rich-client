# Codex-IM Quick Setup

Status: first-use setup guide for the local Mac mini bridge.

Codex-IM runs on your Mac. IM bot tokens and app secrets stay in macOS
Keychain; `config.toml` stores only non-secret settings such as enabled
platforms, allowlists, project paths, and environment-variable names.

Start with one platform. Do not configure all platforms at once.

## 1. Prepare

Install the local baseline:

```bash
node --version
pnpm --version
codex --version
pnpm install
pnpm check:codex-version
```

Expected Codex pin: `0.128.0`.

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

## 3. Run Setup

Run:

```bash
pnpm setup:im
```

For a preselected platform:

```bash
pnpm setup:im --platform telegram
pnpm setup:im --platform lark
pnpm setup:im --platform dingtalk
pnpm setup:im --platform slack
```

The wizard writes `~/.codex-im-bridge/config.toml`, backs up an existing config
to `config.toml.bak-YYYYMMDD-HHMMSS`, writes secrets to macOS Keychain, then
runs `pnpm im:doctor`.

Use `--dry-run` to preview without writing files or Keychain entries. Use
`--print-template` to print the generated config template only.

## 4. Check

Run:

```bash
pnpm im:doctor
```

If a secret is missing, the doctor prints a repair command and points back to
the setup wizard. The repair command uses a placeholder such as
`<SLACK_APP_TOKEN>`; replace it locally and do not paste real tokens into git,
docs, Linear, or GPT/Codex review packets.

## 5. Install And Start

After doctor is ready:

```bash
pnpm bridge:build
pnpm bridge:install
pnpm launchd:install
pnpm launchd:status
```

For launch scope, rollback, and release checks, use
`docs/ops/production-launch.md`.

## 6. First Message

In the configured IM chat:

```text
/use codex-im
Reply exactly: OK
```

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

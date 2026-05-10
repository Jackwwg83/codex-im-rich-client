# Slack Live Smoke

This runbook is for JAC-248 real Slack workspace acceptance.

Slack is a Codex App IM surface. It must stay inside the existing
`ChannelAdapter` boundary and use Socket Mode; do not expose a public Request
URL for the default path.

## 1. Slack App

Create or open a test Slack app in the target development workspace.

Required app settings:

- Socket Mode: enabled.
- App-level token: one token with `connections:write`; store the value as
  `SLACK_APP_TOKEN` in the operator shell or Keychain service
  `codex-im-bridge-slack-app`.
- Bot token scopes:
  - `chat:write`
  - `files:read`
  - `files:write`
  - `commands`
  - `app_mentions:read`
  - `im:history`
  - `channels:history` only if testing channel mentions.
- Event subscriptions:
  - `message.im`
  - `app_mention`
- Interactivity: enabled for button callbacks.
- Slash command: `/codex`.
- Install the app into the test workspace and invite the bot to any target
  test channel.

Never paste Slack token bytes into docs, Linear, logs, fixtures, SQLite, plist,
or screenshots.

## 2. Local Config

Enable Slack in `~/.codex-im-bridge/config.toml` only after the app is ready:

```toml
[adapters.slack]
enabled = true
bot_token_env = "SLACK_BOT_TOKEN"
app_token_env = "SLACK_APP_TOKEN"
allowed_channel_ids = ["T_TEST:C_TEST"]
```

Add matching allowlist entries using redacted real ids:

```toml
[security]
allowed_users = ["slack:T_TEST:U_TEST"]
allowed_chats = ["slack:T_TEST:C_TEST"]

[projects.codex-im]
allowed_users = ["slack:T_TEST:U_TEST"]
allowed_chats = ["slack:T_TEST:C_TEST"]
```

Prefer Keychain for launchd:

```bash
security add-generic-password -U -s codex-im-bridge-slack-bot -a "$USER" -w "$SLACK_BOT_TOKEN"
security add-generic-password -U -s codex-im-bridge-slack-app -a "$USER" -w "$SLACK_APP_TOKEN"
```

Do not run those commands with placeholder values. Do not echo token values.

## 3. Local Readiness

Default readiness is no-live-network:

```bash
pnpm im:doctor
```

Slack must report `ready` before live acceptance. If it reports `disabled`,
config has not enabled Slack. If it reports `blocked`, fix the named secret
source or allowlist gap.

Reinstall the current daemon bundle after changing config or wrapper behavior:

```bash
pnpm bridge:build
pnpm bridge:install
launchctl kickstart -k gui/501/io.codex-im-bridge
pnpm launchd:status
```

Expected local status:

- launchd loaded and running.
- `pendingApprovals=0` before the test starts.
- Slack secret resolution appears only as redacted env-var presence and length.

## 4. Live Gates

Each live gate must print redacted evidence only.

Auth and env presence:

```bash
SLACK_LIVE=1 SLACK_LIVE_DRY_RUN=1 pnpm smoke:slack-live
SLACK_LIVE=1 pnpm smoke:slack-live
```

Outbound text:

```bash
SLACK_LIVE=1 SLACK_LIVE_TEXT=1 SLACK_TARGET_CHANNEL_ID=C_TEST pnpm smoke:slack-live
```

Outbound file:

```bash
SLACK_LIVE=1 SLACK_LIVE_FILE=1 SLACK_TARGET_CHANNEL_ID=C_TEST pnpm smoke:slack-live
```

JAC-248 is not complete until these additional real-client paths also pass:

- Real Slack DM or app mention reaches the launchd daemon and creates/uses a
  Codex binding.
- `/codex status`, `/codex projects`, and `/codex use codex-im` route through
  the same daemon command path as other IMs.
- A harmless prompt returns a Codex reply into Slack.
- A harmless uploaded image/file reaches the daemon as a local
  `InboundAttachment` without leaking the Slack private file URL or token.
- A real approval card click reaches the daemon as a Socket Mode interactive
  event and passes callback-token plus `messageRef` validation.
- The terminal approval card removes buttons or otherwise makes the decision
  visibly final.

## 5. Completion Evidence

Record only:

- command names;
- pass/fail;
- redacted token presence;
- redacted message id presence;
- launchd pid and `pendingApprovals`;
- Linear issue ids and commit shas.

Do not record raw workspace ids, channel ids, user ids, message timestamps,
tokens, cookies, or long raw Slack payloads unless they are explicitly
sanitized.

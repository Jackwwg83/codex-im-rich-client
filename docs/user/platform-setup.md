# Platform Setup Fields

Codex-IM does not create IM apps for you. Create the bot/app in the platform's
own developer console, then run `pnpm codex-im:install --platform <platform>`.
Use `pnpm setup:im --platform <platform>` only when you want to update local
config and Keychain without reinstalling the daemon.

Secrets go to macOS Keychain. `~/.codex-im-bridge/config.toml` stores only
non-secret settings such as app ids, environment-variable names, allowlists,
project entries, and enabled platforms.

## Telegram

Create a bot with BotFather.

Collect:

- bot token;
- your Telegram user id;
- target private chat id or group id.

The setup wizard enables:

```toml
[adapters.telegram]
enabled = true
bot_token_env = "IM_TELEGRAM_BOT_TOKEN"
```

Secret storage:

```text
Keychain service: codex-im-bridge
```

Notes:

- Telegram is the recommended first personal setup.
- If using a group, add the bot to the group and make sure the group chat id is
  allowlisted.

## Feishu / Lark

Create a self-built app in the Feishu/Lark developer console.

Collect:

- app id;
- app secret;
- domain: `feishu` or `lark`;
- allowed user id;
- allowed chat id.

Enable the bot/message capabilities needed by your workspace. For team use,
install or publish the app to the target tenant according to your organization's
normal app process.

The setup wizard enables:

```toml
[adapters.lark]
enabled = true
app_id = "..."
app_secret_env = "IM_LARK_APP_SECRET"
domain = "feishu"
allowed_chat_ids = ["..."]
```

Secret storage:

```text
Keychain service: codex-im-bridge-lark
```

Notes:

- Use `domain = "feishu"` for Feishu tenants and `domain = "lark"` for Lark
  global tenants.
- Keep app secret, tenant tokens, verification tokens, and encrypt keys out of
  docs and issue trackers.

## DingTalk

Create or open a DingTalk app with bot/robot capability.

Collect:

- client id / app key;
- client secret;
- card template id;
- allowed user id;
- allowed chat or conversation id.

The setup wizard enables:

```toml
[adapters.dingtalk]
enabled = true
client_id = "..."
client_secret_env = "DINGTALK_CLIENT_SECRET"
card_template_id = "..."
```

Secret storage:

```text
Keychain service: codex-im-bridge-dingtalk
```

Notes:

- The common setup derives robot code from client id unless you explicitly
  configure a different robot code.
- Card approvals require the DingTalk card capability and a usable card
  template.
- Capture allowlist ids from the real operator/client path. Do not guess staff
  ids or conversation ids.

## Slack

Create a Slack app in the target workspace.

Required settings:

- Socket Mode enabled;
- app-level token with `connections:write`;
- bot token with the scopes required by your workspace path;
- event subscriptions for direct messages or app mentions;
- interactivity enabled for approval button callbacks;
- slash command `/codex`;
- app installed into the workspace;
- bot invited to any target test channel.

Typical bot scopes:

- `chat:write`;
- `files:read`;
- `files:write`;
- `commands`;
- `app_mentions:read`;
- `im:history`;
- `channels:history` if using channel mentions.

Collect:

- bot token, starting with `xoxb-`;
- app-level token, starting with `xapp-`;
- allowed Slack user id;
- allowed channel or DM id.

The setup wizard enables:

```toml
[adapters.slack]
enabled = true
bot_token_env = "SLACK_BOT_TOKEN"
app_token_env = "SLACK_APP_TOKEN"
allowed_channel_ids = ["..."]
```

Secret storage:

```text
Keychain service: codex-im-bridge-slack-bot
Keychain service: codex-im-bridge-slack-app
```

Notes:

- Slack support is bounded to the configured workspace and allowlisted users or
  channels.
- Do not expose a public request URL for the default Socket Mode path.

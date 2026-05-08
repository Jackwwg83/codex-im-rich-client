# Troubleshooting

Start with:

```bash
pnpm codex-im:status
```

Do not paste token, secret, cookie, private URL, raw callback payload, or full
log output into issues or chat. Redact before sharing.

## Install Command Fails

`pnpm codex-im:install --platform <platform>` stops at the first failing
boundary. Re-run status first:

```bash
pnpm codex-im:status
```

Common causes:

- Node.js is older than `24`;
- pnpm is outside `>=10 <11`;
- Codex version does not match `CODEX_VERSION`;
- the platform bot/app fields are incomplete;
- Keychain rejected a secret write;
- launchd cannot load the current-user LaunchAgent.

If you need to isolate the failing boundary, run the manual sequence from
[quickstart.md](quickstart.md#5-manual-install-steps).

## Setup Wrote Config But Daemon Is Not Installed

`pnpm setup:im --platform <platform>` only writes local config, writes Keychain
secrets, and checks readiness. It does not install the daemon by itself.

Finish the local install:

```bash
pnpm codex-im:install --platform <platform>
```

Or run the manual bridge and launchd commands from the quick start.

## `im:doctor` Reports `disabled`

The adapter is not enabled in `~/.codex-im-bridge/config.toml`.

Run setup for the platform:

```bash
pnpm setup:im --platform telegram
```

Replace `telegram` with `lark`, `dingtalk`, or `slack`.

## `im:doctor` Reports Missing Secret

The Keychain entry or environment variable is missing.

Preferred fix:

```bash
pnpm setup:im --platform <platform>
```

The doctor output also prints the exact Keychain service name with a placeholder
value. Replace the placeholder locally only; never commit or paste the real
secret value.

## `im:doctor` Reports Allowlist Failure

Your IM user id or chat/channel id is not allowlisted globally or for the
selected cwd entry.

Re-run setup with the correct ids, or edit `~/.codex-im-bridge/config.toml`
carefully. IDs are platform-scoped, for example:

```text
telegram:<user-or-chat-id>
lark:<user-or-chat-id>
dingtalk:<user-or-chat-id>
slack:<workspace-id>:<user-or-channel-id>
```

## Bot Does Not Reply

Check:

```bash
pnpm codex-im:status
```

Common causes:

- launchd agent is not loaded;
- daemon bundle was rebuilt but launchd was not restarted;
- wrong chat/channel id in allowlist;
- another process is consuming the same long-polling or Socket Mode stream;
- the platform app is not installed into the target workspace or tenant.

After rebuilding or changing config:

```bash
pnpm bridge:build
pnpm bridge:install
launchctl kickstart -k gui/$(id -u)/io.codex-im-bridge
pnpm launchd:status
```

## Approval Button Does Nothing

Check whether the card eventually changes to resolved or expired.

Common causes:

- the platform did not deliver the button callback;
- the approval expired;
- the actor or chat does not match the bound approval policy;
- the card message reference no longer matches the callback token state.

Use `/status` or `/approvals` in IM to inspect pending approvals. Use
`/approve <id> <action>` only as a fallback for already-bound pending approvals.

## Slack Slash Command Does Not Work

Check the Slack app:

- Socket Mode is enabled;
- app-level token exists and starts with `xapp-`;
- bot token exists and starts with `xoxb-`;
- slash command `/codex` is configured;
- interactivity is enabled;
- app is installed into the workspace;
- bot is invited to the target channel when using channel mentions.

Then run:

```bash
pnpm im:doctor
```

## Files Or Images Do Not Arrive

Check platform permissions first. Then check whether the attachment is larger
than the configured inbound cap.

Current default:

```text
daemon.max_inbound_attachment_bytes = 26214400
```

Oversized attachments fail closed and do not start a Codex turn.

## Computer Use Is Blocked

Computer Use requires explicit `/cu`.

```text
/cu status
/cu inspect the local browser page
```

It is blocked when:

- `computer_use.enabled` is false;
- the task did not start with `/cu`;
- the app is denied by policy;
- the task asks for secrets, payment, settings changes, or other sensitive
  actions;
- the requested provider is outside the accepted bounded macOS Chrome scope.

Ordinary prompt text must not trigger Computer Use.

# Slack Core Platform Plan

Generated: 2026-05-07

Linear: JAC-243 parent JAC-242, milestone M5 - Slack core platform.

This is the Slack plan-of-record for making Slack a first-class Codex App IM
surface. It is not a new product abstraction: Slack must conform to the existing
`ChannelAdapter` boundary and preserve Codex App concepts.

## 1. Source of Truth

- Current live status: `docs/handoffs/direct-use-live-status.md`
- Live IM acceptance: `docs/handoffs/live-im-acceptance-status.md`
- Channel boundary: `packages/channel-core/src/{adapter,types,capabilities}.ts`
- Existing adapter references:
  - `packages/im-telegram`
  - `packages/im-lark`
  - `packages/im-dingtalk`
- Slack references:
  - Slack Socket Mode / Bolt JS guide:
    <https://docs.slack.dev/tools/bolt-js/creating-an-app/>
  - Slack Socket Mode Node SDK:
    <https://docs.slack.dev/tools/node-slack-sdk/socket-mode/>
  - Slack app manifest reference:
    <https://docs.slack.dev/reference/app-manifest/>
  - Slack `connections:write` scope:
    <https://docs.slack.dev/reference/scopes/connections.write/>
  - Slack button element:
    <https://docs.slack.dev/reference/block-kit/block-elements/button-element/>
  - Slack `block_actions` payload:
    <https://docs.slack.dev/reference/interaction-payloads/block_actions-payload/>

## 2. Non-Negotiable Redlines

- Do not expose Codex App Server publicly.
- Do not expose a public Slack HTTP Request URL by default.
- Do not parse Codex CLI/TUI output.
- Do not introduce a generic chat abstraction between Slack and CodexRuntime.
- Do not let Slack adapter import `@codex-im/core`, `@codex-im/codex-runtime`,
  `@codex-im/app-server-client`, or `@codex-im/protocol`.
- Do not persist or render Slack bot tokens, app-level tokens, signing secrets,
  cookies, private user ids, private channel ids, raw callback tokens, or raw
  approval payloads.
- Approval decisions still require callback-token lookup, `messageRef`
  validation, `SecurityPolicy`, and `ApprovalBroker.resolve()`.
- Group/channel traffic must pass the common `SecurityPolicy.checkInboundMessage`
  gate before Codex receives ordinary text.

## 3. Transport Decision

Use Slack Socket Mode by default.

Reason:

- The daemon runs on a local Mac mini.
- Socket Mode receives Events API, interactivity, and slash-command payloads
  over a WebSocket initiated by the local daemon.
- This preserves the project redline of no public App Server listener and no
  public IM bridge listener.

Do not implement HTTP Events API in the first Slack slice. If a future workspace
requires HTTP for distribution or enterprise policy, add a separate reviewed
transport plan with request-signature verification and a non-public deployment
story. That must not be hidden inside the Socket Mode adapter.

## 4. Token and Secret Model

Required secrets:

- `SLACK_BOT_TOKEN` style bot token (`xoxb-...`) for Web API calls.
- `SLACK_APP_TOKEN` style app-level token (`xapp-...`) with
  `connections:write` for Socket Mode.

Optional later:

- `SLACK_SIGNING_SECRET` only if an HTTP transport is explicitly added later.

Config must store only env var names. Runtime secret resolution may use env or
Keychain, matching Telegram/Lark/DingTalk. Logs, docs, Linear, smoke output, and
SQLite must record only redacted presence.

## 5. Minimum Manifest

The initial Slack app should be installed into a test workspace with Socket Mode
enabled and no public Request URL.

```yaml
display_information:
  name: Codex IM
features:
  bot_user:
    display_name: codex
    always_online: false
  slash_commands:
    - command: /codex
      description: Control Codex from Slack
      usage_hint: "projects | use <project> | new [title] | prompt..."
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - commands
      - files:read
      - files:write
      - im:history
      - im:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
  org_deploy_enabled: false
  token_rotation_enabled: false
```

Scope notes:

- `connections:write` belongs on the app-level token, not the bot token.
- Do not request `chat:write.public`; the bot should only post where installed
  or where a user explicitly invokes `/codex`.
- Do not request channel-management scopes such as `channels:write`.
- Add `channels:history`, `groups:history`, or `mpim:history` only if a later
  issue chooses full channel message ingestion beyond `app_mention` and DMs.

## 6. Codex Mapping

### Target

Slack adapter declares local Slack shapes inside `packages/im-slack`.

```ts
Target = {
  platform: "slack",
  chatId: `${teamId}:${channelId}`,
  threadKey?: threadTs,
}
```

Rules:

- Include `teamId` in `chatId` so channel ids from different workspaces cannot
  collide in storage or ACLs.
- Use `threadKey = thread_ts` when Slack gives a thread. If no `thread_ts`
  exists, omit it for DMs and use the root message `ts` only when replying in a
  Slack channel thread is required by the event path.
- `topicId` remains unused.

### Sender

```ts
Sender = {
  userId: `${teamId}:${userId}`,
  displayName?: redactedDisplayName,
}
```

The daemon's `/whoami` output must continue to show identity-field presence, not
raw Slack ids.

### MessageRef

```ts
MessageRef = {
  target,
  messageId: `${channelId}:${ts}`,
  kind: "inbound" | "text" | "approval_card" | "file",
  textUpdateMode: "edit",
}
```

Slack `chat.update` can update bot-owned text and Block Kit card messages, so
`textUpdateMode` is `edit` for bot-owned text refs. Thread replies should keep
the same `target.threadKey` so daemon progress edits and terminal replies stay
inside the same Slack thread.

## 7. Inbound Routing

Supported first:

- DM messages via `message.im`.
- Channel invocation via `app_mention`.
- Slash command `/codex <text>` from DM or channel.

Message normalization:

- Strip only the leading bot mention from `app_mention` before passing text to
  the existing daemon command router.
- Preserve user text otherwise; do not invent Slack-specific commands.
- Ignore bot/self messages to prevent loops.
- Drop unsupported message subtypes by default with redacted audit metadata.
- Attachments become `InboundAttachment` only after the file is downloaded to a
  local daemon attachment directory.

Group/channel safety:

- Slack channel messages still pass `SecurityPolicy.checkInboundMessage`.
- The Slack plan recommends adding allowed channel ids through access groups and
  `security.group_policy.mention_required_chats`.
- `/codex` slash commands are explicit invocation and may satisfy mention-gated
  routing by passing text through the same common command path after
  authorization.

## 8. Outbound Text and Progress

`sendText` uses `chat.postMessage`.

`editText` uses `chat.update` for bot-owned text refs.

Long output remains daemon-owned:

- Short progress updates edit one Slack message.
- Long logs or diffs should be summarized in text and sent as file artifacts
  when the daemon emits an outbound file.
- Slack-specific formatting stays inside `packages/im-slack`; daemon text stays
  platform-neutral.

## 9. Approval Cards

Slack approval cards use Block Kit:

- One section block for summary/kind/risk/status.
- One actions block with up to four buttons:
  - Allow once
  - Allow session
  - Decline
  - Abort
- `action_id` should be stable, e.g. `codex_im_approval`.
- Button `value` must be exactly the existing `v1:<opaque>` callback token when
  daemon provides `wirePayload`.
- No raw `approvalId`, method, nonce, command cwd, messageRef, or user id in the
  button value.

Slack button values allow enough bytes for the existing token shape, but keep the
shared token short. Set:

```ts
SLACK_CAPABILITIES = {
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: true,
  maxCallbackDataBytes: 2000,
}
```

Callback handling:

- The Socket Mode listener must `ack()` Slack immediately, before waiting for
  Codex approval resolution.
- It then emits `InboundAction` with `rawCallbackData`, Slack target, sender,
  and messageRef.
- Daemon remains responsible for callback-token lookup, messageRef validation,
  SecurityPolicy, and broker resolution.
- `answerAction` can be a no-op or a small ephemeral response if the Socket Mode
  payload supplies a response hook; terminal state is still the updated card.

Card update:

- `updateCard` uses `chat.update`.
- Use a fresh Block Kit `block_id` on update so Slack does not treat stale
  interactive block ids as current.
- Resolved cards remove buttons, preserving the existing daemon behavior.

## 10. Slash Commands and App Home

Register one Slack slash command:

```text
/codex <existing IM command or prompt>
```

Examples:

- `/codex projects`
- `/codex use codex-im`
- `/codex threads`
- `/codex switch 2`
- `/codex diagnostics`
- `/codex Run tests and summarize failures`

The adapter strips `/codex` and forwards the remainder through the existing
`routeInboundCommand` path. This keeps Slack aligned with Codex IM commands
without claiming Slack owns `/projects`, `/threads`, or `/model` as global
workspace commands.

App Home is a later read-only surface:

- show current daemon/platform readiness;
- show active project/thread for the user if bound;
- link to `/codex status`, `/codex projects`, and `/codex diagnostics` usage;
- do not expose approval buttons or secrets in App Home in the first Slack
  implementation.

## 11. Files and Artifacts

Outbound:

- Use Slack file upload APIs for daemon `sendFile`.
- Images generated by Codex App remain image files; diffs/logs become text files
  when too long for message text.
- Never upload `.env`, Keychain data, tokens, cookies, or full raw local logs.

Inbound:

- Download message file resources with the bot token only after the sender/chat
  passes SecurityPolicy.
- Save under the same daemon attachment root used by Telegram/Lark.
- Images map to Codex `UserInput.localImage`.
- Generic files map to explicit local-path text context until Codex App Server
  exposes a generic first-class file input.

## 12. Smoke and Acceptance

Default local gates:

- package skeleton boundary tests;
- fake Socket Mode event normalization tests;
- callback value/Block Kit bounds tests;
- daemon routing tests using the common adapter interface;
- `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm lint`,
  `pnpm protocol:check`.

Explicit live gates:

- `SLACK_LIVE=1 SLACK_LIVE_DRY_RUN=1`: token presence, manifest capability
  presence, no network send.
- `SLACK_LIVE=1`: bounded Socket Mode connect/start/stop against test app.
- `SLACK_LIVE_TEXT=1`: real DM or app-mentioned channel text round-trip.
- `SLACK_LIVE_APPROVAL=1`: real approval card click reaches daemon callback
  validation.
- `SLACK_LIVE_FILE=1`: harmless file send and optional inbound file download.

Every live gate must print only redacted presence/status fields.

## 13. Implementation Slices

### JAC-244 / Slack T1

- Add `packages/im-slack` workspace package.
- Add `SLACK_CAPABILITIES`.
- Add no-boundary-imports test.
- Add skeleton lifecycle tests.
- No live network.

### JAC-245 / Slack T2

- Normalize `message.im`, `app_mention`, and slash-command payloads into
  `InboundMessage`.
- Implement `sendText` and `editText` with injected fake Web API client.
- Map Slack `channel`/`ts`/`thread_ts` to `Target` and `MessageRef`.

### JAC-246 / Slack T3

- Render approval cards as Block Kit.
- Emit `InboundAction` from block actions with immediate Slack ack.
- Prove callback value is `v1:<opaque>` only.
- Prove stale/wrong messageRef actions fail closed at daemon layer.

### JAC-247 / Slack T4

- Wire `/codex` slash command to the existing common command router.
- Add read-only App Home/status only if it fits without expanding security
  surface.
- Keep all Codex-native commands owned by daemon routing.

### JAC-248 / Slack T5

- Add outbound `sendFile`.
- Add inbound file materialization.
- Add explicit live dry-run/connect/text/approval/file gates.
- Update `docs/handoffs/live-im-acceptance-status.md` only after real Slack
  evidence exists.

## 14. Open Decisions

- Whether to add `channels:history` / `groups:history` for non-mention channel
  messages. Default: no.
- Whether App Home is necessary for first usable release. Default: defer unless
  T4 remains small.
- Whether Socket Mode adapter should use `@slack/socket-mode` directly or
  `@slack/bolt`. Default: prefer direct `@slack/socket-mode` + `@slack/web-api`
  if tests stay smaller; use Bolt only if direct ack/routing becomes more
  complex than the wrapper saves.

## 15. Review Verdict

Plan review against project redlines: PASS.

The plan keeps Slack inside the existing IM adapter boundary, uses Socket Mode
to avoid a public listener, maps Slack ids into existing `Target` /
`MessageRef`, keeps Slack commands as ingress to existing Codex-native command
routing, and preserves approval-token/messageRef validation as the only action
decision path.

No child issue ids need to be added. JAC-244 through JAC-248 remain correctly
scoped; their descriptions should be aligned to the exact transport, scopes, and
messageRef/callback decisions above before each implementation slice starts.

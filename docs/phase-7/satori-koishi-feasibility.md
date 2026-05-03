# Satori/Koishi Feasibility Spike

Generated: 2026-05-03  
Linear issue: JAC-102  
Branch: `codex/phase-7-planning`  
Verdict from JAC-104: `spike-only`

This is a docs/static-analysis spike. It does not create an adapter package,
instantiate Koishi/Satori clients, probe credentials, open WebSocket/HTTP
connections, or start any listener.

## Verdict

Satori/Koishi remains a plausible long-tail compatibility layer, but it is not
safe to implement as a production `im-satori` adapter in Phase 7 without a
separate implementation plan and fixture evidence.

Recommended next state:

- Keep JAC-102 complete as `spike-only`.
- Allow a later limited implementation plan only for a single configured Satori
  login over outbound WebSocket, with explicit authentication, no dynamic bot
  admission, no WebHook/public listener, and `supportsButtons=false` by default.
- Treat actionable approval buttons as blocked until raw Satori fixtures prove
  the button event carries enough channel/message/operator data to reconstruct
  `Target`, `Sender`, and `MessageRef` before `broker.resolve`.

## Evidence From Official Docs

- Satori splits communication into HTTP API services for sending/invoking and
  WebSocket/WebHook event services for receiving events.
- Satori resources are intentionally cross-platform and many fields are optional,
  so missing `channel`, `message`, `user`, `operator`, or `guild` data must be
  treated as normal, not exceptional.
- Satori message APIs include create, get, update, delete, and list around
  `channel_id`/`message_id`.
- Satori interaction buttons are experimental. `interaction/button` requires the
  `button` resource, but the general Event shape makes `channel`, `message`, and
  `operator` optional.
- Satori HTTP API authentication uses an `Authorization` header plus
  `Satori-Platform` and `Satori-User-ID` headers.
- Satori WebSocket authentication is via `IDENTIFY.token`; WebHook is optional
  and reverse-authenticates through an `Authorization: Bearer ...` request
  header.
- Koishi adapter docs show one-to-one vs one-to-many adapter patterns,
  WebSocket, WebHook, polling, and server modes. They also warn that unlimited
  dynamic bot connections can be abused unless the adapter server runs in a
  trusted network or adds authentication.

Sources:

- https://satori.chat/en-US/protocol/
- https://satori.chat/en-US/protocol/api.html
- https://satori.chat/en-US/protocol/events.html
- https://satori.chat/en-US/resources/message.html
- https://satori.chat/en-US/resources/interaction.html
- https://koishi.chat/en-US/guide/adapter/adapter

## Mapping To ChannelAdapter

| ChannelAdapter surface | Satori/Koishi fit | Required future guardrail |
|---|---|---|
| `start()` / `stop()` | Feasible for an outbound Satori WebSocket client. Koishi also supports WebHook/server-style adapters, but those introduce listener exposure. | Future implementation must prefer outbound WebSocket and must not start public HTTP/WebSocket listeners by default. |
| `onMessage()` | Feasible only when `message-created` events include `channel.id`, `message.id`, and `user.id`. | Missing `channel`, `message`, or `user` must drop/fail closed. No synthetic target fallback for approvals. |
| `Target.platform` | Can map from Satori `login.platform` for one configured login. | Multi-login or dynamic bot connections need a separate target-shape review because current `Target` has no bot/self id field. |
| `Target.chatId` | Can map from `channel.id`. | Required for all inbound messages/actions. Missing channel id is non-routable. |
| `Target.threadKey` | Candidate mapping from `guild.id` when present. | Must not infer guild/thread identity from display names or optional absent data. |
| `Target.topicId` | No general Satori equivalent. | Leave undefined unless a platform-specific fixture proves a stable topic/thread id. |
| `Sender.userId` | Can map from `user.id` for messages or `operator.id` for button actions. | Missing sender/operator blocks action handling and routes messages through normal unauthorized policy paths. |
| `MessageRef` | Can map from `channel.id` + `message.id` for message events and message API results. | Actionable callbacks are blocked unless the button event or referrer carries the original message id. |
| `sendCard()` | Satori can encode rich content and experimental buttons through message elements. | Approval buttons must use only opaque `v1:` token ids and only on platforms where button `id` round-trips into `interaction/button`. |
| `updateCard()` / `editText()` | Satori has `message.update`; support varies by platform and feature set. | Future adapter capabilities must be per configured platform/login; do not claim `canEditMessage=true` unless fixtures prove it. |
| `answerAction()` | No direct universal equivalent is proven in this spike. | If absent, action ack must degrade without marking approval success. Broker result remains authoritative. |
| `sendFile()` | Satori message elements include resource/file concepts, but platform support varies. | Default `supportsAttachments=false`; file support needs a later attachment slice. |

## Approval Flow Feasibility

Actionable approval is the hard part. A future Satori adapter may render
approval buttons only if all of the following are true for the target platform
and transport:

1. The outbound button can carry the daemon-generated `v1:` opaque token
   verbatim.
2. The inbound event returns that token as the button id or equivalent action
   payload.
3. The inbound event exposes a stable message id for `MessageRef`.
4. The inbound event exposes a stable channel id for `Target.chatId`.
5. The inbound event exposes a stable operator user id for `Sender.userId`.
6. The adapter can ack or safely ignore button ack without implying approval
   success.

If any item is missing, Satori approval rendering must fall back to
non-actionable text. It must never expose raw approval ids, raw callback tokens,
or `/approve <id>` style text commands.

## Topology Decision

Preferred future topology, if this ever moves beyond spike:

```text
codex-im daemon
  -> im-satori adapter process/module
  -> outbound Satori WebSocket with IDENTIFY token
  -> Koishi server-satori on loopback or trusted private network
  -> Koishi platform adapters
```

Rejected for default behavior:

- Satori WebHook into a Codex-managed public listener.
- Dynamic unauthenticated bot admission.
- One adapter instance multiplexing multiple Satori logins without extending or
  constraining the target shape.
- Inferring approval authority from display name, guild name, channel name, or
  first actor.

## Recommendation

Do not implement `packages/im-satori` in the autonomous Phase 7 loop. The safe
next action is JAC-103 Chat SDK feasibility, also `spike-only`.

If the project later wants Satori implementation, create a new plan-gated issue
with this minimum scope:

- single configured login only
- outbound WebSocket only
- explicit token env indirection
- no WebHook/public listener
- `supportsButtons=false` until action fixture proves exact `v1:` token,
  operator, channel, and messageRef round-trip
- `canEditMessage=false` until `message.update` fixture proves stable update
  semantics
- `supportsAttachments=false`
- no Computer Use trigger except daemon explicit `/cu`

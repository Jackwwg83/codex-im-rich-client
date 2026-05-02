# DingTalk Target Verification

Status: implementation evidence updated for JAC-90 final review fixes
Generated: 2026-05-02

## 1. Summary

Phase 5 selects DingTalk Stream mode as the default adapter transport. Current
evidence supports robot message receive and card callback delivery without a
public webhook. The JAC-90 final review fixes pin the production Stream wrapper,
adapter-level Stream ack, duplicate delivery suppression, and redacted adapter
`raw` fields.

## 2. Evidence Gathered

Reference URLs:

- `https://opensource.dingtalk.com/developerpedia/docs/learn/stream/protocol/`
- `https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/nodejs/build-bot/`
- `https://opensource.dingtalk.com/developerpedia/docs/learn/card/intro/`
- `https://opensource.dingtalk.com/developerpedia/docs/learn/stream/faq/`

Official DingTalk Stream protocol docs list these callback topics:

| Topic | Use |
|---|---|
| `/v1.0/im/bot/messages/get` | robot message callback |
| `/v1.0/card/instances/callback` | card interaction callback |

Official Node tutorial evidence:

- Installs `dingtalk-stream`.
- Imports `DWClient`, `DWClientDownStream`, `EventAck`, and `TOPIC_ROBOT`.
- Registers callback listeners and calls `socketCallBackResponse` to avoid
  repeated delivery after a long response delay.

Official card docs evidence:

- Advanced interactive cards can choose callback delivery mode when the card is
  created/delivered.
- Card callback delivery requires `callbackType` to be set to `HTTP` or
  `STREAM` in the card API call; the developer-console bot receive setting does
  not automatically select card callback mode.
- Ordinary card update/typing behavior is not append-style streaming; updates
  should be full-card updates with controlled cadence.

Package evidence inspected locally:

| Package | Finding |
|---|---|
| `dingtalk-stream` | stable `2.1.5`; latest npm dist-tag is beta `2.1.6-beta.1` |
| `dingtalk-stream@2.1.5` | exports `DWClient`, `DWClientConfig`, `EventAck`, `TOPIC_ROBOT`, `TOPIC_CARD` |
| `@alicloud/dingtalk` | version `2.2.34`; candidate for card OpenAPI send/update wrapper |

## 3. Implemented Target Record

Sanitized fixtures under `packages/im-dingtalk/test/fixtures/` pin the fields
used by the adapter before it emits `InboundMessage` or `InboundAction`.

| Adapter field | DingTalk fixture field | Implementation |
|---|---|---|
| `Target.platform` | constant | `"dingtalk"` |
| `Target.chatId` for robot prompt | robot `conversationId` | used directly as the chat identity |
| robot `MessageRef.messageId` | robot `msgId` | used as inbound prompt message id |
| robot sender | `senderStaffId ?? senderId` | `senderStaffId` preferred when present |
| card `Target.chatId` | card `spaceId` + `spaceType` | `dtv1.card//IM_GROUP.<chat>` or `dtv1.card//IM_ROBOT.<user>` prefix is required |
| card actor | card `userId` | required before any action emission |
| card `MessageRef.messageId` | card `outTrackId` | required and rejected when synthesized or missing |
| card action payload | `cardPrivateData.params.wirePayload` | exact `v1:<opaque-token>` only |
| Stream callback receipt | Stream `headers.messageId` | adapter calls `ackCallback()` with `EventAck.SUCCESS`; receipt only, not approval acceptance |
| robot dedup key | robot `msgId` | `robot:<msgId>` |
| card replay key | Stream `headers.messageId`, card `outTrackId`, action id | `card:<streamMessageId>:<outTrackId>:<actionId>`; adapter surfaces it, daemon token CAS remains the security boundary |

The approved Phase 5 card path therefore remains Stream-mode only. It does not
fall back to public HTTP callbacks and does not downgrade approvals out of the
MVP.

## 4. Default Implementation Assumptions

- `platform`: `dingtalk`
- `Target.chatId`: robot `conversationId`
- `Target.threadKey`: undefined for MVP
- `MessageRef.chatId`: same reviewed conversation field
- `MessageRef.messageId`: robot `msgId` for inbound prompts; for approval cards,
  use only a reviewed original card/message reference from send response or card
  callback payload
- action payload: exact `v1:<opaque-token>` only
- stream ack: platform receipt only
- robot dedup key: `robot:<msgId>`; duplicate Stream deliveries are acked but not
  emitted twice
- card callback replay key: `card:<headers.messageId>:<outTrackId>:<actionId>`;
  duplicate Stream deliveries are acked and then fail closed in daemon token /
  messageRef validation rather than being treated as adapter-local approval state

## 5. Fixture Hygiene

Fixtures must not contain real:

- `clientId` / app key
- `clientSecret` / app secret
- access token
- session webhook URL/token
- corp id
- conversation id
- user id / staff id
- message id
- card instance id
- card callback token

Use stable fake values such as `cid_phase5_fake_group`,
`msg_phase5_fake_prompt`, `staff_phase5_alice`, and
`card_phase5_fake_approval`.

Adapter outputs must also sanitize their `raw` field before returning it across
the `ChannelAdapter` boundary. `raw` is for bounded debugging context, not a
full DingTalk platform payload.

Implemented raw-field rule:

- `InboundMessage.raw` keeps `topic`, `conversationType`, and `msgtype`.
- `InboundMessage.raw.streamMessageId`, `robotMsgId`, and `conversationId` are
  always `"[redacted]"`.
- `InboundAction.raw` keeps `topic`, `spaceType`, and local `actionId`.
- `InboundAction.raw.streamMessageId`, `outTrackId`, and `spaceId` are always
  `"[redacted]"`.
- The real ids still flow only through typed routing fields that the daemon
  needs for security validation (`target`, `messageRef`, `sender`, and
  idempotency key), not through debug `raw`.

# DingTalk Target Verification

Status: initial docs/package verification for JAC-78
Generated: 2026-05-02

## 1. Summary

Phase 5 selects DingTalk Stream mode as the default adapter transport. Current
evidence supports robot message receive and card callback delivery without a
public webhook, but implementation must still pin callback fields with sanitized
fixtures before broker resolution is wired.

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

## 3. Required Target Record Before JAC-84

Before implementing successful callback-to-broker resolution, record sanitized
fixture evidence for:

- robot message `conversationId`
- robot message `msgId`
- robot sender id field choice (`senderStaffId` and/or `senderId`)
- card callback conversation/chat field
- card callback actor field
- card callback original card/message reference
- card callback action payload location
- card callback response/ack semantics
- Stream `headers.messageId` for robot and card callbacks
- chosen robot idempotency key
- chosen card callback idempotency key
- whether the card callback has a separate delivery id, callback id, or only the
  Stream header id

If the card callback cannot prove original-card identity, Phase 5 must choose a
reviewed fallback before broker resolution:

1. a reviewed text-command fallback that still validates actor/target/session;
2. an operator-gated HTTP callback design; or
3. a narrower DingTalk MVP that excludes approval buttons and records that
   downgrade explicitly.

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
- robot dedup key: not selected until fixture evidence compares Stream
  `headers.messageId` with robot `msgId`
- card callback dedup key: not selected until fixture evidence compares Stream
  `headers.messageId`, card callback delivery/id field, and original card ref

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

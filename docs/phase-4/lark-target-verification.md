# Phase 4 T0a — Lark Target Verification

Generated: 2026-05-02
Linear: JAC-148
Branch: `codex/phase-4-planning`

## Verdict

Phase 4 uses this default implementation target:

| Field | Value |
|---|---|
| Domain | `feishu` |
| App type | Enterprise custom app |
| Subscription mode | Long connection |
| Card action callback | `card.action.trigger` |
| Public webhook | Not required by default |
| Live validation | Env-gated only; not part of default tests |

This unblocks fake/unit/contract implementation for T6/T8. Live smoke remains
env-gated and must not commit secrets or real sensitive identifiers.

## Evidence

Official Feishu callback documentation modified on 2025-10-17 states that long
connection mode:

- requires only public internet egress from the local server, with no public IP
  or domain required.
- supports enterprise custom apps.
- does not support the legacy message-card interaction callback through long
  connection.
- shows `card.action.trigger` registered through `WSClient` and
  `EventDispatcher` in the Node SDK.

Sources:

- `https://feishu.apifox.cn/doc-7518469`
- `https://www.npmjs.com/package/@larksuiteoapi/node-sdk`

SDK package inspected:

| Field | Value |
|---|---|
| Package | `@larksuiteoapi/node-sdk` |
| Version | `1.62.1` |
| Types entry | `./types` |
| Tarball | `https://registry.npmjs.org/@larksuiteoapi/node-sdk/-/node-sdk-1.62.1.tgz` |

Relevant SDK type evidence from `types/index.d.ts`:

- `WSClient.start({ eventDispatcher })` accepts an `EventDispatcher`.
- `EventDispatcher.register(...)` supports registering `"card.action.trigger"`.
- `InteractiveCardActionEvent` carries `open_message_id`, `tenant_key`,
  `open_id`, and `action.value`.
- `RawCardActionEvent` carries `context.open_message_id`,
  `context.open_chat_id`, fallback top-level `open_message_id`, fallback
  top-level `open_chat_id`, `operator`, and `action.value`.
- `normalizeCardAction(event)` returns a `CardActionEvent` with `messageId`,
  `chatId`, `operator`, and `action`, or `null` when message/chat/operator
  identity is missing.

## MessageRef Mapping

Lark `card.action.trigger` is viable for Phase 3 messageRef validation under
this mapping:

| Codex IM field | Lark source |
|---|---|
| `messageRef.messageId` | `context.open_message_id` or top-level `open_message_id` |
| `messageRef.target.chatId` | `context.open_chat_id` or top-level `open_chat_id` |
| `sender.id` | `operator.open_id` |
| `rawCallbackData` | exact Phase 3 `wirePayload`, `v1:<opaque-token>` |

The adapter must fail closed if the event lacks the original card/message
reference, if the reference is ambiguous, or if it has to be synthesized. The
adapter must not call `ApprovalBroker.resolve()` directly; daemon remains the
only approval resolution owner.

## Implementation Consequences

- T1-T5 remain safe to implement after JAC-65.
- T6/T8 may proceed for fake/unit/contract implementation using the exact target
  above.
- T6/T8 tests must include missing-messageRef fail-closed cases.
- T8a must reject anything except exact `v1:<opaque-token>` payloads.
- T8b must preserve the original Lark card message reference.
- T8c must treat Lark ack as platform receipt only, not approval success.
- JAC-161 live smoke must remain opt-in and redacted.

## Non-Goals

- No real Lark credentials were used.
- No live Lark calls were made.
- No public webhook was introduced.
- No real tenant/user/chat/message identifiers were recorded.

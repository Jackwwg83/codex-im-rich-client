# Phase 4 Decision — Lark Action Transport

Generated: 2026-05-02
Plan: `docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`

## Decision

Use Feishu/Lark long connection mode with the newer `card.action.trigger` callback for Phase 4 approval actions, pending T0 target verification for the actual app/domain.

Do not use the legacy "message card interaction" callback. Do not add a public webhook listener by default.

## Evidence

The npm README for `@larksuiteoapi/node-sdk` still says long connection mode supports event subscriptions and not callback subscriptions. That text is too broad for current card interaction docs.

The Feishu callback subscription documentation modified on 2025-10-17 says:

- long connection mode only requires the local server to access the public internet; no public IP/domain is required.
- legacy "message card interaction" callbacks cannot use long connection and must use developer-server callback delivery.
- newer card callback examples use `card.action.trigger` with long connection.
- the Node SDK example registers `"card.action.trigger"` on `new Lark.EventDispatcher({}).register(...)` and starts it with `new Lark.WSClient(...).start({ eventDispatcher })`.

Source:

- `https://s.apifox.cn/apidoc/docs-site/532425/doc-7518469`
- `https://www.npmjs.com/package/@larksuiteoapi/node-sdk`

## Consequences

- Phase 4 T0 must pin `card.action.trigger` as the only supported card-action callback type.
- T0 must record the exact domain (`feishu` or `lark`), app type, developer-console callback subscription setting, and whether `card.action.trigger` is enabled over long connection for that target.
- T6/T8 card/action implementation stays blocked until T0 verifies that the SDK event payload exposes the original card/message reference needed by Phase 3 messageRef validation.
- `@codex-im/im-lark` should test this with injected fake `WSClient`/`EventDispatcher` equivalents; no real Lark credentials are needed for unit/contract tests.
- Live validation remains operator-gated with `LARK_LIVE=1`.
- If the target app type/region cannot enable `card.action.trigger` over long connection, implementation must stop and a plan amendment must choose between a reviewed private callback endpoint or a secure text-command fallback.

## Security Requirements

- Lark action value must be the Phase 3 `wirePayload` verbatim (`v1:` + opaque token).
- The adapter must normalize Lark card action events into `InboundAction.rawCallbackData` and preserve the original card message reference.
- Missing, ambiguous, synthesized, or non-original message references fail closed before `ApprovalBroker.resolve()`.
- Lark callback ack means only that the platform event was received; approval success/failure remains owned by the daemon's broker result path.
- Replay, stale, wrong-message, wrong-chat, expired, malformed, unauthorized, missing-ref, and broker-error paths fail closed.
- No real raw approval id, action enum, actor id, target tuple, extra JSON action data, app secret, tenant token, verification token, encrypt key, access token, `tenant_key`, `open_id`, `union_id`, or `message_id` values may appear in fixtures, logs, SQLite, docs, or Linear. Policy text may name these fields.

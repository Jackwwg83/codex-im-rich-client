# Phase 4 Plan — Feishu/Lark Adapter

Status: approved for implementation after JAC-65 closeout
Generated: 2026-05-02
Base tag: `phase-3-telegram-mvp-complete`
Branch: `codex/phase-4-planning`

## 1. Mission

Phase 4 adds a native Feishu/Lark adapter while preserving the Phase 3 product boundary:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

The target is a plan-reviewed `@codex-im/im-lark` package that can receive Lark messages, send/edit Lark messages/cards, and route approval actions through the existing Phase 3 daemon/security/callback-token flow.

Phase 4 does not implement DingTalk, Computer Use production flow, Web Console, OpenClaw, Codex CLI/TUI output parsing, or a public Codex App Server listener.

## 2. Source Of Truth

- Phase 3 close: `docs/handoffs/2026-05-02-phase3-to-phase4.md`
- Phase 3 live status: `docs/handoffs/phase3-live-status.md`
- Phase 4 live status: `docs/handoffs/phase4-live-status.md`
- Lark target verification: `docs/phase-4/lark-target-verification.md`
- IM adapter design: `06-IM-ADAPTERS.md` §4 and §8
- Security: `07-SECURITY-AND-COMPUTER-USE.md`
- Data model: `08-DATA-MODEL.md`
- Loop runbook: `docs/automation/codex-app-autonomous-loop-runbook.md`
- Linear: JAC-9 parent, JAC-65 planning gate, JAC-148 through JAC-162 execution children

Current SDK evidence:

- `@larksuiteoapi/node-sdk` latest on npm: `1.62.1`.
- SDK README shows `Client`, `WSClient`, `EventDispatcher`, message sending, message cards, and `CardActionHandler`.
- SDK README says long connection mode receives event subscriptions and does not support callback subscriptions.
- Feishu callback docs updated 2025-10-17 show the newer `card.action.trigger` callback can be registered through `WSClient + EventDispatcher` in Node SDK long connection mode. The older "message card interaction (legacy)" callback still cannot use long connection.

## 3. Hard Redlines

- No public Codex App Server listener.
- Do not expose a public HTTP listener for bridge-to-Codex control.
- Do not implement a public Lark webhook by default. If Lark card callbacks require webhook delivery, that path must be operator-gated and reviewed before implementation.
- Do not put `app_secret`, verification token, encrypt key, tenant token, access token, cookies, or callback raw payload secrets into docs, Linear, fixtures, logs, SQLite, or plist.
- `@codex-im/im-lark` must not import `@codex-im/core`, `@codex-im/codex-runtime`, `@codex-im/app-server-client`, `@codex-im/storage-sqlite`, `@codex-im/daemon`, or protocol packages. It may import `@codex-im/channel-core`.
- Lark adapter must not call `ApprovalBroker`, `CodexRuntime`, or `AppServerClient` directly.
- Approval decisions must still go through Phase 3 daemon `onAction` -> `ApprovalBroker.resolve()`.
- Callback payload must be exactly the Phase 3 `wirePayload` string (`v1:<opaque-token>`). No raw approval id, action enum, actor id, target tuple, extra JSON action data, or legacy callback shape may be accepted or logged.
- Unknown, stale, replayed, wrong-actor, wrong-target, expired, malformed, unauthorized, or security-uncertain action paths fail closed.
- Computer Use remains explicit `/cu` and Phase 6; Phase 4 must not add production CU triggering.

## 4. Key Decision: Lark Action Transport

Phase 3 approval security assumes the adapter can produce:

```ts
InboundAction {
  rawCallbackData: "v1:<opaque-token>";
  messageRef: MessageRef;
  sender: Sender;
  target: Target;
}
```

Telegram provides this through callback queries. Lark's current long connection path appears viable for the newer `card.action.trigger` callback, but not for legacy message-card interaction callbacks. Therefore Phase 4 must lock the new callback type in T0 before implementation:

| Option | Default? | Notes |
|---|---:|---|
| A. Lark `card.action.trigger` over non-public long connection | selected pending review | Continue Phase 4 button/card MVP using `WSClient + EventDispatcher`. |
| B. Operator-gated private callback endpoint | not default | Requires explicit deployment model, network exposure review, verification token/encrypt key handling, and rollback. |
| C. Secure text-command fallback | plan amendment | Needs daemon/channel-core design because Phase 3 messageRef validation currently expects the original approval card messageRef before broker resolve. |
| D. Message-only Lark MVP without approvals | rejected for Phase 4 MVP | Fails Phase 4 acceptance unless explicitly descoped by review. |

T0 must produce a written decision. If `card.action.trigger` cannot be received through long connection on the target app type, stop implementation and review a plan amendment before writing `im-lark` source.

## 5. Phase 4 Architecture

### Package Boundary

New package:

```text
packages/im-lark/
  package.json
  tsconfig.json
  src/
    adapter.ts
    capabilities.ts
    client.ts
    config.ts
    callback-codec.ts
    card-renderer.ts
    index.ts
  test/
    no-boundary-imports.test.ts
    skeleton.test.ts
    lifecycle.test.ts
    on-message.test.ts
    send-text.test.ts
    send-card.test.ts
    on-action.test.ts
    contract.test.ts
    fixtures/
```

Allowed Codex package import:

```text
@codex-im/channel-core
```

No other Codex package imports are allowed from `packages/im-lark/src/**`.

### Runtime Shape

```text
Lark WSClient/EventDispatcher
  -> LarkChannelAdapter.onMessage/onAction
  -> ChannelAdapter contract
  -> Phase 3 Daemon
  -> SecurityPolicy / SessionRouter / ApprovalBroker / CodexRuntime
```

Outbound messages use `Client.im.message.*` calls through an injectable wrapper so tests do not require network or real credentials.

### Target Mapping

Use explicit fields, not serialized target strings:

| Channel field | Lark source |
|---|---|
| `platform` | `"lark"` |
| `chatId` | `chat_id` / `open_chat_id` |
| `threadKey` | `root_id` or message thread id when available |
| `topicId` | reserved; normally undefined |

### MessageRef Mapping

| MessageRef field | Lark source |
|---|---|
| `platform` | `"lark"` |
| `chatId` | `chat_id` |
| `messageId` | Lark message id |
| `threadKey` | root/thread id when available |
| `topicId` | undefined |

## 6. Security Model

- Lark `app_secret`, verification token, and encrypt key are loaded from env or Keychain-compatible env names, never literal config.
- Fixture JSON must be sanitized. Real `tenant_key`, `open_id`, `union_id`, `chat_id`, `message_id`, and card action values are replaced with stable fake values.
- Logs must redact token-shaped fields, authorization headers, tenant tokens, app secrets, encrypt keys, verification tokens, card action payloads, and sensitive platform identifiers (`tenant_key`, `open_id`, `union_id`, `message_id`).
- Adapter raw event storage is test-only fixtures unless a future reviewed audit expansion says otherwise.
- Lark card action ack must be fast; business resolution remains async and fail-closed.

## 7. Task Plan

### T0 — Lark Capability Spike And Plan Review Gate

Allowed files:

- `docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`
- `docs/phase-4/*`
- `TODOS.md`
- `docs/handoffs/phase4-live-status.md`
- Linear issue descriptions/comments

Body:

- Verify `@larksuiteoapi/node-sdk` receives new `card.action.trigger` callbacks through long connection without a public webhook, and explicitly reject legacy message-card callbacks for Phase 4.
- Record a decision under `docs/phase-4/lark-action-transport-decision.md`.
- Review this plan with Codex outside-voice and GPT Pro.
- Split/update Linear child issues based on the decision.
- Before T6/T8 may begin, record the exact target:
  - domain: `feishu` or `lark`
  - app type: enterprise custom app or other
  - callback subscription setting selected in the developer console
  - whether `card.action.trigger` is enabled over long connection
  - whether the SDK event payload exposes the original card/message reference needed for Phase 3 validation

Exit:

- Decision A, B, C, or D is recorded.
- If A is not viable, implementation stays blocked pending plan amendment.
- T1-T5 may begin after plan P1 fixes are applied. T6/T8 remain blocked until the T0 target record is complete.

### T1 — `@codex-im/im-lark` Skeleton And Boundary Tests

- Create package skeleton.
- Add D24-style no-boundary-imports guard for `im-lark`.
- Export adapter types and capabilities.
- No SDK lifecycle yet.

### T2 — Lark Config Schema Extension

- Extend config schema with `adapters.lark`.
- Fields: `enabled`, `app_id`, `app_secret_env`, `domain`, `encrypt_key_env?`, `verification_token_env?`, `allowed_chat_ids`.
- No literal secrets in fixtures/docs/tests.

### T3 — Long Connection Lifecycle

- Injectable `LarkClient` / `LarkWsClient` wrapper.
- `start()` subscribes before accepting inbound events.
- `stop()` is idempotent and pauses inbound first.
- No public listener.

### T4 — Message Receive Fixtures

- Normalize private chat, group mention, and thread/root message fixtures.
- Drop unsupported attachments fail-closed with user-visible text.
- Ensure sender/target/raw fields are sanitized and stable.

### T5 — SendText / EditText / Reply

- Implement `sendText` and `editText` through injected client calls.
- Preserve Lark message id in `MessageRef`.
- Split long text within Lark limits if needed.

### T6 — Card Rendering And `sendCard`

- Project Phase 3 `RichBlock`/approval card into Lark interactive card JSON.
- Use existing `ApprovalUiAction.wirePayload` verbatim as the action value.
- Do not invent raw approval id payloads.
- Surface send failures to daemon; no optimistic messageRef.
- Pin card payload size assumptions with tests or explicit constants before sending cards from production code.

### T7 — `updateCard` / Status Streaming

- Update existing card/message for streaming/status changes.
- Coalesce is still owned above the adapter; adapter only executes requested edit.
- API failures surface to caller.
- Pin card update-rate assumptions with tests; adapter must not silently drop update failures.

### T8a — Callback Payload Codec / Extraction

Only allowed after T0 chooses a reviewed action transport.

- Accept only exact Phase 3 `wirePayload` strings (`v1:<opaque-token>`).
- Reject raw approval ids, action enums, actor ids, target tuples, JSON payload objects, legacy callback shapes, missing values, and malformed prefixes.
- Redact action payloads in logs.

### T8b — Event To `InboundAction` Mapping

Only allowed after T0 target record confirms `card.action.trigger` and original card/message references are available.

- Map Lark card action event sender/target/message fields into `InboundAction`.
- Approval actions must include the original card/message `MessageRef` required by Phase 3 validation.
- Missing, ambiguous, synthesized, or non-original message refs fail closed before daemon broker resolution.

### T8c — Ack / Fail-Closed Behavior

Only allowed after T8a/T8b.

- Lark callback ack means "platform event received" only; it never means "approval accepted".
- User-visible success/failure must come from the daemon approval result path (`answerAction` / `updateCard` equivalent).
- Replay, stale token, wrong message, wrong chat, expired token, malformed payload, unauthorized actor, missing messageRef, and broker-error branches must ack/fail closed without mutating callback token state unless Phase 3 daemon reports broker success.

### T9 — Adapter Contract Suite

- Reuse channel-core expectations.
- Prove no imports across forbidden packages.
- Prove no method literals.
- Prove no token/secrets in logs or fixtures.

### T10 — Fake Lark Smoke

- Add `pnpm smoke:lark-fake`.
- No network, no credentials.
- Drive one inbound text message through daemon routing and one fake approval action if T0 action transport is viable.

### T11 — Operator-Gated Live Lark Smoke

- Add explicit env-gated harness only after T1-T10 pass.
- Required env: `LARK_LIVE=1` plus env names for secrets.
- No default CI path may call Lark.
- Output must redact all token/secret-shaped values.

### T12 — Phase 4 Review / Handoff / Tag

- Codex outside-voice review after fake smoke.
- Operator-gated live smoke may be documented if credentials are not available.
- Handoff to Phase 5 DingTalk or next reviewed phase.

## 8. Proposed Linear Child Issues

| Issue | Scope | Safe autonomous? |
|---|---|---:|
| JAC-65 | T0 plan review gate | yes, planning-only |
| JAC-148 | T0a Lark `card.action.trigger` transport spike | yes, docs/spike only |
| JAC-149 | T1 im-lark skeleton + boundary tests | yes |
| JAC-150 | T2 config schema extension | yes |
| JAC-151 | T3 long connection lifecycle | yes with fake client |
| JAC-152 | T4 message receive fixtures | yes |
| JAC-153 | T5 send/edit text | yes |
| JAC-154 | T6 sendCard/card rendering | yes after T0 |
| JAC-155 | T7 updateCard/status streaming | yes after T6 |
| JAC-156 | T8a callback payload codec/extraction | blocked until T0 |
| JAC-157 | T8b event-to-`InboundAction` mapping with original messageRef | blocked until T0 |
| JAC-158 | T8c ack/fail-closed action behavior | blocked until T8a/T8b |
| JAC-159 | T9 contract suite | yes |
| JAC-160 | T10 fake smoke | yes |
| JAC-161 | T11 live Lark smoke | env-gated/operator-gated |
| JAC-162 | T12 review/handoff/tag | yes, review-gated |

## 9. Exit Criteria

Phase 4 may tag only if:

1. Plan review returns GO or GO_WITH_LOW_NITS after any P0/P1 fixes.
2. Lark action transport decision is reviewed and implemented without weakening Phase 3 callback security.
3. `@codex-im/im-lark` boundary tests pass.
4. Fake Lark smoke passes without network/secrets.
5. Full gates pass:
   - `pnpm typecheck`
   - `pnpm typecheck:tests`
   - `pnpm test`
   - `pnpm lint`
   - `pnpm protocol:check`
6. Live Lark smoke is either operator-run and documented, or explicitly deferred with reason. Missing credentials must not block tag if fake smoke and operator instructions are complete.
7. Phase 4 handoff exists and names the next phase.

## 10. Open Questions For Review

1. Is the 2025 `card.action.trigger` long-connection path available for the target app type and region (`feishu` vs `lark`) with current `@larksuiteoapi/node-sdk`?
2. If not, is a reviewed private callback endpoint acceptable, or should Phase 4 introduce a secure text-command fallback in channel-core/daemon first?
3. Should Lark use `open_id`, `union_id`, or another actor id for `Sender.platformUserId`? Default recommendation: use the platform-provided stable user id available in receive/action payloads and keep raw under sanitized `raw`.
4. What exact Lark card payload size / update rate limits should be pinned after SDK/platform docs are verified in T6/T7?
5. Should Phase 4 include file/media upload, or defer attachments until after text/card/approval MVP?

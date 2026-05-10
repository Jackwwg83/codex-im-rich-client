# Phase 5 Plan - DingTalk Adapter

Status: approved for implementation after JAC-78 review gate
Generated: 2026-05-02
Base tag: `phase-4-lark-adapter-complete`
Branch: `codex/phase-5-dingtalk`
Linear parent: JAC-10
Current gate: JAC-78 green; next issue JAC-79

## 1. Mission

Phase 5 adds a native DingTalk adapter while preserving the product boundary:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

The target is a reviewed `@codex-im/im-dingtalk` package that can receive
DingTalk robot messages through Stream mode, send/edit text and cards, map card
actions into the existing Phase 3 daemon approval flow, and provide fake plus
env-gated live smoke coverage.

Phase 5 does not implement Computer Use production flow, Satori/Koishi, Vercel
Chat SDK, Web Console, OpenClaw, Codex CLI/TUI output parsing, or a public Codex
App Server listener.

## 2. Source Of Truth

- Phase 4 close: `docs/internal/handoffs/phase4-live-status.md`
- Phase 4 to Phase 5 handoff: `docs/internal/handoffs/2026-05-02-phase4-to-phase5.md`
- Phase 5 live status: `docs/internal/handoffs/phase5-live-status.md`
- DingTalk target verification: `docs/internal/phase-5/dingtalk-target-verification.md`
- IM adapter design: `06-IM-ADAPTERS.md` Section 5
- Data model: `08-DATA-MODEL.md`
- Security: `07-SECURITY-AND-COMPUTER-USE.md`
- Loop runbook: `docs/internal/automation/codex-app-autonomous-loop-runbook.md`
- Linear: JAC-10 parent, JAC-78 through JAC-90 execution children

Current public evidence:

- Official DingTalk Stream docs list `/v1.0/im/bot/messages/get` for robot
  messages and `/v1.0/card/instances/callback` for card interaction callbacks.
- Official Node tutorial installs `dingtalk-stream` and imports `DWClient`,
  `EventAck`, and `TOPIC_ROBOT`.
- Official DingTalk card docs say card callback delivery is chosen by the card
  creation API `callbackType` value, not by the developer-console bot receive
  setting.
- Official Stream FAQ says Stream uses outbound domains `api.dingtalk.com` and
  `wss-open-connection.dingtalk.com`; no public inbound listener is needed for
  Stream mode.
- `dingtalk-stream` npm current stable inspected locally: `2.1.5`. npm latest is
  `2.1.6-beta.1`; Phase 5 should pin stable `^2.1.5` unless review says
  otherwise.
- `@alicloud/dingtalk` npm inspected locally: `2.2.34`. Use it only behind an
  injectable card/OpenAPI client when Stream/sessionWebhook alone cannot cover
  card send/update.

## 3. Hard Redlines

- No public Codex App Server listener.
- No public DingTalk webhook by default. Phase 5 default transport is outbound
  Stream mode.
- No DingTalk `clientSecret`, app secret, access token, session webhook token,
  cookies, callback payload secrets, card template credentials, or private user
  identifiers in docs, Linear, fixtures, logs, SQLite, plist, or commits.
- `@codex-im/im-dingtalk` must not import `@codex-im/core`,
  `@codex-im/codex-runtime`, `@codex-im/app-server-client`,
  `@codex-im/storage-sqlite`, `@codex-im/daemon`, `@codex-im/protocol`, or
  `@codex-im/render`. It may import `@codex-im/channel-core`.
- DingTalk adapter must not call `ApprovalBroker`, `CodexRuntime`,
  `AppServerClient`, storage, daemon, or protocol directly.
- Approval decisions must still go through Phase 3 daemon `onAction` ->
  `ApprovalBroker.resolve()`.
- Card callback data must carry only the Phase 3 `wirePayload`
  (`v1:<opaque-token>`). No raw approval id, action enum, actor id, target tuple,
  nonce, JSON object, or legacy callback value may be accepted or logged.
- Raw callback token must never be persisted. Phase 3 callback-token repository
  hash-only storage remains authoritative.
- DingTalk callback action mapping must provide the original card/message
  reference needed for Phase 3 `messageRef` validation before broker resolve.
  Missing, ambiguous, synthesized, stale, replayed, expired, malformed,
  unauthorized, or wrong-target paths fail closed.
- Stream ack means "DingTalk event received", not "approval accepted".
  User-visible approval success/failure comes from daemon result handling.
- Computer Use remains Phase 6 and explicit `/cu`; Phase 5 must not add
  production Computer Use triggering.

## 4. Key Decision: DingTalk Transport

DingTalk supports robot messages and card callbacks over Stream mode. Phase 5
selects Stream mode as the default because it preserves the Mac mini deployment
model without a public webhook.

| Option | Default? | Notes |
|---|---:|---|
| A. DingTalk Stream robot + Stream card callbacks | selected pending review | Use `dingtalk-stream`; no inbound public listener. |
| B. Operator-gated HTTP card callback | not default | Requires public/network exposure review and token/encrypt handling. |
| C. Secure text-command fallback | plan amendment | Only if card callbacks cannot provide the messageRef required by Phase 3. |
| D. Message-only DingTalk MVP without approvals | rejected for Phase 5 MVP | Fails acceptance unless review explicitly descopes approval round-trip. |

Implementation may start with package skeleton and fake Stream wrappers after
this plan review. Card callback action mapping (JAC-83/JAC-84/JAC-85) remains
blocked until tests pin exactly which callback fields form the original
`MessageRef`.

## 5. Phase 5 Architecture

### Package Boundary

New package:

```text
packages/im-dingtalk/
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
  scripts/
    live-smoke.mts
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

No other Codex package imports are allowed from `packages/im-dingtalk/src/**`.

### Runtime Shape

```text
DingTalk Stream DWClient
  -> DingTalkChannelAdapter.onMessage/onAction
  -> ChannelAdapter contract
  -> Phase 3 Daemon
  -> SecurityPolicy / SessionRouter / ApprovalBroker / CodexRuntime
```

Outbound text uses an injectable client around the Stream/sessionWebhook send
surface. Outbound cards use an injectable card/OpenAPI client. Tests use fakes;
default CI never reaches DingTalk.

### Target Mapping

Use explicit fields, not serialized target strings:

| Channel field | DingTalk source |
|---|---|
| `platform` | `"dingtalk"` |
| `chatId` | robot `conversationId` |
| `threadKey` | undefined for Phase 5 MVP unless verified by payload |
| `topicId` | undefined |

The storage `target_key` remains compatible with `08-DATA-MODEL.md`:

```text
dingtalk:<conversation_id>
```

### MessageRef Mapping

| MessageRef field | DingTalk source |
|---|---|
| `platform` | `"dingtalk"` |
| `chatId` | robot/card callback `conversationId` or reviewed equivalent |
| `messageId` | robot `msgId` for inbound prompts; card `outTrackId` or card instance id only if review confirms it is the original approval-card reference |
| `threadKey` | undefined for Phase 5 MVP unless verified |
| `topicId` | undefined |

If a DingTalk card callback does not expose a stable original approval-card
reference, JAC-84 must stop and amend the plan before any broker resolution path
is implemented.

## 6. Security Model

- DingTalk `clientId`, `clientSecret`, access token, session webhook, card
  template id, and card instance ids are loaded from env or generated at runtime;
  no literal secrets or real identifiers in committed docs/tests.
- Fixture JSON must be sanitized. Real `conversationId`, `msgId`,
  `senderStaffId`, `senderId`, `sessionWebhook`, `chatbotUserId`, `corpId`, card
  instance ids, and callback data are replaced with stable fake values.
- Adapter output must sanitize DingTalk `raw` before it leaves
  `@codex-im/im-dingtalk`. Add a `sanitizeDingTalkRaw`-equivalent test target
  before message fixtures are considered complete: no full platform payload,
  session webhook, callback token, access token, secret-shaped value, or real
  platform id may appear in `InboundMessage.raw`, `InboundAction.raw`, logs, or
  fixtures.
- Logs must redact secret/token-shaped fields, authorization headers, session
  webhooks, access tokens, client secrets, card callback payloads, and sensitive
  platform ids.
- Stream callback handlers must ack promptly when appropriate, but business
  approval settlement remains above the adapter.
- Reconnect must not replay accepted approval actions as accepted. Replay,
  duplicated, stale, or transport-lost action paths fail closed through existing
  daemon/token semantics.

## 7. Task Plan

### T0 - JAC-78 Plan Review Gate

Allowed files:

- `docs/internal/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`
- `docs/internal/phase-5/*`
- `docs/internal/handoffs/phase5-live-status.md`
- `docs/internal/automation/codex-app-autonomous-loop-runbook.md`
- `AGENTS.md`
- `README.md`
- `TODOS.md`
- Linear issue descriptions/comments

Body:

- Verify current DingTalk Stream SDK/package choice from official docs and npm.
- Record Stream/card callback target evidence.
- Review this plan with Codex outside-voice.
- Update Phase 5 live-status and Linear.

Exit:

- Plan review returns GO or GO_WITH_LOW_NITS, or all P0/P1 fixes are absorbed.
- JAC-79 may start only after the review gate is green.

### T1 - JAC-79 `@codex-im/im-dingtalk` Skeleton And Boundary Tests

- Add package skeleton and workspace links.
- Add D24-style no-boundary-imports guard for `im-dingtalk`.
- Export adapter types and capabilities.
- No SDK lifecycle yet.

### T2 - JAC-80 Stream Lifecycle Fake Test

- Introduce injectable `DingTalkStreamClient` wrapper around `DWClient`.
- `start()` registers robot and card callback listeners before accepting inbound
  events.
- `stop()` is idempotent and pauses inbound first.
- No network in tests.

### T3 - JAC-81 Message Receive Fixtures

- Normalize private and group robot text fixtures.
- Group messages require DingTalk's bot receive semantics; unsupported or
  non-text messages fail closed with visible fallback text.
- Preserve sanitized raw fields for debugging.
- Pin the robot-message idempotency key from fixture evidence. Required inputs:
  Stream `headers.messageId`, robot `msgId`, and the chosen dedup key.
- Prove `raw` sanitization at the adapter boundary before returning
  `InboundMessage`.

### T4 - JAC-82 Card Send / Update

- Render approval/status cards through an injectable DingTalk card client.
- Use `callbackType: "STREAM"` for advanced card callback delivery when
  supported by the selected API path.
- Surface send/update failures to daemon; no optimistic `MessageRef`.
- Keep update cadence controlled above adapter or via explicit constants.

### T5 - JAC-83 Callback Action Mapping

- Accept only exact Phase 3 `wirePayload` strings.
- Reject raw approval ids, action enums, target tuples, JSON payload objects,
  missing values, wrong prefixes, and malformed primitives.
- Redact action payloads in logs.
- JAC-83 may implement only callback codec/parser extraction and rejection
  tests until JAC-84 proves original-card `MessageRef` fields. It must not emit
  `InboundAction`, call any action handler, or introduce a broker-resolving path.

### T6 - JAC-84 MessageRef Validation

- Map DingTalk callback source fields into `InboundAction.messageRef`.
- Prove missing, ambiguous, or synthesized refs fail closed before daemon broker
  resolution.
- Pin card callback idempotency keys from fixture evidence. Required inputs:
  Stream `headers.messageId`, card callback delivery/id field, original card
  reference, and the chosen dedup key.
- Prove `raw` sanitization at the adapter boundary before returning
  `InboundAction`.
- If callback payload evidence cannot prove original-card identity, stop and
  amend plan.

### T7 - JAC-85 Approval Round-Trip Fake Test

- Fake inbound prompt -> daemon/session -> fake DingTalk card -> fake callback
  action -> broker result.
- Prove stale/expired/replayed/wrong-target branches fail closed.
- No live network.

### T8 - JAC-86 Reconnect Behavior

- Simulate stream disconnect/reconnect.
- Prove duplicate robot callbacks do not duplicate turns without idempotency.
- Prove duplicate card callbacks cannot reuse consumed callback tokens.

### T9 - JAC-87 Adapter Contract Suite

- Reuse channel-core contract expectations.
- Prove package boundary and method-literal policies.
- Prove no token/secrets in logs or fixtures.

### T10 - JAC-88 Fake DingTalk Smoke

- Add `pnpm smoke:dingtalk-fake`.
- Drive one inbound DingTalk text message through daemon routing and one fake
  approval action through fail-closed/success paths.
- No network, no credentials.

### T11 - JAC-89 Operator-Gated Live DingTalk Smoke

- Add explicit `OPERATOR_GATE + env-gated` harness only after T1-T10 pass.
- Required env includes `DINGTALK_LIVE=1` plus names for credentials; secrets are
  read from env and redacted from output.
- Default run skips without network. The unattended loop must not set
  `DINGTALK_LIVE=1` itself.

### T12 - JAC-90 Review / Handoff / Tag

- Codex outside-voice review after fake smoke and env-gated live harness.
- Fix P0/P1 findings before tag.
- Update README/TODOS/live-status/handoff.
- Bump version only at Phase 5 tag gate.
- Tag `phase-5-dingtalk-adapter-complete` if gates pass.

## 8. Linear Child Issues

| Issue | Scope | Safe autonomous? |
|---|---|---:|
| JAC-78 | T0 plan review gate | yes, planning-only |
| JAC-79 | T1 package skeleton + boundary tests | yes |
| JAC-80 | T2 Stream lifecycle fake test | yes |
| JAC-81 | T3 message receive fixtures | yes |
| JAC-82 | T4 card send/update | yes after T2/T3 |
| JAC-83 | T5 callback codec/parser only; no `InboundAction` emission before JAC-84 | yes after T4 |
| JAC-84 | T6 messageRef validation + action emission gate | review-sensitive |
| JAC-85 | T7 approval round-trip fake test | yes after T6 |
| JAC-86 | T8 reconnect behavior | yes |
| JAC-87 | T9 adapter contract suite | yes |
| JAC-88 | T10 fake DingTalk smoke | yes |
| JAC-89 | T11 env-gated live DingTalk smoke | OPERATOR_GATE + env-gated |
| JAC-90 | T12 review/handoff/tag | yes, review-gated |

## 9. Exit Criteria

Phase 5 may tag only if:

1. Plan review returns GO or GO_WITH_LOW_NITS after any P0/P1 fixes.
2. DingTalk Stream/card callback behavior is implemented without weakening Phase
   3 callback-token and messageRef security.
3. `@codex-im/im-dingtalk` boundary tests pass.
4. Fake DingTalk smoke passes without network/secrets.
5. Full gates pass:
   - `pnpm typecheck`
   - `pnpm typecheck:tests`
   - `pnpm test`
   - `pnpm lint`
   - `pnpm protocol:check`
6. Live DingTalk smoke is `OPERATOR_GATE + env-gated`. Default runs must skip
   without network. The autonomous loop may add/verify the harness, but must not
   set `DINGTALK_LIVE=1` or introduce real credentials itself. Missing live
   credentials must not block tag if fake smoke and operator instructions are
   complete.
7. Phase 5 handoff exists and names the next phase.

## 10. Open Questions For Review

1. Should Phase 5 pin `dingtalk-stream@^2.1.5` instead of npm latest
   `2.1.6-beta.1`?
2. Which DingTalk card API path should be the default for send/update:
   `@alicloud/dingtalk` advanced card create/deliver/update, robot
   sessionWebhook card APIs, or a split by capability?
3. Does the chosen card callback path expose enough stable fields to validate
   the original approval-card `MessageRef` before broker resolution?
4. Which actor id should back `Sender.platformUserId`: `senderStaffId` when
   present, falling back to `senderId`, or always `senderId`?
5. What update cadence should be pinned for DingTalk full-card updates?

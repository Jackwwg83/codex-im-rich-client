# Phase 4 Final Codex Review

Generated: 2026-05-02

Scope: `phase-3-telegram-mvp-complete..f51c7c6`

## Verdict

REJECT

## Findings

### P1 — Lark long-connection message receive is not implemented or proven

The adapter only registers `card.action.trigger`, has no SDK-backed message
receive registration, and the fake smoke bypasses transport with
`_emitRawMessageForTest`. The adapter also only starts an injected `wsClient`,
while the only real `@larksuiteoapi/node-sdk` use is the standalone live-send
script.

Required change: add the production Lark SDK wrapper/factory using
`Client`/`WSClient`/`EventDispatcher`, register Lark message receive plus card
action events before unpausing inbound, and update fake smoke to inject
messages through the dispatcher path.

Refs:

- `packages/im-lark/src/adapter.ts`
- `packages/daemon/test/lark-fake-smoke.test.ts`
- `packages/im-lark/scripts/live-smoke.mts`

### P1 — Approval card action payload is not the exact opaque `v1:` string

`sendCard` wraps the payload as `{ wirePayload }`, and the callback codec
accepts that JSON object shape, while the approved plan requires exact
`wirePayload` strings and rejection of JSON payload objects.

Required change: send the action value as the exact `v1:<token>` string and
make extraction reject objects, or stop and amend the reviewed plan with
explicit security review if Lark requires object values.

Refs:

- `packages/im-lark/src/card.ts`
- `packages/im-lark/src/callback-codec.ts`
- `docs/internal/superpowers/plans/2026-05-02-phase-4-lark-plan.md`

### P2 — Malformed Lark message events throw instead of failing closed

`normalizeLarkRawMessage` throws on incomplete events, and `#emitRawMessage`
does not catch that normalization failure.

Required change: make malformed inbound messages drop or produce an explicit
unsupported-message path without propagating an exception out of the transport
handler.

Refs:

- `packages/im-lark/src/message.ts`
- `packages/im-lark/src/adapter.ts`

### P2 — Card payload size and update-rate assumptions remain unpinned

Phase 4 T6/T7 required Lark card payload-size and update-rate assumptions to be
pinned.

Required change: add explicit constants/tests or a documented deferral before
claiming T6/T7 complete.

Refs:

- `docs/internal/superpowers/plans/2026-05-02-phase-4-lark-plan.md`

## Positive Checks

- `packages/im-lark/src/**` stays behind `@codex-im/channel-core`; no direct
  Core, Runtime, AppServerClient, daemon, storage, render, or protocol imports
  found.
- No public webhook/listener/server implementation found in `im-lark`
  production source.
- Daemon action handling still decodes the raw `v1:` token, hashes before
  lookup, validates `messageRef` before `broker.resolve`, and does not persist
  the raw callback token.
- Live smoke is explicit/env-gated and redacts app id, chat id, message id, and
  secret presence in output.
- No Computer Use production flow or DingTalk adapter implementation was added.

## Tag Recommendation

No. JAC-162 should not proceed to handoff/version/tag until the P1 blockers are
fixed and the full gates are rerun.

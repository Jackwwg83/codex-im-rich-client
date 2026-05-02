# Phase 4 Final Codex Re-review

Generated: 2026-05-02

Scope: `phase-3-telegram-mvp-complete..50a90c4`, focused on the P1/P2 closures from `docs/phase-4/impl-final-codex-review.md`.

Verdict: **GO_WITH_LOW_NITS**. No P0/P1 blockers remained; tag gate may proceed.

## Closure Check

- P1 Lark long-connection message receive: closed. `createLarkSdkChannelAdapter` now builds SDK-backed `Client` / `WSClient` / `EventDispatcher` options, and `start()` registers both `im.message.receive_v1` and `card.action.trigger` before unpausing inbound.
- P1 wrapped approval payload: closed. Button `value` is the exact `v1:<token>` string; object payload shapes are rejected.
- P2 malformed message throws: closed. Message transport normalization is caught and dropped; regression coverage exists.
- P2 Lark card limits unpinned: closed. Payload and update-rate constants are pinned and tested.

## New Findings

- P0: none.
- P1: none.
- P2: Production SDK factory did not install an `actionClient`, so `answerAction()` would reject on factory-created adapters.
- P2: Malformed card-action primitives could still throw out of the transport handler.
- P3: none.

## Positive Checks

- `@codex-im/im-lark` production source imports only `@codex-im/channel-core` among Codex packages.
- No public Lark webhook, HTTP listener, public Codex App Server listener, Computer Use production flow, or DingTalk implementation was added.
- Fake smoke drives message and action through dispatcher registrations, not direct test emitters.
- Daemon still hashes raw callback tokens before lookup and validates `messageRef` before `broker.resolve()`.

## Post-review Closure

Commit `c289a7a` closes both low-nit P2 findings:

- Adds an explicit production no-op Lark action ack strategy for SDK-created adapters. Lark long-connection callbacks are acknowledged by the SDK event handler return path; daemon `answerAction()` now resolves instead of failing due to missing `actionClient`.
- Changes the card-action boundary to accept `unknown`, record-guard malformed events, catch normalization failures, and cover `undefined`, `null`, primitives, arrays, and invalid nested `event` shapes.

Verification after `c289a7a`:

- `pnpm typecheck` green.
- `pnpm typecheck:tests` green.
- `pnpm test` green: 113 files, 1078 passing, 1 skipped.
- `pnpm lint` green: 256 files checked.
- `pnpm protocol:check` green: 234 schema files canonical.
- `pnpm smoke:lark-fake` green.
- `pnpm smoke:lark-live` default skip green.

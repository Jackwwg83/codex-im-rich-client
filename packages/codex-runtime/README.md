# @codex-im/codex-runtime

Phase 1 runtime kernel — thread/turn/item state machine, ordered event
normalizer, typed wrappers over `AppServerClient.request`. **No IM
adapter, no Computer Use, no SQLite.**

## T3 status: skeleton only

Currently exposes:

- `CodexRichEvent` — discriminated union of normalized events the
  EventNormalizer (T7a/T7b) will emit on its AsyncIterable.
- `EventClass` — the `"lifecycle" | "delta"` backpressure split from
  plan §1 D5 final.
- `MethodClassification` — `Readonly<Record<string, EventClass>>` shape;
  the runtime constant lands in `event-class.ts` (T7a) typed exhaustively
  against `ServerNotification["method"]` from `@codex-im/protocol`.

No runtime logic yet. T6, T7a, T7b, T8 land the actual behavior.

## ONE-SHOT lifecycle (sticky note for T8)

Like `AppServerClient`, `CodexRuntime` will document a one-shot lifecycle:
when the underlying client closes, the runtime is dead. The daemon
supervisor (T11a / T11b) constructs a fresh `Transport + AppServerClient
+ CodexRuntime` quartet on every recovery; nothing is reused.

## Boundaries (don't violate)

- Do NOT subscribe to `client.onNotification` outside of EventNormalizer.
- Do NOT call `client.setServerRequestHandler` here — that is
  `@codex-im/core` ApprovalBroker's exclusive slot (plan §1 D7).
- Do NOT hardcode method-name string literals in this package — read
  them from the generated `ServerRequest` / `ServerNotification` unions.

## Tests

- `test/skeleton.test.ts` — type-level smoke (T3).
- `test/event-normalizer.test.ts` — T7a/T7b lifecycle + ordering.
- `test/method-names.test.ts` — T6 narrowing helper.
- `test/runtime.test.ts` — T8 typed wrappers.

All tests run via the default `pnpm test` unit project.

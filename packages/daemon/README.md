# @codex-im/daemon

Phase 1 supervisor module. Owns the codex App Server subprocess lifecycle:
spawns a fresh `Transport`, subscribes to `transport.onClose` BEFORE
constructing `AppServerClient`, builds the `{ transport, client, runtime,
broker }` quartet, and re-spawns the entire quartet on transport loss.

Mirrors `AppServerClient`'s ONE-SHOT lifecycle policy: when codex
crashes / restarts, the supervisor constructs a *new* quartet rather
than trying to restart in place. This avoids the half-applied-state
bugs documented in `packages/app-server-client/src/client.ts` JSDoc
("Lifecycle policy: ONE-SHOT").

Codex outside-voice B7 background: `AppServerClient` has no public
`onClose` API; close detection flows from `transport.onClose`. The
supervisor therefore holds the transport reference and subscribes
directly. No new public surface on `AppServerClient` is required —
the supervisor wraps the lifecycle from outside.

## Phase 1 scope

- T11a (this skeleton): owns transport spawn, subscribes to
  `transport.onClose`, constructs `{transport, client, runtime, broker}`
  quartet on every spawn. T11b adds the close-handling edge cases
  (idempotence, exponential backoff, halt-on-cascade, audit on fatal).
- `broker.reattach(client)` is the single API used to transfer the
  ApprovalBroker across a quartet swap. T9b's B-clean lifecycle
  guarantees `reattach` is race-free with respect to in-flight
  approvals.

## What is NOT in this package

- No IM adapter wiring (Phase 2+).
- No persistent storage / SQLite (Phase 2).
- No HTTP/WebSocket listener (Phase 8).
- No Computer Use production flow (Phase 6).
- No `process.exit` calls — the supervisor signals fatal via
  `audit.emitFatal()`; the host process decides what to do.

// @codex-im/daemon — public surface (T11a skeleton).
//
// Phase 1 fills this in incrementally:
//   - T11a (this commit): Supervisor skeleton — owns transport spawn,
//     subscribes to transport.onClose, constructs the
//     {transport, client, runtime, broker} quartet on every spawn.
//   - T11b: close-handling edges — idempotence, exponential backoff,
//     halt-on-cascade, audit on fatal.
//
// Each new export is a deliberate code-review checkpoint, mirroring the
// facade rule from @codex-im/protocol.

export { Daemon } from "./daemon.js";
export type { DaemonBroker, DaemonBrokerContext, DaemonOptions } from "./daemon.js";
export { Supervisor } from "./supervisor.js";
export type { SupervisorAudit, SupervisorOptions } from "./types.js";

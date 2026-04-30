// @codex-im/core — public surface (T5 skeleton).
//
// Phase 1 fills this in incrementally:
//   - T9a  adds ApprovalBroker + exhaustive Record<ServerRequest['method'],
//          DispatcherSpec> dispatch table + dispatch-coverage tests.
//   - T9b  adds reattach(client) for supervisor recovery, timeout/throw
//          edges, transport-loss propagation, per-method v2 response
//          mappers, and the no-method-literals build-time grep guard.
//
// Each new export is a deliberate code-review checkpoint, mirroring the
// facade rule from @codex-im/protocol.

export type {
  ApprovalActor,
  ApprovalDecision,
  ApprovalRecord,
  SecurityPolicy,
} from "./types.js";

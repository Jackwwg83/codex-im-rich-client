// @codex-im/core — public surface (T5 skeleton + T9a broker).
//
// Phase 1 fills this in incrementally:
//   - T9a  adds ApprovalBroker + exhaustive Record<ServerRequest['method'],
//          DispatcherSpec> dispatch table + dispatch-coverage tests.
//          DONE.
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
export { ApprovalBroker } from "./approval-broker.js";
export type { DispatcherSpec } from "./approval-broker.js";

// Phase 2 T2 — ApprovalRequestKind classifier (the only Phase 2 production
// source allowed to read raw approval server-request method strings; see
// `approval-request-kind.ts` header for the boundary rationale).
export { classifyApprovalRequest } from "./approval-request-kind.js";
export type { ApprovalRequestKind } from "./approval-request-kind.js";

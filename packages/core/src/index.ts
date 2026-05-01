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

// Phase 2 T6 — resolve / binding / snapshot / target type surface (D11 /
// D12 / D19 / D20). Public contracts T7 (broker emitters), T9
// (bindActorPolicy), T10 (decision mapper), T11 (broker.resolve()) consume.
// `Target` and `ApprovalUiAction` live here as canonical home; channel-core
// (T18) and render (T14) re-export type-only.
export type {
  ActorPolicy,
  ApprovalUiAction,
  BindError,
  BindResult,
  PendingApprovalSnapshot,
  ResolveApprovalInput,
  ResolveApprovalResult,
  ResolveError,
  Target,
} from "./types.js";

// Phase 2 T10 — UI action → decision intent translator (decoupled from
// protocol method literals; consumed by the daemon wire-up subscriber and
// internally by broker.resolve()).
export { actionToDecision } from "./action-to-decision.js";
// Phase 2 T10 — per-kind wire-mapping table (D11 corrected). resolve()
// consumes WireDecisionResult to settle the wire; renderer + audit consume
// it to surface unsupported / error branches.
export { mapDecisionForPending } from "./decision-mapper.js";
export type { WireDecisionResult } from "./decision-mapper.js";

// Phase 1 core — public type surface.
//
// T5 ships the skeleton types that T9a's ApprovalBroker consumes:
//   ApprovalDecision  — IM-layer outcome the broker maps to wire-level
//                       responses (per-method response shape varies, see
//                       05-CODEX-APP-SERVER-PROTOCOL.md §4.1).
//   ApprovalActor     — Phase 2 forward-compat slot (P1-1 from
//                       plan-eng-review). Phase 1 callers always pass
//                       null; the type already admits the system + im
//                       shapes so Phase 2 doesn't have to migrate
//                       existing audit rows.
//   ApprovalRecord    — broker bookkeeping for pending / resolved /
//                       expired / transport_lost approvals.
//   SecurityPolicy    — Phase 1 noop interface; Phase 3 fills in the
//                       white-list / deny-pattern / Computer-Use policy.
//
// Logic-bearing additions (single-handler invariant, exhaustive method
// dispatch table, per-method v2 response mappers, transport-loss
// idempotence) land in T9a + T9b.

/**
 * Decision the IM layer emits when the user resolves an approval.
 *
 * The broker (T9a/T9b) maps these to wire-level response shapes that
 * vary per method. Per 05-PROTOCOL §4.1, the legacy applyPatchApproval
 * and execCommandApproval methods return { decision: ReviewDecision }
 * but the v2 *RequestApproval methods may return method-specific
 * shapes — see packages/codex-protocol/src/generated/v2/
 * *RequestApprovalResponse.ts (now exposed via the @codex-im/protocol
 * facade per Pre-2).
 */
export type ApprovalDecision =
  | { kind: "approved" }
  | { kind: "approved_for_session" }
  | { kind: "denied"; reason?: string }
  | { kind: "abort" };

/**
 * Forward-compat slot for the IM actor that resolved the approval.
 *
 * Phase 1 callers always pass null (no IM layer yet). Phase 2 fills in
 * { kind: "im", platform, userId, chatId? } from the inbound action.
 * The system kind is reserved for non-IM-driven resolutions:
 *   - transport_lost (T11b): supervisor auto-fails pending approvals
 *   - expired         (T9b): expirePending() sweeps stale records
 *   - bootstrap       (Phase 3): security policy denies before user sees
 *
 * Putting all three kinds in the type now prevents a Phase 2 audit
 * migration. plan-eng-review P1-1.
 */
export type ApprovalActor =
  | null
  | { kind: "system"; reason: string }
  | { kind: "im"; platform: string; userId: string; chatId?: string };

/**
 * Broker's record of one approval round-trip. Exactly four lifecycle
 * states; resolved/expired/transport_lost are terminal.
 */
export type ApprovalRecord = {
  /** Stable internal id (broker-assigned; survives codex restarts). */
  id: string;
  /** The wire id codex sent on the server-initiated request. */
  appServerRequestId: string | number;
  /** Wire method name. Read from generated ServerRequest union; never
   *  hardcoded outside @codex-im/core (05-PROTOCOL §4 redline). */
  method: string;
  /** Verbatim params from the wire frame (audit + cross-version compat). */
  params: unknown;
  /**
   * Lifecycle:
   *   pending         — awaiting decision
   *   resolved        — user (or system) decided; decision is set
   *   expired         — sat past timeout; auto-denied per D6 spirit
   *   transport_lost  — supervisor saw transport close; auto-denied (D6)
   */
  status: "pending" | "resolved" | "expired" | "transport_lost";
  /** Phase 1: always null. Phase 2: filled in on resolve(). */
  actor: ApprovalActor;
  createdAt: Date;
  decidedAt?: Date;
  decision?: ApprovalDecision;
};

/**
 * Phase 1 noop interface. Phase 3 fills in:
 *   - allowed users / chats / projects
 *   - command deny-patterns
 *   - Computer Use safety policy (only triggered via /cu)
 *   - approval default-decision
 *
 * Keeping the interface here in T5 lets T9a / T9b stub it out via
 * dependency injection (rather than a `null` SecurityPolicy field that
 * Phase 3 would have to reshape).
 */
export interface SecurityPolicy {
  /** Phase 1 noop sentinel. Phase 3 widens this to a proper version
   *  union when the real policy lands. */
  readonly version: "phase1-noop";
}

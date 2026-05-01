// T14 (Phase 2) — ApprovalCard + ApprovalAction + ApprovalStatus +
// ApprovalTarget. Per-kind approval projection consumed by IM adapters
// (channel-core / im-telegram). Plain-text labels are English defaults;
// localization is adapter scope (D17 / 06-IM-ADAPTERS).
//
// Key invariants enforced by the type surface:
//   - `ApprovalAction` is structurally identical to core's
//     `ApprovalUiAction`, so daemon wire-up + renderer + resolve()
//     all speak the same UI vocabulary (the daemon's button click
//     becomes an InboundAction whose `uiAction` field is exactly
//     this shape).
//   - `kind` is the same `ApprovalRequestKind` enum the broker uses,
//     so the renderer never reads protocol method strings (F1
//     boundary). Includes "unknown" so the renderer-defensive C-P1
//     decline-only card has a kind to project from.
//   - `target.riskLevel` is a fixed taxonomy: low / moderate / high /
//     critical. The renderer can surface different visual treatment
//     per level; the broker fail-closes on "critical" with a decline-
//     only card.
//
// Note: `target` here is renderer-side risk-level metadata, distinct
// from core's `Target` (IM platform addressing — chatId, threadKey,
// topicId). They live in different layers and don't overlap.

import type { ApprovalRequestKind, ApprovalUiAction } from "@codex-im/core";

/**
 * The four UI actions a renderer can present. Structurally identical
 * to core's `ApprovalUiAction` (see core/src/types.ts) so the daemon
 * wire-up, renderer, and broker.resolve() can pass the same value
 * around without translation. Re-exported as a convenience and to
 * give renderer-side code a more semantic name.
 */
export type ApprovalAction = ApprovalUiAction;

/**
 * The four lifecycle states an approval card can present. Mirrors
 * `ApprovalRecord.status` so the renderer can subscribe to
 * `onPendingResolved` and update the rendered card with the new
 * status (typically by editing the IM message in place).
 */
export type ApprovalStatus = "pending" | "resolved" | "expired" | "transport_lost";

/**
 * Renderer-side risk metadata. Phase 2 uses a fixed 4-level taxonomy
 * (low / moderate / high / critical). The classifier-defensive
 * unknown-kind card uses "critical" per C-P1 alignment. Phase 3 may
 * derive risk from params content (e.g. command_execution with a
 * filesystem-write argv → high) — Phase 2 leaves it to the daemon
 * wire-up to compute and pass.
 *
 * Distinct from core's `Target` (IM addressing). The two never overlap:
 * `Target` lives in the InboundAction / ResolveApprovalInput plumbing;
 * `ApprovalTarget` lives only inside the rendered card.
 */
export type ApprovalTarget = {
  readonly riskLevel: "low" | "moderate" | "high" | "critical";
};

/**
 * One renderable approval card. The renderer projects a
 * `PendingApprovalSnapshot` (from core's `listPending` / public
 * subscriber payload) into this shape via `projectAsRichBlock` (T15).
 *
 * `actions` lists ONLY the UI actions whose wire-mapping is supported
 * for this kind in Phase 2 — the renderer MUST NOT surface buttons the
 * mapper would reject. C-P1 unknown-kind cards carry only `[{kind:"decline"}]`.
 */
export type ApprovalCard = {
  /**
   * Schema version. Phase 2 = "approval-card.v1"; bumped when the
   * card shape changes in a breaking way so adapters can refuse to
   * render unfamiliar versions instead of silently mis-displaying.
   */
  readonly schemaVersion: "approval-card.v1";
  readonly kind: ApprovalRequestKind;
  readonly approvalId: string;
  readonly summary: string;
  readonly target: ApprovalTarget;
  readonly actions: readonly ApprovalAction[];
  readonly status: ApprovalStatus;
  readonly createdAt: Date;
};

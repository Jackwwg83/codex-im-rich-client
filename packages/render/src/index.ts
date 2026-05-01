// @codex-im/render — public surface (T13 skeleton + T14 types).
//
// Phase 2 fills this in incrementally:
//   - T14  RichBlock discriminated union (text / approval / unknown);
//          ApprovalCard shape; ApprovalAction (= core's ApprovalUiAction).
//   - T15  project-approval.ts — switches on ApprovalRequestKind from
//          @codex-im/core (NOT on protocol method strings) to render
//          a per-kind ApprovalCard.
//   - T16  redact-aware projection helpers + RichBlock projection
//          (incl. C-P1 decline-only unknown-kind card).
//   - T17  plain-text capability fallback.
//
// Method-literal boundary (CLAUDE.md F1): this package MUST NOT contain
// any of the 9 ServerRequest method strings. Only `approval-broker.ts`
// (DispatchTable) and `approval-request-kind.ts` (METHOD_TO_KIND) in
// @codex-im/core may. Renderer switches on the classifier kind.

// T14: RichBlock + ApprovalCard surface.
export type { RichBlock } from "./rich-block.js";
export type {
  ApprovalAction,
  ApprovalCard,
  ApprovalStatus,
  ApprovalTarget,
} from "./approval-card.js";

// T15: pure utilities used by T16 projection — truncate (byte-bounded UTF-8
// safe) + redact (re-exported from @codex-im/core; canonical home is core
// per F10 / Codex Q5).
export { truncate } from "./truncate.js";
export type { TruncateOptions } from "./truncate.js";
export { redact } from "./redact.js";

// T16: per-kind ApprovalCard projection + RichBlock wrapper. Switches on
// ApprovalRequestKind from core.classifyApprovalRequest (NOT on protocol
// method strings — F1 boundary). C-P1 unknown-defensive decline-only card.
export { projectApprovalCard, projectAsRichBlock } from "./project-approval.js";
export type { ProjectApprovalOptions } from "./project-approval.js";

// T17: plain-text capability fallback. Adapters without inline keyboards
// or webhook-only setups consume this; English defaults per Codex Q1
// (localization is adapter scope per D17).
export { formatPlainText } from "./plain-text.js";
export type { ChannelCapabilities } from "./plain-text.js";

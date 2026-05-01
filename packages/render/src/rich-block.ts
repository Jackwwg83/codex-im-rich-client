// T14 (Phase 2) — RichBlock discriminated union.
//
// Platform-agnostic projection emitted by EventNormalizer (Phase 2
// minimum: text / approval / unknown). Channel adapters consume this
// shape and translate to platform-native message bodies (Telegram
// inline keyboard, Lark interactive card, DingTalk action card).
//
// Phase 2 minimum coverage:
//   text     — turn streaming + completion text fragments
//   approval — server-request approval projection (broker pending)
//   unknown  — defensive fallback for ServerNotification arms the
//              normalizer doesn't model yet. NOT used for unknown
//              approval methods (C-P1 alignment: those project to
//              `approval` with kind="unknown" + decline-only card).
//
// Phase 3+ may add: tool_progress, file_diff, review_summary, etc.
// The discriminated union shape lets new arms land additively.

import type { ApprovalCard } from "./approval-card.js";

export type RichBlock =
  | { type: "text"; text: string }
  | { type: "approval"; card: ApprovalCard }
  | { type: "unknown"; reason: string };

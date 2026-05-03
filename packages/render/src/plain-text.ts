// T17 (Phase 2) — plain-text capability fallback for IM adapters
// without inline keyboards or that need a text-only fallback.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T17
// (Codex Q1 / gstack Q1)
//
// Output is English by default — adapter scope owns localization
// (D17 / 06-IM-ADAPTERS). Adapters that DO support inline keyboards
// (Telegram inline buttons, Lark interactive cards) still call this
// helper for the message body; the buttons render separately and the
// body suppresses the slash-command hint list.
//
// Capability matrix:
//   supportsButtons   — adapter renders inline buttons; body may include the
//                       approval id because the secure buttons carry the action.
//                       When false, Phase 7 renders a non-actionable fallback
//                       and hides raw approval ids / callback tokens.
//   canEditMessage    — adapter can edit the existing message body
//                       on resolve; footer reads "this message will
//                       update". When false, footer reads "we'll
//                       post a follow-up".
//
// Status-aware:
//   pending → non-actionable fallback (if !supportsButtons) + "what happens next"
//   resolved / expired / transport_lost → status line only, no hints

import type { ApprovalCard, ApprovalStatus } from "./approval-card.js";

export type ChannelCapabilities = {
  readonly supportsButtons: boolean;
  readonly canEditMessage: boolean;
};

const RISK_LABEL: Record<ApprovalCard["target"]["riskLevel"], string> = {
  low: "LOW",
  moderate: "MODERATE",
  high: "HIGH",
  critical: "CRITICAL",
};

const STATUS_LINE: Record<Exclude<ApprovalStatus, "pending">, string> = {
  resolved: "Status: resolved (decision already made).",
  expired: "Status: expired (no decision in time).",
  transport_lost: "Status: transport lost (codex disconnected before a decision was made).",
};

export function formatPlainText(card: ApprovalCard, caps: ChannelCapabilities): string {
  const lines: string[] = [];
  const approvalIdSuffix = caps.supportsButtons ? `: ${card.approvalId}` : "";
  lines.push(`[${RISK_LABEL[card.target.riskLevel]} risk] Approval needed${approvalIdSuffix}`);
  lines.push("");
  lines.push(card.summary);

  if (card.status === "pending") {
    if (!caps.supportsButtons) {
      lines.push("");
      lines.push("Decision controls are unavailable in this channel.");
      lines.push("Open an approved channel with secure buttons to decide this request.");
    }
    lines.push("");
    if (caps.canEditMessage) {
      lines.push("This message will update when the request is decided.");
    } else {
      lines.push("We'll post a follow-up when the request is decided.");
    }
  } else {
    lines.push("");
    lines.push(STATUS_LINE[card.status]);
  }

  return lines.join("\n");
}

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
//   supportsButtons   — adapter renders inline buttons; body skips
//                       the "/allow_once /decline …" hint list
//   canEditMessage    — adapter can edit the existing message body
//                       on resolve; footer reads "this message will
//                       update". When false, footer reads "we'll
//                       post a follow-up".
//
// Status-aware:
//   pending → action hints (if !supportsButtons) + "what happens next"
//   resolved / expired / transport_lost → status line only, no hints

import type { ApprovalAction, ApprovalCard, ApprovalStatus } from "./approval-card.js";

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

const ACTION_LABEL: Record<ApprovalAction["kind"], string> = {
  allow_once: "Approve once",
  allow_session: "Approve for the rest of this session",
  decline: "Decline",
  abort: "Abort the turn",
};

const STATUS_LINE: Record<Exclude<ApprovalStatus, "pending">, string> = {
  resolved: "Status: resolved (decision already made).",
  expired: "Status: expired (no decision in time).",
  transport_lost: "Status: transport lost (codex disconnected before a decision was made).",
};

export function formatPlainText(card: ApprovalCard, caps: ChannelCapabilities): string {
  const lines: string[] = [];
  lines.push(`[${RISK_LABEL[card.target.riskLevel]} risk] Approval needed: ${card.approvalId}`);
  lines.push("");
  lines.push(card.summary);

  if (card.status === "pending") {
    if (!caps.supportsButtons && card.actions.length > 0) {
      lines.push("");
      lines.push("Choose:");
      for (const action of card.actions) {
        lines.push(`  /${action.kind}  — ${ACTION_LABEL[action.kind]}`);
      }
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

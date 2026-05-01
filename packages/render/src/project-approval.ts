// T16 (Phase 2) — PendingApprovalSnapshot → ApprovalCard projection.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T16
// (D11 supported subset / F1 boundary preservation / C-P1 alignment / gstack T-G1)
//
// Switch on `ApprovalRequestKind` from core.classifyApprovalRequest —
// NEVER on `snapshot.method`. Method literals are confined to
// approval-broker.ts (DispatchTable) and approval-request-kind.ts
// (METHOD_TO_KIND). T20 grep guard will assert this file contains
// none of the 9 ServerRequest method strings.
//
// Per-kind config table (KIND_TABLE) drives:
//   - actions       — D11 supported (kind, action) subset
//   - riskLevel     — Phase 2 risk taxonomy
//   - summarize     — kind-appropriate human label, with optional
//                     params projection (redacted + truncated)
//
// Renderer-defensive fallback for `unknown` kind (C-P1): decline-only,
// critical risk, default-decline summary. Broker's #handle already
// fails-closed at the protocol layer (-32601 + audit, no PendingEntry),
// so the renderer should never see an unknown snapshot in production —
// this is a belt-and-braces second line of defense.

import {
  type ApprovalRequestKind,
  type ApprovalUiAction,
  type PendingApprovalSnapshot,
  classifyApprovalRequest,
  redact,
} from "@codex-im/core";
import type { ApprovalAction, ApprovalCard, ApprovalStatus } from "./approval-card.js";
import type { RichBlock } from "./rich-block.js";
import { truncate } from "./truncate.js";

const SUMMARY_BYTE_LIMIT = 1024;

const ALL_FOUR: readonly ApprovalAction[] = [
  { kind: "allow_once" },
  { kind: "allow_session" },
  { kind: "decline" },
  { kind: "abort" },
];
const DECLINE_ONLY: readonly ApprovalAction[] = [{ kind: "decline" }];
const DECLINE_ABORT: readonly ApprovalAction[] = [{ kind: "decline" }, { kind: "abort" }];
const NO_ACTIONS: readonly ApprovalAction[] = [];

type RiskLevel = "low" | "moderate" | "high" | "critical";

type KindSpec = {
  readonly actions: readonly ApprovalAction[];
  readonly riskLevel: RiskLevel;
  readonly summarize: (snap: PendingApprovalSnapshot) => string;
};

function readString(params: unknown, key: string): string | null {
  if (typeof params !== "object" || params === null) return null;
  const v = (params as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

const KIND_TABLE: Record<ApprovalRequestKind, KindSpec> = {
  command_execution: {
    actions: ALL_FOUR,
    riskLevel: "high",
    summarize: (snap) => {
      const cmd = readString(snap.params, "commandLineExpanded") ?? "(no command supplied)";
      return `Run command: ${cmd}`;
    },
  },
  file_change: {
    actions: ALL_FOUR,
    riskLevel: "moderate",
    summarize: () => "Apply file change",
  },
  permissions: {
    actions: DECLINE_ONLY,
    riskLevel: "high",
    summarize: () => "Grant additional permissions for this turn",
  },
  tool_user_input: {
    actions: DECLINE_ONLY,
    riskLevel: "low",
    summarize: () => "Tool requested user input (Phase 2 cannot answer interactively)",
  },
  tool_call: {
    actions: DECLINE_ONLY,
    riskLevel: "critical",
    summarize: () => "Computer Use tool call (disabled in Phase 2)",
  },
  mcp_elicitation: {
    actions: DECLINE_ABORT,
    riskLevel: "low",
    summarize: () => "MCP server elicitation",
  },
  legacy_apply_patch: {
    actions: ALL_FOUR,
    riskLevel: "high",
    summarize: () => "Legacy: apply patch",
  },
  legacy_exec_command: {
    actions: ALL_FOUR,
    riskLevel: "high",
    summarize: () => "Legacy: execute command",
  },
  auth_token_refresh: {
    actions: NO_ACTIONS,
    riskLevel: "low",
    summarize: () =>
      "ChatGPT auth token refresh (Phase 2 cannot fabricate tokens; broker default-rejects)",
  },
  unknown: {
    actions: DECLINE_ONLY,
    riskLevel: "critical",
    summarize: () =>
      "Unknown approval request kind; default-decline. Adapter should display this as read-only.",
  },
};

export type ProjectApprovalOptions = {
  /**
   * Lifecycle status to embed in the projected card. Defaults to
   * "pending" — the renderer-side typical case. Pass "resolved" /
   * "expired" / "transport_lost" when re-rendering an already-settled
   * card (e.g. an `onPendingResolved` subscriber editing the IM
   * message in place).
   */
  status?: ApprovalStatus;
  /**
   * Override the per-kind summary byte budget. Phase 2 default 1024
   * bytes (well under Telegram 4096-char body, comfortably above
   * Lark/DingTalk per-element limits). Tests pass a small value to
   * exercise truncation deterministically.
   */
  summaryByteLimit?: number;
};

/**
 * Project a `PendingApprovalSnapshot` to a renderable `ApprovalCard`.
 * Pure function — no broker state mutation, no IO. Call once per
 * `onPendingCreated` event, then again per `onPendingResolved` to
 * re-render with the new status.
 */
export function projectApprovalCard(
  snapshot: PendingApprovalSnapshot,
  opts: ProjectApprovalOptions = {},
): ApprovalCard {
  const kind = classifyApprovalRequest(snapshot.method);
  const spec = KIND_TABLE[kind];
  const limit = opts.summaryByteLimit ?? SUMMARY_BYTE_LIMIT;
  const rawSummary = spec.summarize(snapshot);
  const redacted = redact(rawSummary);
  const summary = truncate(redacted, limit);
  return {
    schemaVersion: "approval-card.v1",
    kind,
    approvalId: snapshot.id,
    summary,
    target: { riskLevel: spec.riskLevel },
    actions: spec.actions,
    status: opts.status ?? "pending",
    createdAt: snapshot.createdAt,
  };
}

/**
 * Wrap `projectApprovalCard` in a RichBlock envelope so the
 * EventNormalizer can emit a uniform stream without branching on
 * approval-vs-text at the call site. Always emits `{type: "approval", card}`
 * — the `RichBlock.unknown` arm is reserved for non-approval future
 * use cases (e.g. unknown ServerNotification arms).
 */
export function projectAsRichBlock(
  snapshot: PendingApprovalSnapshot,
  opts: ProjectApprovalOptions = {},
): RichBlock {
  return { type: "approval", card: projectApprovalCard(snapshot, opts) };
}

// Re-export ApprovalUiAction type for convenience (renderer consumers
// often want both the projection function and the UI action type).
export type { ApprovalUiAction };

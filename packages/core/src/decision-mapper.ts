// T10 (Phase 2) — per-ApprovalRequestKind wire-mapping table (D11 corrected).
//
// Maps a pending ApprovalRecord + ApprovalUiAction → wire response shape per
// codex's generated v2 + legacy types. The mapper is per-KIND (not per-
// method-string) so it can stay below the method-literal boundary; only
// `classifyApprovalRequest` knows about protocol method strings, and only
// inside this module does kind-discrimination happen.
//
// Three return shapes:
//   {kind:"ok", value}           — wire shape ready for settleOnce({type:"resolve", value})
//   {kind:"error", error}        — JsonRpcResponseError to send via Pre-3 catch arm
//                                  (auth_token_refresh always errors with -32601)
//   {kind:"unsupported", reason} — resolve() returns ResolveError without
//                                  settling the wire; caller decides next step
//                                  (Phase 2 audits + returns unsupported_decision)
//
// D11 table for Phase 2 supported (kind, action) pairs lives below in
// `KIND_DISPATCH`. Anything not in the table maps to unsupported.

import { JsonRpcResponseError } from "@codex-im/app-server-client";
import { type ApprovalRequestKind, classifyApprovalRequest } from "./approval-request-kind.js";
import type { ApprovalRecord, ApprovalUiAction } from "./types.js";

export type WireDecisionResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: JsonRpcResponseError }
  | { kind: "unsupported"; reason: string };

type ActionKind = ApprovalUiAction["kind"];

/**
 * Per-kind dispatch. Each cell is a function so kinds with computed
 * shapes (none in Phase 2, but permissions param-aware mapping in Phase
 * 3) can read `record.params` without changing the table layout. A null
 * value means "not in Phase 2 supported subset" — returned as
 * {kind:"unsupported"}.
 */
type CellFn = (record: ApprovalRecord) => unknown;
type KindRow = Partial<Record<ActionKind, CellFn>>;

const KIND_DISPATCH: Record<Exclude<ApprovalRequestKind, "unknown">, KindRow> = {
  command_execution: {
    allow_once: () => ({ decision: "accept" }),
    allow_session: () => ({ decision: "acceptForSession" }),
    decline: () => ({ decision: "decline" }),
    abort: () => ({ decision: "cancel" }),
  },
  file_change: {
    allow_once: () => ({ decision: "accept" }),
    allow_session: () => ({ decision: "acceptForSession" }),
    decline: () => ({ decision: "decline" }),
    abort: () => ({ decision: "cancel" }),
  },
  permissions: {
    decline: () => ({ permissions: {}, scope: "turn" }),
  },
  tool_user_input: {
    decline: () => ({ answers: {} }),
  },
  tool_call: {
    decline: () => ({ contentItems: [], success: false }),
  },
  mcp_elicitation: {
    decline: () => ({ action: "decline", content: null, _meta: null }),
    abort: () => ({ action: "cancel", content: null, _meta: null }),
  },
  legacy_apply_patch: {
    allow_once: () => ({ decision: "approved" }),
    allow_session: () => ({ decision: "approved_for_session" }),
    decline: () => ({ decision: "denied" }),
    abort: () => ({ decision: "abort" }),
  },
  legacy_exec_command: {
    allow_once: () => ({ decision: "approved" }),
    allow_session: () => ({ decision: "approved_for_session" }),
    decline: () => ({ decision: "denied" }),
    abort: () => ({ decision: "abort" }),
  },
  // auth_token_refresh always errors regardless of action (handled below).
  auth_token_refresh: {},
};

export function mapDecisionForPending(
  record: ApprovalRecord,
  uiAction: ApprovalUiAction,
): WireDecisionResult {
  const kind = classifyApprovalRequest(record.method);
  if (kind === "auth_token_refresh") {
    return {
      kind: "error",
      error: new JsonRpcResponseError({
        code: -32601,
        message: "auth refresh not supported in Phase 1",
      }),
    };
  }
  if (kind === "unknown") {
    return { kind: "unsupported", reason: `unknown method ${record.method}` };
  }
  const row = KIND_DISPATCH[kind];
  const cell = row[uiAction.kind];
  if (cell === undefined) {
    return {
      kind: "unsupported",
      reason: `${kind} kind does not support ${uiAction.kind} in Phase 2`,
    };
  }
  return { kind: "ok", value: cell(record) };
}

// T10 (Phase 2) — decision-mapper type-shape regression test.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T10 / D11
//
// Per supported (kind, action) pair declares a `_v2_*` constant typed against
// the real generated response shape. If codex 0.126 widens or narrows a wire
// shape, this file fails to compile — making protocol drift a build-time error
// instead of a runtime mystery.

import type {
  ApplyPatchApprovalResponse,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallResponse,
  ExecCommandApprovalResponse,
  FileChangeRequestApprovalResponse,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalResponse,
  ToolRequestUserInputResponse,
} from "@codex-im/protocol";
import { describe, expect, it } from "vitest";

// command_execution
const _v2_cmd_accept: CommandExecutionRequestApprovalResponse = { decision: "accept" };
const _v2_cmd_acceptForSession: CommandExecutionRequestApprovalResponse = {
  decision: "acceptForSession",
};
const _v2_cmd_decline: CommandExecutionRequestApprovalResponse = { decision: "decline" };
const _v2_cmd_cancel: CommandExecutionRequestApprovalResponse = { decision: "cancel" };

// file_change
const _v2_fc_accept: FileChangeRequestApprovalResponse = { decision: "accept" };
const _v2_fc_acceptForSession: FileChangeRequestApprovalResponse = {
  decision: "acceptForSession",
};
const _v2_fc_decline: FileChangeRequestApprovalResponse = { decision: "decline" };
const _v2_fc_cancel: FileChangeRequestApprovalResponse = { decision: "cancel" };

// permissions (only decline supported in Phase 2)
const _v2_perm_decline: PermissionsRequestApprovalResponse = { permissions: {}, scope: "turn" };

// tool_user_input (only decline supported)
const _v2_tui_decline: ToolRequestUserInputResponse = { answers: {} };

// tool_call (only decline supported)
const _v2_tc_decline: DynamicToolCallResponse = { contentItems: [], success: false };

// mcp_elicitation (decline + abort)
const _v2_mcp_decline: McpServerElicitationRequestResponse = {
  action: "decline",
  content: null,
  _meta: null,
};
const _v2_mcp_cancel: McpServerElicitationRequestResponse = {
  action: "cancel",
  content: null,
  _meta: null,
};

// legacy_apply_patch
const _v2_legacy_patch_approved: ApplyPatchApprovalResponse = { decision: "approved" };
const _v2_legacy_patch_approved_for_session: ApplyPatchApprovalResponse = {
  decision: "approved_for_session",
};
const _v2_legacy_patch_denied: ApplyPatchApprovalResponse = { decision: "denied" };
const _v2_legacy_patch_abort: ApplyPatchApprovalResponse = { decision: "abort" };

// legacy_exec_command
const _v2_legacy_exec_approved: ExecCommandApprovalResponse = { decision: "approved" };
const _v2_legacy_exec_approved_for_session: ExecCommandApprovalResponse = {
  decision: "approved_for_session",
};
const _v2_legacy_exec_denied: ExecCommandApprovalResponse = { decision: "denied" };
const _v2_legacy_exec_abort: ExecCommandApprovalResponse = { decision: "abort" };

describe("decision-mapper wire shapes (T10 type-only regression)", () => {
  it("all _v2_* constants compile against generated protocol types", () => {
    // The compile-time assertion IS the test. Runtime body just touches
    // every constant so unused-variable lints don't strip the imports.
    const all = [
      _v2_cmd_accept,
      _v2_cmd_acceptForSession,
      _v2_cmd_decline,
      _v2_cmd_cancel,
      _v2_fc_accept,
      _v2_fc_acceptForSession,
      _v2_fc_decline,
      _v2_fc_cancel,
      _v2_perm_decline,
      _v2_tui_decline,
      _v2_tc_decline,
      _v2_mcp_decline,
      _v2_mcp_cancel,
      _v2_legacy_patch_approved,
      _v2_legacy_patch_approved_for_session,
      _v2_legacy_patch_denied,
      _v2_legacy_patch_abort,
      _v2_legacy_exec_approved,
      _v2_legacy_exec_approved_for_session,
      _v2_legacy_exec_denied,
      _v2_legacy_exec_abort,
    ];
    expect(all.length).toBe(21);
  });
});

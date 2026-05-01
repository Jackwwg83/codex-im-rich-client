// T2.1 (Phase 2) — failing test for the ApprovalRequestKind classifier.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T2.1
//
// `approval-request-kind.ts` is the ONLY Phase 2 production source file
// allowed to contain raw ServerRequest method-name string literals. The
// classifier maps raw method strings → method-free `ApprovalRequestKind`,
// which is what the renderer, decision-mapper, channel adapter, and
// downstream IM code switch on. Renderer/mapper/adapter never touch
// raw protocol method strings (Codex round-1 P0-1 / round-2 C1).
//
// This test file lives in packages/core/test/ which is OUTSIDE the
// no-method-literals grep guard's scope (packages/{app-server-client,
// codex-runtime,daemon,cli}/src/**), so the 10 method literals below
// are legitimate.
//
// Evidence source: the 9 known method strings come from the Phase 1
// `DispatchTable` keys in packages/core/src/approval-broker.ts (lines
// 113-140), which are validated as exhaustive over `ServerRequest["method"]`
// from packages/codex-protocol/src/generated/ServerRequest.ts via the
// `_ExhaustiveDispatch` type-level guard. The synthetic
// `"future/unseen/method"` follows Phase 1 T9b's convention for
// unknown-method fixtures (CLAUDE.md "Method literal policy" allowed
// exception for synthetic test method names).
//
// TDD posture: this test is written BEFORE the classifier exists. The
// expected failure is "module not found" / missing export, NOT a
// guessed-method-name mismatch.

import { describe, expect, it } from "vitest";
import { type ApprovalRequestKind, classifyApprovalRequest } from "../src/approval-request-kind.js";

describe("@codex-im/core ApprovalRequestKind classifier (T2.1)", () => {
  it("classifies item/commandExecution/requestApproval → command_execution", () => {
    expect(classifyApprovalRequest("item/commandExecution/requestApproval")).toBe(
      "command_execution",
    );
  });

  it("classifies item/fileChange/requestApproval → file_change", () => {
    expect(classifyApprovalRequest("item/fileChange/requestApproval")).toBe("file_change");
  });

  it("classifies item/permissions/requestApproval → permissions", () => {
    expect(classifyApprovalRequest("item/permissions/requestApproval")).toBe("permissions");
  });

  it("classifies item/tool/requestUserInput → tool_user_input", () => {
    expect(classifyApprovalRequest("item/tool/requestUserInput")).toBe("tool_user_input");
  });

  it("classifies item/tool/call → tool_call", () => {
    expect(classifyApprovalRequest("item/tool/call")).toBe("tool_call");
  });

  it("classifies mcpServer/elicitation/request → mcp_elicitation", () => {
    expect(classifyApprovalRequest("mcpServer/elicitation/request")).toBe("mcp_elicitation");
  });

  it("classifies applyPatchApproval (legacy) → legacy_apply_patch", () => {
    expect(classifyApprovalRequest("applyPatchApproval")).toBe("legacy_apply_patch");
  });

  it("classifies execCommandApproval (legacy) → legacy_exec_command", () => {
    expect(classifyApprovalRequest("execCommandApproval")).toBe("legacy_exec_command");
  });

  it("classifies account/chatgptAuthTokens/refresh → auth_token_refresh", () => {
    expect(classifyApprovalRequest("account/chatgptAuthTokens/refresh")).toBe("auth_token_refresh");
  });

  it("classifies a synthetic future method → unknown (fail-closed default)", () => {
    expect(classifyApprovalRequest("future/unseen/method")).toBe("unknown");
  });

  it("classifies the empty string → unknown (defensive)", () => {
    expect(classifyApprovalRequest("")).toBe("unknown");
  });

  it("ApprovalRequestKind is the exact 10-kind union (compile-time guard)", () => {
    // Each known kind must be assignable to ApprovalRequestKind. If a
    // maintainer renames or drops a variant, this fails to compile —
    // mirrors the Phase 1 skeleton.test.ts ApprovalActor/ApprovalDecision
    // pattern.
    const all: ApprovalRequestKind[] = [
      "command_execution",
      "file_change",
      "permissions",
      "tool_user_input",
      "tool_call",
      "mcp_elicitation",
      "legacy_apply_patch",
      "legacy_exec_command",
      "auth_token_refresh",
      "unknown",
    ];
    expect(all.length).toBe(10);
  });

  it("ApprovalRequestKind rejects unknown kinds at the type level (compile-time guard)", () => {
    // This @ts-expect-error is the assertion: the type must NOT admit
    // an 11th kind. If a future maintainer accidentally widens
    // ApprovalRequestKind, this fails to compile.
    // @ts-expect-error — kind not in the 10-arm union must not be assignable
    const bad: ApprovalRequestKind = "computer_use_app";
    expect(bad).toBeDefined();
  });
});

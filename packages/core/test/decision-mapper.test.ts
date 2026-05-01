// T10 (Phase 2) — mapDecisionForPending per-kind table.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T10 / D11
//
// Per-ApprovalRequestKind mapper from ApprovalUiAction → wire shape. Returns
// {kind:"ok", value} for supported (kind,action), {kind:"unsupported", reason}
// for declined-only / accept-only kinds, {kind:"error", error} for
// auth_token_refresh (-32601). Phase 2 supports the bold cells of D11's table;
// the rest return unsupported.

import { JsonRpcResponseError } from "@codex-im/app-server-client";
import { describe, expect, it } from "vitest";
import { mapDecisionForPending } from "../src/decision-mapper.js";
import type { ApprovalRecord, ApprovalUiAction } from "../src/types.js";

function recordWith(method: string): ApprovalRecord {
  const now = new Date();
  return {
    id: `approval-${method}`,
    appServerRequestId: 1,
    method,
    params: {},
    status: "pending",
    actor: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

describe("mapDecisionForPending (T10 / D11)", () => {
  // ─── command_execution ───────────────────────────────────────────────
  describe("command_execution kind", () => {
    const r = recordWith("item/commandExecution/requestApproval");
    it("allow_once → {decision: 'accept'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" })).toEqual({
        kind: "ok",
        value: { decision: "accept" },
      });
    });
    it("allow_session → {decision: 'acceptForSession'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_session" })).toEqual({
        kind: "ok",
        value: { decision: "acceptForSession" },
      });
    });
    it("decline → {decision: 'decline'}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { decision: "decline" },
      });
    });
    it("abort → {decision: 'cancel'}", () => {
      expect(mapDecisionForPending(r, { kind: "abort" })).toEqual({
        kind: "ok",
        value: { decision: "cancel" },
      });
    });
  });

  // ─── file_change ─────────────────────────────────────────────────────
  describe("file_change kind", () => {
    const r = recordWith("item/fileChange/requestApproval");
    it("allow_once → {decision: 'accept'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" })).toEqual({
        kind: "ok",
        value: { decision: "accept" },
      });
    });
    it("allow_session → {decision: 'acceptForSession'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_session" })).toEqual({
        kind: "ok",
        value: { decision: "acceptForSession" },
      });
    });
    it("decline → {decision: 'decline'}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { decision: "decline" },
      });
    });
    it("abort → {decision: 'cancel'}", () => {
      expect(mapDecisionForPending(r, { kind: "abort" })).toEqual({
        kind: "ok",
        value: { decision: "cancel" },
      });
    });
  });

  // ─── permissions ─────────────────────────────────────────────────────
  describe("permissions kind", () => {
    const r = recordWith("item/permissions/requestApproval");
    it("decline → {permissions: {}, scope: 'turn'}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { permissions: {}, scope: "turn" },
      });
    });
    it("allow_once → unsupported (Phase 2 doesn't model permission shape)", () => {
      const result = mapDecisionForPending(r, { kind: "allow_once" });
      expect(result.kind).toBe("unsupported");
    });
    it("allow_session → unsupported", () => {
      expect(mapDecisionForPending(r, { kind: "allow_session" }).kind).toBe("unsupported");
    });
    it("abort → unsupported", () => {
      expect(mapDecisionForPending(r, { kind: "abort" }).kind).toBe("unsupported");
    });
  });

  // ─── tool_user_input ─────────────────────────────────────────────────
  describe("tool_user_input kind", () => {
    const r = recordWith("item/tool/requestUserInput");
    it("decline → {answers: {}}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { answers: {} },
      });
    });
    it("allow_once → unsupported (needs typed answers)", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" }).kind).toBe("unsupported");
    });
    it("abort → unsupported", () => {
      expect(mapDecisionForPending(r, { kind: "abort" }).kind).toBe("unsupported");
    });
  });

  // ─── tool_call (Computer Use) ────────────────────────────────────────
  describe("tool_call kind", () => {
    const r = recordWith("item/tool/call");
    it("decline → {contentItems: [], success: false}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { contentItems: [], success: false },
      });
    });
    it("allow_once → unsupported (Phase 6 scope)", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" }).kind).toBe("unsupported");
    });
  });

  // ─── mcp_elicitation ─────────────────────────────────────────────────
  describe("mcp_elicitation kind", () => {
    const r = recordWith("mcpServer/elicitation/request");
    it("decline → {action: 'decline', content: null, _meta: null}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { action: "decline", content: null, _meta: null },
      });
    });
    it("abort → {action: 'cancel', content: null, _meta: null}", () => {
      expect(mapDecisionForPending(r, { kind: "abort" })).toEqual({
        kind: "ok",
        value: { action: "cancel", content: null, _meta: null },
      });
    });
    it("allow_once → unsupported (needs accept content)", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" }).kind).toBe("unsupported");
    });
  });

  // ─── legacy_apply_patch ──────────────────────────────────────────────
  describe("legacy_apply_patch kind", () => {
    const r = recordWith("applyPatchApproval");
    it("allow_once → {decision: 'approved'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" })).toEqual({
        kind: "ok",
        value: { decision: "approved" },
      });
    });
    it("allow_session → {decision: 'approved_for_session'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_session" })).toEqual({
        kind: "ok",
        value: { decision: "approved_for_session" },
      });
    });
    it("decline → {decision: 'denied'}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { decision: "denied" },
      });
    });
    it("abort → {decision: 'abort'}", () => {
      expect(mapDecisionForPending(r, { kind: "abort" })).toEqual({
        kind: "ok",
        value: { decision: "abort" },
      });
    });
  });

  // ─── legacy_exec_command ─────────────────────────────────────────────
  describe("legacy_exec_command kind", () => {
    const r = recordWith("execCommandApproval");
    it("allow_once → {decision: 'approved'}", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" })).toEqual({
        kind: "ok",
        value: { decision: "approved" },
      });
    });
    it("decline → {decision: 'denied'}", () => {
      expect(mapDecisionForPending(r, { kind: "decline" })).toEqual({
        kind: "ok",
        value: { decision: "denied" },
      });
    });
  });

  // ─── auth_token_refresh ──────────────────────────────────────────────
  describe("auth_token_refresh kind (always errors -32601)", () => {
    const r = recordWith("account/chatgptAuthTokens/refresh");
    const actions: ApprovalUiAction[] = [
      { kind: "allow_once" },
      { kind: "allow_session" },
      { kind: "decline" },
      { kind: "abort" },
    ];
    for (const action of actions) {
      it(`${action.kind} → JsonRpcResponseError(-32601)`, () => {
        const result = mapDecisionForPending(r, action);
        expect(result.kind).toBe("error");
        if (result.kind === "error") {
          expect(result.error).toBeInstanceOf(JsonRpcResponseError);
          expect(result.error.code).toBe(-32601);
        }
      });
    }
  });

  // ─── unknown method ──────────────────────────────────────────────────
  describe("unknown kind", () => {
    const r = recordWith("future/unseen/method");
    it("allow_once → unsupported", () => {
      expect(mapDecisionForPending(r, { kind: "allow_once" }).kind).toBe("unsupported");
    });
    it("decline → unsupported", () => {
      expect(mapDecisionForPending(r, { kind: "decline" }).kind).toBe("unsupported");
    });
  });
});

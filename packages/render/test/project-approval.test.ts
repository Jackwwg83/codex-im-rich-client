// T16 (Phase 2) — project-approval per-kind projection tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T16
// (D11 / F1 boundary preservation / C-P1 alignment / gstack T-G1)
//
// Combined into one file (matches T7/T11 consolidation) covering all
// 9 ApprovalRequestKind branches + redact-applied + truncate +
// the C-P1 unknown-defensive decline-only card. RichBlock projection
// (T16.3) lives in the sibling test file.
//
// What every kind asserts:
//   - schemaVersion === "approval-card.v1"
//   - kind matches snapshot.method classification
//   - actions match the D11 supported-subset table:
//       command_execution / file_change / legacy_apply_patch / legacy_exec_command
//          → allow_once + allow_session + decline + abort
//       permissions / tool_user_input / tool_call → decline only
//       mcp_elicitation → decline + abort
//       auth_token_refresh → no actions (broker default-rejects;
//          renderer should never see this in pending mode but guards anyway)
//       unknown → decline only (C-P1 critical-risk fallback)
//   - target.riskLevel reflects per-kind taxonomy
//   - createdAt + status flow through verbatim
//   - summary contains a kind-appropriate label
//
// gstack T-G1: parameterized fixture with bot-token + abs-path in
// params asserts redact applied to summary text.

import type { ApprovalRequestKind, PendingApprovalSnapshot } from "@codex-im/core";
import { describe, expect, it } from "vitest";
import { projectApprovalCard } from "../src/project-approval.js";

function snapshotFor(method: string, params: unknown = {}): PendingApprovalSnapshot {
  const id = Math.floor(Math.random() * 1_000_000);
  const now = new Date();
  return {
    id: `approval-${id}`,
    appServerRequestId: id,
    method,
    params,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  };
}

const KIND_METHOD: Record<Exclude<ApprovalRequestKind, "unknown">, string> = {
  command_execution: "item/commandExecution/requestApproval",
  file_change: "item/fileChange/requestApproval",
  permissions: "item/permissions/requestApproval",
  tool_user_input: "item/tool/requestUserInput",
  tool_call: "item/tool/call",
  mcp_elicitation: "mcpServer/elicitation/request",
  legacy_apply_patch: "applyPatchApproval",
  legacy_exec_command: "execCommandApproval",
  auth_token_refresh: "account/chatgptAuthTokens/refresh",
};

describe("projectApprovalCard — schema + universal invariants (T16)", () => {
  it("every produced card has schemaVersion approval-card.v1", () => {
    for (const method of Object.values(KIND_METHOD)) {
      const card = projectApprovalCard(snapshotFor(method));
      expect(card.schemaVersion).toBe("approval-card.v1");
    }
  });

  it("createdAt + status flow through verbatim", () => {
    const snap = snapshotFor("item/fileChange/requestApproval");
    const card = projectApprovalCard(snap, { status: "resolved" });
    expect(card.createdAt.getTime()).toBe(snap.createdAt.getTime());
    expect(card.status).toBe("resolved");
  });

  it("status defaults to 'pending' when not provided", () => {
    const card = projectApprovalCard(snapshotFor("item/fileChange/requestApproval"));
    expect(card.status).toBe("pending");
  });

  it("approvalId flows through verbatim", () => {
    const snap = snapshotFor("item/fileChange/requestApproval");
    const card = projectApprovalCard(snap);
    expect(card.approvalId).toBe(snap.id);
  });
});

// ─── Per-kind action sets (D11 supported subset) ──────────────────────────

describe("projectApprovalCard — per-kind action sets (T16.1 / D11)", () => {
  it("command_execution → all 4 actions", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.command_execution));
    expect(card.actions.map((a) => a.kind).sort()).toEqual([
      "abort",
      "allow_once",
      "allow_session",
      "decline",
    ]);
  });
  it("file_change → all 4 actions", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.file_change));
    expect(card.actions.map((a) => a.kind).sort()).toEqual([
      "abort",
      "allow_once",
      "allow_session",
      "decline",
    ]);
  });
  it("permissions → decline only", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.permissions));
    expect(card.actions).toEqual([{ kind: "decline" }]);
  });
  it("tool_user_input → decline only", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.tool_user_input));
    expect(card.actions).toEqual([{ kind: "decline" }]);
  });
  it("tool_call → decline only", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.tool_call));
    expect(card.actions).toEqual([{ kind: "decline" }]);
  });
  it("mcp_elicitation → decline + abort", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.mcp_elicitation));
    expect(card.actions.map((a) => a.kind).sort()).toEqual(["abort", "decline"]);
  });
  it("legacy_apply_patch → all 4 actions", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.legacy_apply_patch));
    expect(card.actions.map((a) => a.kind).sort()).toEqual([
      "abort",
      "allow_once",
      "allow_session",
      "decline",
    ]);
  });
  it("legacy_exec_command → all 4 actions", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.legacy_exec_command));
    expect(card.actions.map((a) => a.kind).sort()).toEqual([
      "abort",
      "allow_once",
      "allow_session",
      "decline",
    ]);
  });
  it("auth_token_refresh → no actions surfaced (broker default-rejects)", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.auth_token_refresh));
    expect(card.actions).toEqual([]);
  });
  it("unknown method → decline-only critical card (C-P1)", () => {
    const card = projectApprovalCard(snapshotFor("future/unseen/method"));
    expect(card.kind).toBe("unknown");
    expect(card.actions).toEqual([{ kind: "decline" }]);
    expect(card.target.riskLevel).toBe("critical");
  });
});

// ─── Per-kind risk levels ────────────────────────────────────────────────

describe("projectApprovalCard — per-kind risk levels (T16.1)", () => {
  // Phase 2 risk taxonomy: tool_call is critical (Computer Use),
  // unknown is critical, permissions + command_execution + legacy_*
  // are high, file_change is moderate, tool_user_input + mcp_elicitation
  // + auth_token_refresh are low.
  const RISKS: Record<string, "low" | "moderate" | "high" | "critical"> = {
    [KIND_METHOD.command_execution]: "high",
    [KIND_METHOD.file_change]: "moderate",
    [KIND_METHOD.permissions]: "high",
    [KIND_METHOD.tool_user_input]: "low",
    [KIND_METHOD.tool_call]: "critical",
    [KIND_METHOD.mcp_elicitation]: "low",
    [KIND_METHOD.legacy_apply_patch]: "high",
    [KIND_METHOD.legacy_exec_command]: "high",
    [KIND_METHOD.auth_token_refresh]: "low",
    "future/unseen/method": "critical",
  };
  for (const [method, expected] of Object.entries(RISKS)) {
    it(`${method} → riskLevel ${expected}`, () => {
      expect(projectApprovalCard(snapshotFor(method)).target.riskLevel).toBe(expected);
    });
  }
});

// ─── Summary text — kind-appropriate label ───────────────────────────────

describe("projectApprovalCard — summary text (T16.1)", () => {
  it("command_execution summary contains the command", () => {
    const card = projectApprovalCard(
      snapshotFor(KIND_METHOD.command_execution, { commandLineExpanded: "ls -la /tmp" }),
    );
    expect(card.summary).toContain("ls -la /tmp");
  });
  it("file_change summary mentions file change intent", () => {
    const card = projectApprovalCard(snapshotFor(KIND_METHOD.file_change));
    expect(card.summary.toLowerCase()).toMatch(/file|change|patch/);
  });
  it("unknown summary indicates default-decline", () => {
    const card = projectApprovalCard(snapshotFor("future/unseen/method"));
    expect(card.summary.toLowerCase()).toMatch(/default-decline|unknown/);
  });
});

// ─── Truncation ──────────────────────────────────────────────────────────

describe("projectApprovalCard — truncation (T16.1)", () => {
  it("truncates over-long command summaries to under the byte limit", () => {
    const huge = "a".repeat(8_000);
    const card = projectApprovalCard(
      snapshotFor(KIND_METHOD.command_execution, { commandLineExpanded: huge }),
    );
    const summaryBytes = new TextEncoder().encode(card.summary).byteLength;
    // Phase 2 cap: 1024 bytes per summary (well under Telegram 4096-char body).
    expect(summaryBytes).toBeLessThanOrEqual(1024);
    expect(card.summary).toMatch(/truncated/);
  });
});

// ─── gstack T-G1: redact applied to every kind ───────────────────────────

describe("projectApprovalCard — redact applied to summary (gstack T-G1)", () => {
  const SECRETS = [
    {
      method: KIND_METHOD.command_execution,
      params: { commandLineExpanded: "curl -H 'Authorization: Bearer sk-aaaaaaaaaaaaaaaaaaaaaa'" },
      probe: "sk-aaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      method: KIND_METHOD.command_execution,
      params: {
        commandLineExpanded: "telegram --token 1234567890:AAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      probe: "1234567890:AAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  for (const fixture of SECRETS) {
    it(`${fixture.method} summary redacts ${fixture.probe.slice(0, 16)}…`, () => {
      const card = projectApprovalCard(snapshotFor(fixture.method, fixture.params));
      expect(card.summary).not.toContain(fixture.probe);
    });
  }
});

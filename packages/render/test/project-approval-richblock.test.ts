// T16.3 (Phase 2) — RichBlock projection wrapper.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T16.3
// (Codex missing #8 + C-P1 round-2 alignment)
//
// projectAsRichBlock(snapshot) wraps projectApprovalCard so the
// EventNormalizer can emit a uniform RichBlock stream without
// branching on approval-vs-text at the call site. For every kind —
// including unknown — the result is `{type: "approval", card}`.
//
// `RichBlock.unknown` is reserved for non-approval future use cases
// (unknown ServerNotification arms surfaced from EventNormalizer);
// it is NOT used for unknown approval requests in Phase 2 — those
// flow through the C-P1 decline-only ApprovalCard projection.

import type { PendingApprovalSnapshot } from "@codex-im/core";
import { describe, expect, it } from "vitest";
import { projectAsRichBlock } from "../src/project-approval.js";

function snapshotFor(method: string): PendingApprovalSnapshot {
  const id = Math.floor(Math.random() * 1_000_000);
  const now = new Date();
  return {
    id: `approval-${id}`,
    appServerRequestId: id,
    method,
    params: {},
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  };
}

describe("projectAsRichBlock (T16.3)", () => {
  const ALL_METHODS = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "item/tool/call",
    "mcpServer/elicitation/request",
    "applyPatchApproval",
    "execCommandApproval",
    "account/chatgptAuthTokens/refresh",
    "future/unseen/method",
  ];

  for (const method of ALL_METHODS) {
    it(`${method} → {type: 'approval', card}`, () => {
      const block = projectAsRichBlock(snapshotFor(method));
      expect(block.type).toBe("approval");
      if (block.type === "approval") {
        expect(block.card.approvalId).toMatch(/^approval-/);
      }
    });
  }

  it("unknown method → decline-only card with critical risk (C-P1)", () => {
    const block = projectAsRichBlock(snapshotFor("future/unseen/method"));
    expect(block.type).toBe("approval");
    if (block.type === "approval") {
      expect(block.card.kind).toBe("unknown");
      expect(block.card.actions).toEqual([{ kind: "decline" }]);
      expect(block.card.target.riskLevel).toBe("critical");
    }
  });
});

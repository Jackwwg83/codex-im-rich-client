// T14 (Phase 2) — RichBlock + ApprovalCard + ApprovalUiAction.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T14
// (D11 / D12 / C-P1 alignment)
//
// RichBlock is the platform-agnostic projection emitted by EventNormalizer
// (Phase 2 minimum: text / approval / unknown). ApprovalCard is the
// approval-specific payload — kind, summary, target/risk, action set,
// status, createdAt. ApprovalUiAction lives in core (so the daemon
// wire-up can speak the same UI vocabulary the renderer produces);
// render re-exports type-only.
//
// T14 covers types only. Projection logic (text → text, snapshot →
// approval, unknown defensive variant) lands in T15-T16.

import type { ApprovalUiAction } from "@codex-im/core";
import { describe, expect, it } from "vitest";
import type {
  ApprovalAction,
  ApprovalCard,
  ApprovalStatus,
  ApprovalTarget,
  RichBlock,
} from "../src/index.js";

describe("RichBlock discriminated union (T14)", () => {
  it("admits the 3 Phase 2 variants: text, approval, unknown", () => {
    const blocks: RichBlock[] = [
      { type: "text", text: "Hello, world." },
      {
        type: "approval",
        card: {
          schemaVersion: "approval-card.v1",
          kind: "file_change",
          approvalId: "approval-1",
          summary: "Apply patch to src/foo.ts",
          target: { riskLevel: "moderate" },
          actions: [{ kind: "allow_once" }, { kind: "decline" }],
          status: "pending",
          createdAt: new Date(),
        },
      },
      { type: "unknown", reason: "EventNormalizer hit a wire-arm we don't model yet" },
    ];
    expect(blocks.length).toBe(3);
    for (const b of blocks) {
      // exhaustive narrowing — the switch must compile.
      switch (b.type) {
        case "text":
          expect(typeof b.text).toBe("string");
          break;
        case "approval":
          expect(b.card.approvalId).toMatch(/^approval-/);
          break;
        case "unknown":
          expect(typeof b.reason).toBe("string");
          break;
      }
    }
  });
});

describe("ApprovalCard shape (T14 / C-P1)", () => {
  it("includes schemaVersion, kind, approvalId, summary, target, actions, status, createdAt", () => {
    const card: ApprovalCard = {
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-7",
      summary: "Run `ls -la /tmp`",
      target: { riskLevel: "low" },
      actions: [
        { kind: "allow_once" },
        { kind: "allow_session" },
        { kind: "decline" },
        { kind: "abort" },
      ],
      status: "pending",
      createdAt: new Date(),
    };
    expect(card.kind).toBe("command_execution");
    expect(card.schemaVersion).toBe("approval-card.v1");
    expect(card.actions.length).toBe(4);
  });

  it("decline-only card per C-P1 (renderer-defensive unknown kind)", () => {
    const card: ApprovalCard = {
      schemaVersion: "approval-card.v1",
      kind: "unknown",
      approvalId: "approval-99",
      summary: "Phase 2 cannot resolve unknown approval kinds; default-decline.",
      target: { riskLevel: "critical" },
      actions: [{ kind: "decline" }],
      status: "pending",
      createdAt: new Date(),
    };
    expect(card.target.riskLevel).toBe("critical");
    expect(card.actions).toEqual([{ kind: "decline" }]);
  });
});

describe("ApprovalStatus enumerates the 4 lifecycle states (T14)", () => {
  it("matches broker ApprovalRecord lifecycle states", () => {
    const all: ApprovalStatus[] = ["pending", "resolved", "expired", "transport_lost"];
    expect(all.length).toBe(4);
  });
});

describe("ApprovalTarget riskLevel taxonomy (T14)", () => {
  it("admits low / moderate / high / critical", () => {
    const targets: ApprovalTarget[] = [
      { riskLevel: "low" },
      { riskLevel: "moderate" },
      { riskLevel: "high" },
      { riskLevel: "critical" },
    ];
    expect(targets.length).toBe(4);
  });
});

describe("ApprovalAction is structurally identical to ApprovalUiAction (T14)", () => {
  it("re-exported from core so daemon and renderer speak the same vocabulary", () => {
    const action: ApprovalAction = { kind: "allow_once" };
    // Type-level: ApprovalAction must be assignable to / from ApprovalUiAction.
    const ui: ApprovalUiAction = action;
    const back: ApprovalAction = ui;
    expect(back.kind).toBe("allow_once");
  });
});

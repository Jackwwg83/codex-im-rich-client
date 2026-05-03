import { TeamOperatorPolicy } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { resolveWebApprovalDecision } from "../src/index.js";
import type { DaemonMessageRef, WebApprovalDecisionBroker } from "../src/index.js";

const TARGET = { platform: "telegram", chatId: "c-team" } as const;
const OTHER_TARGET = { platform: "telegram", chatId: "c-other" } as const;
const ACTOR = { kind: "im", platform: "telegram", userId: "u-alice" } as const;
const OTHER_ACTOR = { kind: "im", platform: "telegram", userId: "u-eve" } as const;
const MESSAGE_REF: DaemonMessageRef = {
  target: TARGET,
  messageId: "msg-approval-1",
};
const BOUND_APPROVAL = {
  approvalId: "approval-1",
  target: TARGET,
  messageRef: MESSAGE_REF,
  callbackNonce: "nonce-web-approval",
} as const;

function makePolicy(): TeamOperatorPolicy {
  return new TeamOperatorPolicy({
    operators: [
      {
        actor: ACTOR,
        roles: ["operator"],
        allowedProjectIds: ["web"],
        allowedTargets: [TARGET],
      },
    ],
  });
}

function makeBroker(): WebApprovalDecisionBroker {
  return {
    resolve: vi.fn(() => ({
      kind: "ok" as const,
      appliedAt: new Date("2026-05-03T00:00:00.000Z"),
    })),
  };
}

describe("web approval decision helper (JAC-107)", () => {
  it("does not call ApprovalBroker.resolve when operator policy denies", async () => {
    const broker = makeBroker();

    await expect(
      resolveWebApprovalDecision({
        broker,
        operatorPolicy: makePolicy(),
        actor: OTHER_ACTOR,
        projectId: "web",
        boundApproval: BOUND_APPROVAL,
        decision: { kind: "allow_once" },
      }),
    ).resolves.toEqual({
      kind: "deny",
      reason: "operator_policy_denied",
      policyReason: "operator_not_found",
    });
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("does not call ApprovalBroker.resolve without server-side bound approval proof", async () => {
    const broker = makeBroker();

    await expect(
      resolveWebApprovalDecision({
        broker,
        operatorPolicy: makePolicy(),
        actor: ACTOR,
        projectId: "web",
        decision: { kind: "allow_once" },
      }),
    ).resolves.toEqual({
      kind: "deny",
      reason: "bound_approval_required",
    });
    expect(broker.resolve).not.toHaveBeenCalled();

    await expect(
      resolveWebApprovalDecision({
        broker,
        operatorPolicy: makePolicy(),
        actor: ACTOR,
        projectId: "web",
        boundApproval: {
          ...BOUND_APPROVAL,
          messageRef: { target: OTHER_TARGET, messageId: "msg-approval-1" },
        },
        decision: { kind: "allow_once" },
      }),
    ).resolves.toEqual({
      kind: "deny",
      reason: "message_ref_target_mismatch",
    });
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("calls ApprovalBroker.resolve only after policy and messageRef validation", async () => {
    const broker = makeBroker();

    await expect(
      resolveWebApprovalDecision({
        broker,
        operatorPolicy: makePolicy(),
        actor: ACTOR,
        projectId: "web",
        boundApproval: BOUND_APPROVAL,
        decision: { kind: "allow_once" },
      }),
    ).resolves.toEqual({
      kind: "resolved",
      result: { kind: "ok", appliedAt: new Date("2026-05-03T00:00:00.000Z") },
    });

    expect(broker.resolve).toHaveBeenCalledTimes(1);
    expect(broker.resolve).toHaveBeenCalledWith({
      approvalId: "approval-1",
      decision: { kind: "allow_once" },
      actor: ACTOR,
      target: TARGET,
      callbackNonce: "nonce-web-approval",
    });
  });
});

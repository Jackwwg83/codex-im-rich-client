import { describe, expect, it } from "vitest";
import { TeamOperatorPolicy } from "../src/index.js";
import type { TeamOperatorPolicyConfig } from "../src/index.js";

const TARGET = { platform: "telegram", chatId: "c-team" } as const;
const OTHER_TARGET = { platform: "telegram", chatId: "c-other" } as const;
const ALICE = { kind: "im", platform: "telegram", userId: "u-alice" } as const;
const BOB = { kind: "im", platform: "telegram", userId: "u-bob" } as const;
const ADA = { kind: "im", platform: "telegram", userId: "u-ada" } as const;
const AUDITOR = { kind: "im", platform: "telegram", userId: "u-auditor" } as const;

const CONFIG: TeamOperatorPolicyConfig = {
  operators: [
    {
      actor: ALICE,
      roles: ["operator"],
      allowedProjectIds: ["web"],
      allowedTargets: [TARGET],
    },
    {
      actor: BOB,
      roles: ["viewer"],
      allowedProjectIds: ["web"],
      allowedTargets: [TARGET],
    },
    {
      actor: ADA,
      roles: ["admin"],
      allowedProjectIds: ["infra"],
      allowedTargets: [OTHER_TARGET],
    },
    {
      actor: AUDITOR,
      roles: ["auditor"],
      allowedProjectIds: ["web"],
      allowedTargets: [TARGET],
    },
  ],
};

describe("TeamOperatorPolicy (JAC-109)", () => {
  it("fails closed when no operators are configured", () => {
    const policy = new TeamOperatorPolicy({ operators: [] });
    expect(
      policy.check({
        actor: ALICE,
        action: "view_task",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "operator_policy_not_configured" });
  });

  it("unauthorized operator cannot view or resolve a restricted task", () => {
    const policy = new TeamOperatorPolicy(CONFIG);
    expect(
      policy.check({
        actor: ALICE,
        action: "view_task",
        projectId: "infra",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "project_not_allowed" });
    expect(
      policy.check({
        actor: ALICE,
        action: "resolve_approval",
        projectId: "web",
        target: OTHER_TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "target_not_allowed" });
    expect(
      policy.check({
        actor: { kind: "im", platform: "telegram", userId: "u-eve" },
        action: "resolve_approval",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "operator_not_found" });
  });

  it("allows scoped operators to view tasks and resolve approvals", () => {
    const policy = new TeamOperatorPolicy(CONFIG);
    expect(
      policy.check({
        actor: ALICE,
        action: "view_task",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.check({
        actor: ALICE,
        action: "resolve_approval",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("lets viewers view scoped tasks but not resolve approvals", () => {
    const policy = new TeamOperatorPolicy(CONFIG);
    expect(
      policy.check({
        actor: BOB,
        action: "view_task",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.check({
        actor: BOB,
        action: "resolve_approval",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "role_not_allowed" });
  });

  it("keeps admin scoped to configured projects and targets", () => {
    const policy = new TeamOperatorPolicy(CONFIG);
    expect(
      policy.check({
        actor: ADA,
        action: "view_audit",
      }),
    ).toEqual({ kind: "deny", reason: "project_required" });
    expect(
      policy.check({
        actor: ADA,
        action: "view_audit",
        projectId: "infra",
      }),
    ).toEqual({ kind: "deny", reason: "target_required" });
    expect(
      policy.check({
        actor: ADA,
        action: "view_audit",
        projectId: "infra",
        target: OTHER_TARGET,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.check({
        actor: ADA,
        action: "view_audit",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "project_not_allowed" });
  });

  it("lets auditors view audit/computer-use status but not mutate approvals", () => {
    const policy = new TeamOperatorPolicy(CONFIG);
    expect(
      policy.check({
        actor: AUDITOR,
        action: "view_audit",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.check({
        actor: AUDITOR,
        action: "view_computer_use_status",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.check({
        actor: AUDITOR,
        action: "resolve_approval",
        projectId: "web",
        target: TARGET,
      }),
    ).toEqual({ kind: "deny", reason: "role_not_allowed" });
  });
});

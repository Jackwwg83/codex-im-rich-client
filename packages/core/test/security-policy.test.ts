import { describe, expect, it } from "vitest";
import {
  SecurityPolicy,
  type SecurityPolicyCommandDecision,
  type SecurityPolicyConfig,
  type SecurityPolicyDecision,
} from "../src/security-policy.js";

const EMPTY_CONFIG: SecurityPolicyConfig = {
  allowedUsers: [],
  allowedChats: [],
  commands: {
    denyPatterns: [],
    requireAdminPatterns: [],
  },
};

describe("SecurityPolicy skeleton (T9.1 / D22)", () => {
  it("constructs a Phase 3 synchronous fail-closed policy from immutable config", () => {
    const policy = new SecurityPolicy(EMPTY_CONFIG);
    expect(policy.version).toBe("phase3");
    expect(policy.snapshot.allowedUsers).toEqual([]);
    expect(policy.snapshot.allowedChats).toEqual([]);
  });

  it("exports decision discriminants required by follow-up policy checks", () => {
    const decisions: SecurityPolicyDecision[] = [
      { kind: "allow" },
      { kind: "deny", reason: "not_allowed" },
      { kind: "auto_decline", reason: "approval_destination_denied" },
      { kind: "require_admin", reason: "admin_required" } satisfies SecurityPolicyCommandDecision,
    ];
    expect(decisions.map((d) => d.kind)).toEqual([
      "allow",
      "deny",
      "auto_decline",
      "require_admin",
    ]);
  });

  it("skeleton checks are synchronous and fail closed until behavior slices land", () => {
    const policy = new SecurityPolicy(EMPTY_CONFIG);
    expect(
      policy.checkUserAndChat(
        { platform: "telegram", chatId: "-1001" },
        { userId: "123", displayName: "Alice" },
      ),
    ).toEqual({ kind: "deny", reason: "policy_not_configured" });
    expect(
      policy.checkApprovalDestination(
        {
          id: "approval-1",
          appServerRequestId: 1,
          method: "item/fileChange/requestApproval",
          params: {},
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 30_000),
        },
        { platform: "telegram", chatId: "-1001" },
      ),
    ).toEqual({
      kind: "auto_decline",
      reason: "policy_not_configured",
    });
    expect(policy.checkCommand("ls -la", "/tmp")).toEqual({
      kind: "deny",
      reason: "policy_not_configured",
    });
  });
});

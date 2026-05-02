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

const ALLOW_CONFIG: SecurityPolicyConfig = {
  allowedUsers: ["telegram:123"],
  allowedChats: ["telegram:-1001"],
  commands: {
    denyPatterns: ["rm -rf /", "sudo ", "chmod -R 777"],
    requireAdminPatterns: ["git push", "gh pr merge"],
  },
};

const RELOAD_CONFIG: SecurityPolicyConfig = {
  allowedUsers: ["telegram:456"],
  allowedChats: ["telegram:-2002"],
  commands: {
    denyPatterns: ["shutdown now"],
    requireAdminPatterns: ["gh pr merge"],
  },
};

function approvalSnapshot() {
  return {
    id: "approval-1",
    appServerRequestId: 1,
    method: "item/fileChange/requestApproval",
    params: {},
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
  };
}

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
      policy.checkApprovalDestination(approvalSnapshot(), {
        platform: "telegram",
        chatId: "-1001",
      }),
    ).toEqual({
      kind: "auto_decline",
      reason: "policy_not_configured",
    });
    expect(policy.checkCommand("ls -la", "/tmp")).toEqual({ kind: "allow" });
  });
});

describe("SecurityPolicy.checkUserAndChat (T9.2 / D22)", () => {
  it("allows only when both platform-scoped user and chat are allowlisted", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(
      policy.checkUserAndChat(
        { platform: "telegram", chatId: "-1001" },
        { userId: "123", displayName: "Alice" },
      ),
    ).toEqual({ kind: "allow" });
  });

  it("denies an unknown chat even when the user is allowlisted", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-9999" }, { userId: "123" }),
    ).toEqual({ kind: "deny", reason: "chat_not_allowed" });
  });

  it("denies an unknown user even when the chat is allowlisted", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-1001" }, { userId: "999" }),
    ).toEqual({ kind: "deny", reason: "user_not_allowed" });
  });
});

describe("SecurityPolicy.checkApprovalDestination (T9.3 / D36)", () => {
  it("allows approval rendering to an allowlisted destination", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(
      policy.checkApprovalDestination(approvalSnapshot(), {
        platform: "telegram",
        chatId: "-1001",
      }),
    ).toEqual({ kind: "allow" });
  });

  it("auto-declines approval rendering to a disallowed destination", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(
      policy.checkApprovalDestination(approvalSnapshot(), {
        platform: "telegram",
        chatId: "-9999",
      }),
    ).toEqual({ kind: "auto_decline", reason: "approval_destination_denied" });
  });
});

describe("SecurityPolicy.checkCommand (T9.4 / D22)", () => {
  it("allows benign commands", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(policy.checkCommand("ls -la", "/tmp")).toEqual({ kind: "allow" });
  });

  it("denies configured dangerous command patterns", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    for (const command of ["rm -rf /", "sudo launchctl list", "chmod -R 777 ."]) {
      expect(policy.checkCommand(command, "/tmp")).toEqual({
        kind: "deny",
        reason: "command_denied",
      });
    }
  });

  it("requires admin for configured admin patterns", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    expect(policy.checkCommand("git push origin phase-3-implementation", "/repo")).toEqual({
      kind: "require_admin",
      reason: "admin_required",
    });
  });

  it("deny patterns take precedence over require_admin patterns", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      commands: {
        denyPatterns: ["git push --force"],
        requireAdminPatterns: ["git push"],
      },
    });
    expect(policy.checkCommand("git push --force origin main", "/repo")).toEqual({
      kind: "deny",
      reason: "command_denied",
    });
  });
});

describe("SecurityPolicy.reload (T9.5 / D22)", () => {
  it("atomically swaps from the old policy snapshot to the new snapshot", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);

    policy.reload(RELOAD_CONFIG);

    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-2002" }, { userId: "456" }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-1001" }, { userId: "123" }),
    ).toEqual({ kind: "deny", reason: "chat_not_allowed" });
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-1001" }, { userId: "456" }),
    ).toEqual({ kind: "deny", reason: "chat_not_allowed" });
  });

  it("keeps the old snapshot active when reload validation fails", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    const invalid = {
      ...RELOAD_CONFIG,
      allowedChats: "telegram:-2002",
    } as unknown as SecurityPolicyConfig;

    expect(() => policy.reload(invalid)).toThrow(/SecurityPolicy config/);
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-1001" }, { userId: "123" }),
    ).toEqual({ kind: "allow" });
    expect(
      policy.checkUserAndChat({ platform: "telegram", chatId: "-2002" }, { userId: "456" }),
    ).toEqual({ kind: "deny", reason: "chat_not_allowed" });
  });
});

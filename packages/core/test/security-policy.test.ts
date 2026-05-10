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

describe("SecurityPolicy.checkInboundMessage group policy (JAC-241)", () => {
  it("requires a configured mention before routing messages from mention-gated group chats", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      groupPolicy: {
        mentionRequiredChats: ["telegram:-1001"],
        mentionAliases: ["@codex", "/codex"],
      },
    });

    expect(
      policy.checkInboundMessage(
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
        "run tests",
      ),
    ).toEqual({ kind: "deny", reason: "mention_required" });
    expect(
      policy.checkInboundMessage(
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
        "@Codex run tests",
      ),
    ).toEqual({ kind: "allow" });
  });

  it("keeps non-gated chats on the existing user/chat allowlist behavior", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      groupPolicy: {
        mentionRequiredChats: ["telegram:-2002"],
        mentionAliases: ["@codex"],
      },
    });

    expect(
      policy.checkInboundMessage(
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
        "run tests",
      ),
    ).toEqual({ kind: "allow" });
  });
});

describe("SecurityPolicy.checkProjectAccess (Phase 3 mid-review P1)", () => {
  it("allows globally allowed user/chat when no project ACLs are configured", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);

    expect(
      policy.checkProjectAccess(
        "web",
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
      ),
    ).toEqual({ kind: "allow" });
  });

  it("denies a globally allowed user/chat that is not allowed for the project", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      projects: [
        {
          projectId: "web",
          allowedUsers: ["telegram:456"],
          allowedChats: ["telegram:-1001"],
        },
      ],
    });

    expect(
      policy.checkProjectAccess(
        "web",
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
      ),
    ).toEqual({ kind: "deny", reason: "project_user_not_allowed" });
  });

  it("denies globally allowed project access when the project ACL omits the chat", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      projects: [
        {
          projectId: "web",
          allowedUsers: ["telegram:123"],
          allowedChats: ["telegram:-2002"],
        },
      ],
    });

    expect(
      policy.checkProjectAccess(
        "web",
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
      ),
    ).toEqual({ kind: "deny", reason: "project_chat_not_allowed" });
  });

  it("denies missing project entries once project ACLs are configured", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      projects: [
        {
          projectId: "api",
          allowedUsers: ["telegram:123"],
          allowedChats: ["telegram:-1001"],
        },
      ],
    });

    expect(
      policy.checkProjectAccess(
        "web",
        { platform: "telegram", chatId: "-1001" },
        { userId: "123" },
      ),
    ).toEqual({ kind: "deny", reason: "project_not_allowed" });
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

  it("denies whitespace-evasion variants of a deny pattern (Slice 2.1 hardening)", () => {
    const policy = new SecurityPolicy(ALLOW_CONFIG);
    // Each of these is the same command in shell semantics as the deny
    // pattern "rm -rf /" — under the old String.includes implementation
    // any of these would have escaped the deny rule.
    const evasions = [
      "rm  -rf /", // double space
      "rm\t-rf /", // tab separator
      "rm -rf  /", // double space before /
      "rm   -rf   /", // multiple double spaces
      "'rm' '-rf' '/'", // single-quoted tokens
      '"rm" "-rf" "/"', // double-quoted tokens
      "rm '-rf' /", // mixed quoting
    ];
    for (const command of evasions) {
      expect(policy.checkCommand(command, "/tmp"), `command: ${command}`).toEqual({
        kind: "deny",
        reason: "command_denied",
      });
    }
  });

  it("does not over-match: a deny pattern's last token must equal the corresponding command token", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      commands: {
        denyPatterns: ["rm -rf /"],
        requireAdminPatterns: [],
      },
    });
    // "/tmp" is not the same token as "/" — must not be a deny match.
    expect(policy.checkCommand("rm -rf /tmp", "/tmp")).toEqual({ kind: "allow" });
    // "/etc/foo" is also a distinct token.
    expect(policy.checkCommand("rm -rf /etc/foo", "/tmp")).toEqual({ kind: "allow" });
  });

  it("matches a deny pattern that is a contiguous-token subsequence anywhere in the command", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      commands: {
        denyPatterns: ["chmod 777"],
        requireAdminPatterns: [],
      },
    });
    expect(policy.checkCommand("sudo chmod 777 /tmp/x", "/tmp")).toEqual({
      kind: "deny",
      reason: "command_denied",
    });
  });

  it("ignores empty deny patterns", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      commands: {
        denyPatterns: ["", "   "],
        requireAdminPatterns: [],
      },
    });
    expect(policy.checkCommand("ls", "/tmp")).toEqual({ kind: "allow" });
  });

  it("does not honor variable interpolation: literal $x is required, not its expansion", () => {
    const policy = new SecurityPolicy({
      ...ALLOW_CONFIG,
      commands: {
        denyPatterns: ["rm -rf /"],
        requireAdminPatterns: [],
      },
    });
    // The user typed `$x rm -rf /` literally; the leading $x is a
    // separate token that does not appear in the deny pattern, but the
    // deny pattern is still a contiguous-subsequence match of the
    // remaining tokens.
    expect(policy.checkCommand("$x rm -rf /", "/tmp")).toEqual({
      kind: "deny",
      reason: "command_denied",
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

import type { PendingApprovalSnapshot, Target } from "./types.js";

export type SecurityPolicySender = {
  readonly userId: string;
  readonly displayName?: string;
};

export type SecurityPolicyCommandConfig = {
  readonly denyPatterns: readonly string[];
  readonly requireAdminPatterns: readonly string[];
};

export type SecurityPolicyProjectConfig = {
  readonly projectId: string;
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
};

export type SecurityPolicyConfig = {
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
  readonly commands: SecurityPolicyCommandConfig;
  readonly projects?: readonly SecurityPolicyProjectConfig[];
};

export type SecurityPolicySnapshot = {
  readonly version: "phase3";
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
  readonly commands: SecurityPolicyCommandConfig;
  readonly projects: readonly SecurityPolicyProjectConfig[];
};

export type SecurityPolicyAllowDecision = { readonly kind: "allow" };
export type SecurityPolicyDenyDecision = {
  readonly kind: "deny";
  readonly reason: string;
};
export type SecurityPolicyAutoDeclineDecision = {
  readonly kind: "auto_decline";
  readonly reason: string;
};
export type SecurityPolicyRequireAdminDecision = {
  readonly kind: "require_admin";
  readonly reason: string;
};

export type SecurityPolicyUserChatDecision =
  | SecurityPolicyAllowDecision
  | SecurityPolicyDenyDecision;
export type SecurityPolicyApprovalDestinationDecision =
  | SecurityPolicyAllowDecision
  | SecurityPolicyAutoDeclineDecision;
export type SecurityPolicyCommandDecision =
  | SecurityPolicyAllowDecision
  | SecurityPolicyDenyDecision
  | SecurityPolicyRequireAdminDecision;
export type SecurityPolicyProjectDecision = SecurityPolicyUserChatDecision;
export type SecurityPolicyDecision =
  | SecurityPolicyUserChatDecision
  | SecurityPolicyApprovalDestinationDecision
  | SecurityPolicyCommandDecision
  | SecurityPolicyProjectDecision;

const POLICY_NOT_CONFIGURED = "policy_not_configured";

export class SecurityPolicyConfigError extends Error {
  constructor(message: string) {
    super(`SecurityPolicy config invalid: ${message}`);
    this.name = "SecurityPolicyConfigError";
  }
}

export class SecurityPolicy {
  readonly version = "phase3";

  #snapshot: SecurityPolicySnapshot;

  constructor(config: SecurityPolicyConfig) {
    this.#snapshot = snapshotFromConfig(config);
  }

  get snapshot(): SecurityPolicySnapshot {
    return this.#snapshot;
  }

  checkUserAndChat(target: Target, sender: SecurityPolicySender): SecurityPolicyUserChatDecision {
    if (this.#snapshot.allowedUsers.length === 0 || this.#snapshot.allowedChats.length === 0) {
      return { kind: "deny", reason: POLICY_NOT_CONFIGURED };
    }
    if (!this.#snapshot.allowedChats.includes(platformScoped(target.platform, target.chatId))) {
      return { kind: "deny", reason: "chat_not_allowed" };
    }
    if (!this.#snapshot.allowedUsers.includes(platformScoped(target.platform, sender.userId))) {
      return { kind: "deny", reason: "user_not_allowed" };
    }
    return { kind: "allow" };
  }

  checkApprovalDestination(
    _snapshot: PendingApprovalSnapshot,
    target: Target,
  ): SecurityPolicyApprovalDestinationDecision {
    if (this.#snapshot.allowedChats.length === 0) {
      return { kind: "auto_decline", reason: POLICY_NOT_CONFIGURED };
    }
    if (!this.#snapshot.allowedChats.includes(platformScoped(target.platform, target.chatId))) {
      return { kind: "auto_decline", reason: "approval_destination_denied" };
    }
    return { kind: "allow" };
  }

  checkProjectAccess(
    projectId: string,
    target: Target,
    sender: SecurityPolicySender,
  ): SecurityPolicyProjectDecision {
    const globalDecision = this.checkUserAndChat(target, sender);
    if (globalDecision.kind !== "allow") {
      return globalDecision;
    }

    const projects = this.#snapshot.projects;
    if (projects.length === 0) {
      return { kind: "allow" };
    }

    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (project === undefined) {
      return { kind: "deny", reason: "project_not_allowed" };
    }
    if (project.allowedChats.length === 0 || project.allowedUsers.length === 0) {
      return { kind: "deny", reason: "project_policy_not_configured" };
    }
    if (!project.allowedChats.includes(platformScoped(target.platform, target.chatId))) {
      return { kind: "deny", reason: "project_chat_not_allowed" };
    }
    if (!project.allowedUsers.includes(platformScoped(target.platform, sender.userId))) {
      return { kind: "deny", reason: "project_user_not_allowed" };
    }
    return { kind: "allow" };
  }

  checkCommand(command: string, _cwd: string): SecurityPolicyCommandDecision {
    if (matchesAny(command, this.#snapshot.commands.denyPatterns)) {
      return { kind: "deny", reason: "command_denied" };
    }
    if (matchesAny(command, this.#snapshot.commands.requireAdminPatterns)) {
      return { kind: "require_admin", reason: "admin_required" };
    }
    return { kind: "allow" };
  }

  reload(config: SecurityPolicyConfig): void {
    this.#snapshot = snapshotFromConfig(config);
  }
}

function snapshotFromConfig(config: SecurityPolicyConfig): SecurityPolicySnapshot {
  if (!isRecord(config)) {
    throw new SecurityPolicyConfigError("config must be an object");
  }
  if (!isRecord(config.commands)) {
    throw new SecurityPolicyConfigError("commands must be an object");
  }
  assertStringArray(config.allowedUsers, "allowedUsers");
  assertStringArray(config.allowedChats, "allowedChats");
  assertStringArray(config.commands.denyPatterns, "commands.denyPatterns");
  assertStringArray(config.commands.requireAdminPatterns, "commands.requireAdminPatterns");
  for (const [index, project] of (config.projects ?? []).entries()) {
    if (typeof project.projectId !== "string" || project.projectId.length === 0) {
      throw new SecurityPolicyConfigError(
        `projects[${index}].projectId must be a non-empty string`,
      );
    }
    assertStringArray(project.allowedUsers, `projects[${index}].allowedUsers`);
    assertStringArray(project.allowedChats, `projects[${index}].allowedChats`);
  }
  return Object.freeze({
    version: "phase3" as const,
    allowedUsers: freezeStrings(config.allowedUsers),
    allowedChats: freezeStrings(config.allowedChats),
    commands: Object.freeze({
      denyPatterns: freezeStrings(config.commands.denyPatterns),
      requireAdminPatterns: freezeStrings(config.commands.requireAdminPatterns),
    }),
    projects: Object.freeze(
      (config.projects ?? []).map((project) =>
        Object.freeze({
          projectId: project.projectId,
          allowedUsers: freezeStrings(project.allowedUsers),
          allowedChats: freezeStrings(project.allowedChats),
        }),
      ),
    ),
  });
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function assertStringArray(values: readonly string[], field: string): void {
  if (!Array.isArray(values)) {
    throw new SecurityPolicyConfigError(`${field} must be an array`);
  }
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") {
      throw new SecurityPolicyConfigError(`${field}[${index}] must be a string`);
    }
  }
}

function platformScoped(platform: string, id: string): string {
  return `${platform}:${id}`;
}

function matchesAny(command: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern.length > 0 && command.includes(pattern));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

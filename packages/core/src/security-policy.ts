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
export type SecurityPolicyDecision =
  | SecurityPolicyUserChatDecision
  | SecurityPolicyApprovalDestinationDecision
  | SecurityPolicyCommandDecision;

const POLICY_NOT_CONFIGURED = "policy_not_configured";

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

  checkCommand(_command: string, _cwd: string): SecurityPolicyCommandDecision {
    return { kind: "deny", reason: POLICY_NOT_CONFIGURED };
  }

  reload(config: SecurityPolicyConfig): void {
    this.#snapshot = snapshotFromConfig(config);
  }
}

function snapshotFromConfig(config: SecurityPolicyConfig): SecurityPolicySnapshot {
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

function platformScoped(platform: string, id: string): string {
  return `${platform}:${id}`;
}

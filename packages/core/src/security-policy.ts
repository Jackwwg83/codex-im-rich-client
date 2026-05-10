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

export type SecurityPolicyGroupPolicyConfig = {
  readonly mentionRequiredChats: readonly string[];
  readonly mentionAliases: readonly string[];
};

export type SecurityPolicyConfig = {
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
  readonly commands: SecurityPolicyCommandConfig;
  readonly projects?: readonly SecurityPolicyProjectConfig[];
  readonly groupPolicy?: SecurityPolicyGroupPolicyConfig;
};

export type SecurityPolicySnapshot = {
  readonly version: "phase3";
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
  readonly commands: SecurityPolicyCommandConfig;
  readonly projects: readonly SecurityPolicyProjectConfig[];
  readonly groupPolicy: SecurityPolicyGroupPolicyConfig;
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

  checkInboundMessage(
    target: Target,
    sender: SecurityPolicySender,
    text: string,
  ): SecurityPolicyUserChatDecision {
    const userChatDecision = this.checkUserAndChat(target, sender);
    if (userChatDecision.kind !== "allow") {
      return userChatDecision;
    }

    if (
      !this.#snapshot.groupPolicy.mentionRequiredChats.includes(
        platformScoped(target.platform, target.chatId),
      )
    ) {
      return { kind: "allow" };
    }

    const aliases = this.#snapshot.groupPolicy.mentionAliases;
    if (aliases.length === 0) {
      return { kind: "deny", reason: "mention_required" };
    }

    const normalizedText = text.toLocaleLowerCase();
    if (aliases.some((alias) => normalizedText.includes(alias.toLocaleLowerCase()))) {
      return { kind: "allow" };
    }
    return { kind: "deny", reason: "mention_required" };
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
  const groupPolicy = config.groupPolicy ?? {
    mentionRequiredChats: [],
    mentionAliases: [],
  };
  if (!isRecord(groupPolicy)) {
    throw new SecurityPolicyConfigError("groupPolicy must be an object");
  }
  assertStringArray(groupPolicy.mentionRequiredChats, "groupPolicy.mentionRequiredChats");
  assertStringArray(groupPolicy.mentionAliases, "groupPolicy.mentionAliases");
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
    groupPolicy: Object.freeze({
      mentionRequiredChats: freezeStrings(groupPolicy.mentionRequiredChats),
      mentionAliases: freezeStrings(groupPolicy.mentionAliases),
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

/**
 * Match a deny / require-admin pattern against a command using shell-style
 * tokenization plus contiguous-subsequence matching on the resulting
 * tokens.
 *
 * The previous implementation was `command.includes(pattern)` on the raw
 * strings, which let a user trivially evade a deny rule by inserting
 * whitespace differently from the configured pattern (e.g. command
 * `"rm  -rf /"` with two spaces escapes deny pattern `"rm -rf /"` with
 * one space). It also failed to match patterns that were "obviously"
 * the same command in shell semantics — `"rm -rf /"` vs `'rm' '-rf' '/'`.
 *
 * Both command and pattern are tokenized with the same minimal shell
 * tokenizer (whitespace splitting, respect single- and double-quoted
 * runs, basic backslash escapes). A pattern matches if its token
 * sequence appears as a contiguous subsequence of the command's token
 * sequence. Empty patterns never match. Empty (purely-whitespace)
 * commands never match a non-empty pattern.
 */
function matchesAny(command: string, patterns: readonly string[]): boolean {
  const cmdTokens = tokenizeShell(command);
  if (cmdTokens.length === 0) return false;
  for (const pattern of patterns) {
    const patTokens = tokenizeShell(pattern);
    if (patTokens.length === 0) continue;
    if (containsTokenSubsequence(cmdTokens, patTokens)) return true;
  }
  return false;
}

/**
 * Minimal shell-style tokenizer for security pattern matching. Not a
 * full shell parser: it recognizes single-quoted runs (literal), double-
 * quoted runs (literal — no `$` interpolation, since we are matching
 * not executing), and `\<char>` escapes outside quotes. Whitespace
 * (any `\s+`) separates tokens.
 *
 * Variable interpolation is not honored on purpose: a deny rule must
 * apply to the literal command bytes the user typed, not to whatever a
 * variable might expand to.
 */
function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let bufStarted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        buf += ch;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < input.length) {
        const next = input[i + 1] ?? "";
        if (next === '"' || next === "\\") {
          buf += next;
          i++;
        } else {
          buf += ch;
        }
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      bufStarted = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      bufStarted = true;
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      buf += input[i + 1] ?? "";
      bufStarted = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf.length > 0 || bufStarted) {
        tokens.push(buf);
        buf = "";
        bufStarted = false;
      }
      continue;
    }
    buf += ch;
    bufStarted = true;
  }
  if (buf.length > 0 || bufStarted) {
    tokens.push(buf);
  }
  return tokens;
}

function containsTokenSubsequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

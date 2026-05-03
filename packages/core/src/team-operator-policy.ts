import type { ApprovalActor, Target } from "./types.js";

export type TeamOperatorRole = "viewer" | "operator" | "admin" | "auditor";

export type TeamOperatorAction =
  | "view_status"
  | "view_task"
  | "view_approval"
  | "resolve_approval"
  | "view_computer_use_status"
  | "view_audit"
  | "handoff_session";

export type TeamOperatorActor = Extract<NonNullable<ApprovalActor>, { readonly kind: "im" }>;

export interface TeamOperatorConfig {
  readonly actor: TeamOperatorActor;
  readonly roles: readonly TeamOperatorRole[];
  readonly allowedProjectIds: readonly string[];
  readonly allowedTargets: readonly Target[];
}

export interface TeamOperatorPolicyConfig {
  readonly operators: readonly TeamOperatorConfig[];
}

export interface TeamOperatorAccessInput {
  readonly actor: TeamOperatorActor;
  readonly action: TeamOperatorAction;
  readonly projectId?: string;
  readonly target?: Target;
}

export type TeamOperatorDenyReason =
  | "operator_policy_not_configured"
  | "operator_not_found"
  | "role_not_allowed"
  | "project_required"
  | "project_not_allowed"
  | "target_required"
  | "target_not_allowed";

export type TeamOperatorDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: TeamOperatorDenyReason };

export interface TeamOperatorPolicySnapshot {
  readonly operators: readonly TeamOperatorConfig[];
}

const ROLE_ACTIONS = {
  viewer: ["view_status", "view_task", "view_approval"],
  operator: [
    "view_status",
    "view_task",
    "view_approval",
    "resolve_approval",
    "view_computer_use_status",
    "handoff_session",
  ],
  admin: [
    "view_status",
    "view_task",
    "view_approval",
    "resolve_approval",
    "view_computer_use_status",
    "view_audit",
    "handoff_session",
  ],
  auditor: ["view_status", "view_task", "view_approval", "view_computer_use_status", "view_audit"],
} as const satisfies Record<TeamOperatorRole, readonly TeamOperatorAction[]>;

const PROJECT_SCOPED_ACTIONS = new Set<TeamOperatorAction>([
  "view_task",
  "view_approval",
  "resolve_approval",
  "view_computer_use_status",
  "handoff_session",
]);

const TARGET_SCOPED_ACTIONS = new Set<TeamOperatorAction>([
  "view_task",
  "view_approval",
  "resolve_approval",
  "view_computer_use_status",
  "handoff_session",
]);

export class TeamOperatorPolicyConfigError extends Error {
  constructor(message: string) {
    super(`TeamOperatorPolicy config invalid: ${message}`);
    this.name = "TeamOperatorPolicyConfigError";
  }
}

export class TeamOperatorPolicy {
  readonly #snapshot: TeamOperatorPolicySnapshot;

  constructor(config: TeamOperatorPolicyConfig) {
    this.#snapshot = snapshotFromConfig(config);
  }

  get snapshot(): TeamOperatorPolicySnapshot {
    return this.#snapshot;
  }

  check(input: TeamOperatorAccessInput): TeamOperatorDecision {
    if (this.#snapshot.operators.length === 0) {
      return { kind: "deny", reason: "operator_policy_not_configured" };
    }

    const operator = this.#snapshot.operators.find((candidate) =>
      actorEqual(candidate.actor, input.actor),
    );
    if (operator === undefined) {
      return { kind: "deny", reason: "operator_not_found" };
    }

    if (!operator.roles.some((role) => roleAllowsAction(role, input.action))) {
      return { kind: "deny", reason: "role_not_allowed" };
    }

    if (PROJECT_SCOPED_ACTIONS.has(input.action) && input.projectId === undefined) {
      return { kind: "deny", reason: "project_required" };
    }
    if (input.projectId !== undefined && !operator.allowedProjectIds.includes(input.projectId)) {
      return { kind: "deny", reason: "project_not_allowed" };
    }

    const inputTarget = input.target;
    if (TARGET_SCOPED_ACTIONS.has(input.action) && inputTarget === undefined) {
      return { kind: "deny", reason: "target_required" };
    }
    if (
      inputTarget !== undefined &&
      !operator.allowedTargets.some((target) => targetEqual(target, inputTarget))
    ) {
      return { kind: "deny", reason: "target_not_allowed" };
    }

    return { kind: "allow" };
  }
}

function snapshotFromConfig(config: TeamOperatorPolicyConfig): TeamOperatorPolicySnapshot {
  if (!isRecord(config) || !Array.isArray(config.operators)) {
    throw new TeamOperatorPolicyConfigError("operators must be an array");
  }
  return Object.freeze({
    operators: Object.freeze(config.operators.map(cloneOperator)),
  });
}

function cloneOperator(operator: TeamOperatorConfig): TeamOperatorConfig {
  if (!isRecord(operator)) {
    throw new TeamOperatorPolicyConfigError("operator must be an object");
  }
  if (!isOperatorActor(operator.actor)) {
    throw new TeamOperatorPolicyConfigError("operator actor must be an IM actor");
  }
  assertRoleArray(operator.roles);
  assertStringArray(operator.allowedProjectIds, "allowedProjectIds");
  assertTargetArray(operator.allowedTargets);
  return Object.freeze({
    actor: Object.freeze({ ...operator.actor }),
    roles: Object.freeze([...operator.roles]),
    allowedProjectIds: Object.freeze([...operator.allowedProjectIds]),
    allowedTargets: Object.freeze(
      operator.allowedTargets.map((target) => Object.freeze({ ...target })),
    ),
  });
}

function assertRoleArray(values: readonly TeamOperatorRole[]): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TeamOperatorPolicyConfigError("roles must be a non-empty array");
  }
  for (const [index, role] of values.entries()) {
    if (!(role in ROLE_ACTIONS)) {
      throw new TeamOperatorPolicyConfigError(`roles[${index}] is not a supported role`);
    }
  }
}

function assertStringArray(values: readonly string[], field: string): void {
  if (!Array.isArray(values)) {
    throw new TeamOperatorPolicyConfigError(`${field} must be an array`);
  }
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TeamOperatorPolicyConfigError(`${field}[${index}] must be a non-empty string`);
    }
  }
}

function assertTargetArray(values: readonly Target[]): void {
  if (!Array.isArray(values)) {
    throw new TeamOperatorPolicyConfigError("allowedTargets must be an array");
  }
  for (const [index, target] of values.entries()) {
    if (
      !isRecord(target) ||
      typeof target.platform !== "string" ||
      typeof target.chatId !== "string"
    ) {
      throw new TeamOperatorPolicyConfigError(
        `allowedTargets[${index}] must include platform and chatId`,
      );
    }
  }
}

function isOperatorActor(value: unknown): value is TeamOperatorActor {
  return (
    isRecord(value) &&
    value.kind === "im" &&
    typeof value.platform === "string" &&
    typeof value.userId === "string"
  );
}

function roleAllowsAction(role: TeamOperatorRole, action: TeamOperatorAction): boolean {
  return (ROLE_ACTIONS[role] as readonly TeamOperatorAction[]).includes(action);
}

function actorEqual(a: TeamOperatorActor, b: TeamOperatorActor): boolean {
  return a.platform === b.platform && a.userId === b.userId;
}

function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    a.threadKey === b.threadKey &&
    a.topicId === b.topicId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

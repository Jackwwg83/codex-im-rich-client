export const DEFAULT_COMPUTER_USE_DENY_APPS = Object.freeze([
  "1Password",
  "Keychain Access",
  "System Settings",
  "Terminal",
] as const);

export const DEFAULT_COMPUTER_USE_APPROVAL_KEYWORDS = Object.freeze([
  "login",
  "password",
  "token",
  "payment",
  "checkout",
  "delete",
  "send",
  "submit",
  "publish",
  "transfer",
] as const);

export type ComputerUseUnknownAppPolicy = "deny";

export type ComputerUsePolicyConfig = {
  readonly enabled: boolean;
  readonly requireExplicitPrefix?: boolean;
  readonly defaultApp?: string;
  readonly allowedApps: readonly string[];
  readonly denyApps?: readonly string[];
  readonly unknownAppPolicy?: ComputerUseUnknownAppPolicy;
  readonly requireApprovalKeywords?: readonly string[];
  readonly liveSmokeEnabled?: boolean;
};

export type ComputerUsePolicySnapshot = {
  readonly version: "phase6";
  readonly valid: boolean;
  readonly invalidReason?: "invalid_config";
  readonly enabled: boolean;
  readonly requireExplicitPrefix: boolean;
  readonly defaultApp?: string;
  readonly allowedApps: readonly string[];
  readonly denyApps: readonly string[];
  readonly unknownAppPolicy: ComputerUseUnknownAppPolicy;
  readonly requireApprovalKeywords: readonly string[];
  readonly liveSmokeEnabled: boolean;
};

export type ComputerUsePolicyCheckInput = {
  readonly app?: string;
  readonly task: string;
  readonly sensitivity?: "normal" | "sensitive";
};

export type ComputerUsePolicyAllowDecision = {
  readonly kind: "allow";
  readonly app: string;
  readonly requiresApproval: boolean;
  readonly approvalReasons: readonly string[];
};

export type ComputerUsePolicyDenyReason =
  | "invalid_policy"
  | "policy_disabled"
  | "target_app_required"
  | "allowed_apps_empty"
  | "app_denied"
  | "app_not_allowed";

export type ComputerUsePolicyDenyDecision = {
  readonly kind: "deny";
  readonly reason: ComputerUsePolicyDenyReason;
};

export type ComputerUsePolicyDecision =
  | ComputerUsePolicyAllowDecision
  | ComputerUsePolicyDenyDecision;

const DEFAULT_POLICY: ComputerUsePolicyConfig = {
  enabled: false,
  requireExplicitPrefix: true,
  defaultApp: "Google Chrome",
  allowedApps: ["Google Chrome"],
  denyApps: DEFAULT_COMPUTER_USE_DENY_APPS,
  unknownAppPolicy: "deny",
  requireApprovalKeywords: DEFAULT_COMPUTER_USE_APPROVAL_KEYWORDS,
  liveSmokeEnabled: false,
};

export class ComputerUsePolicy {
  readonly version = "phase6";

  #snapshot: ComputerUsePolicySnapshot;

  constructor(config: ComputerUsePolicyConfig = DEFAULT_POLICY) {
    this.#snapshot = snapshotFromConfig(config);
  }

  get snapshot(): ComputerUsePolicySnapshot {
    return this.#snapshot;
  }

  check(input: ComputerUsePolicyCheckInput): ComputerUsePolicyDecision {
    if (!this.#snapshot.valid) {
      return { kind: "deny", reason: "invalid_policy" };
    }
    if (!this.#snapshot.enabled) {
      return { kind: "deny", reason: "policy_disabled" };
    }
    if (this.#snapshot.allowedApps.length === 0) {
      return { kind: "deny", reason: "allowed_apps_empty" };
    }

    const app = normalizeApp(input.app ?? this.#snapshot.defaultApp);
    if (app === undefined) {
      return { kind: "deny", reason: "target_app_required" };
    }
    if (hasApp(this.#snapshot.denyApps, app)) {
      return { kind: "deny", reason: "app_denied" };
    }
    const allowedApp = findApp(this.#snapshot.allowedApps, app);
    if (allowedApp === undefined) {
      return { kind: "deny", reason: "app_not_allowed" };
    }

    const approvalReasons = approvalReasonsFor(input, this.#snapshot.requireApprovalKeywords);
    return Object.freeze({
      kind: "allow" as const,
      app: allowedApp,
      requiresApproval: approvalReasons.length > 0,
      approvalReasons,
    });
  }

  reload(config: ComputerUsePolicyConfig): void {
    this.#snapshot = snapshotFromConfig(config);
  }
}

function snapshotFromConfig(config: ComputerUsePolicyConfig): ComputerUsePolicySnapshot {
  if (!isRecord(config)) {
    return invalidSnapshot();
  }
  if (
    typeof config.enabled !== "boolean" ||
    !isOptionalBoolean(config.requireExplicitPrefix) ||
    !isOptionalString(config.defaultApp) ||
    !isStringArray(config.allowedApps) ||
    !isOptionalStringArray(config.denyApps) ||
    !isOptionalUnknownAppPolicy(config.unknownAppPolicy) ||
    !isOptionalStringArray(config.requireApprovalKeywords) ||
    !isOptionalBoolean(config.liveSmokeEnabled)
  ) {
    return invalidSnapshot();
  }

  return Object.freeze({
    version: "phase6" as const,
    valid: true,
    enabled: config.enabled,
    requireExplicitPrefix: config.requireExplicitPrefix ?? true,
    ...(config.defaultApp === undefined ? {} : { defaultApp: config.defaultApp }),
    allowedApps: freezeNormalizedStrings(config.allowedApps),
    denyApps: freezeNormalizedStrings(config.denyApps ?? DEFAULT_COMPUTER_USE_DENY_APPS),
    unknownAppPolicy: config.unknownAppPolicy ?? "deny",
    requireApprovalKeywords: freezeNormalizedStrings(
      config.requireApprovalKeywords ?? DEFAULT_COMPUTER_USE_APPROVAL_KEYWORDS,
    ),
    liveSmokeEnabled: config.liveSmokeEnabled ?? false,
  });
}

function invalidSnapshot(): ComputerUsePolicySnapshot {
  return Object.freeze({
    version: "phase6" as const,
    valid: false,
    invalidReason: "invalid_config" as const,
    enabled: false,
    requireExplicitPrefix: true,
    allowedApps: Object.freeze([]),
    denyApps: DEFAULT_COMPUTER_USE_DENY_APPS,
    unknownAppPolicy: "deny" as const,
    requireApprovalKeywords: DEFAULT_COMPUTER_USE_APPROVAL_KEYWORDS,
    liveSmokeEnabled: false,
  });
}

function approvalReasonsFor(
  input: ComputerUsePolicyCheckInput,
  keywords: readonly string[],
): readonly string[] {
  const task = input.task.toLowerCase();
  const reasons = new Set<string>();
  if (input.sensitivity === "sensitive") {
    reasons.add("sensitivity:sensitive");
  }
  for (const keyword of keywords) {
    if (keyword.length > 0 && task.includes(keyword.toLowerCase())) {
      reasons.add(`keyword:${keyword}`);
    }
  }
  return Object.freeze([...reasons]);
}

function freezeNormalizedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function normalizeApp(app: string | undefined): string | undefined {
  const normalized = app?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function findApp(apps: readonly string[], app: string): string | undefined {
  const normalized = app.toLowerCase();
  return apps.find((candidate) => candidate.toLowerCase() === normalized);
}

function hasApp(apps: readonly string[], app: string): boolean {
  return findApp(apps, app) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalUnknownAppPolicy(
  value: unknown,
): value is ComputerUseUnknownAppPolicy | undefined {
  return value === undefined || value === "deny";
}

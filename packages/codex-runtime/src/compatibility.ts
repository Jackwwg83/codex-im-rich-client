import { readFileSync } from "node:fs";
import { join } from "node:path";

export type CodexRuntimeCompatibilityStatus = "compatible" | "degraded" | "blocked";

export interface CodexRuntimeSchemaSummary {
  readonly clientRequestMethods: readonly string[];
  readonly serverNotificationMethods: readonly string[];
  readonly serverRequestMethods: readonly string[];
  readonly clientNotificationMethods: readonly string[];
  readonly threadStartFields: readonly string[];
  readonly threadResumeFields: readonly string[];
  readonly threadForkFields: readonly string[];
}

export interface CodexRuntimeCompatibilityInput {
  readonly runtimeVersion: string;
  readonly generatedProtocolVersion: string;
  readonly writableRootsConfigured: boolean;
  readonly schema: CodexRuntimeSchemaSummary;
}

export interface CodexRuntimeCompatibilityFinding {
  readonly id: string;
  readonly detail: string;
}

export interface CodexRuntimeCompatibilityReport {
  readonly status: CodexRuntimeCompatibilityStatus;
  readonly runtimeVersion: string;
  readonly generatedProtocolVersion: string;
  readonly blockers: readonly CodexRuntimeCompatibilityFinding[];
  readonly degradedFeatures: readonly CodexRuntimeCompatibilityFinding[];
  readonly optionalFeatures: readonly CodexRuntimeCompatibilityFinding[];
  readonly warnings: readonly CodexRuntimeCompatibilityFinding[];
}

type MethodRequirement = {
  readonly id: string;
  readonly methodParts: readonly string[];
  readonly detail: string;
};

const REQUIRED_CLIENT_REQUESTS: readonly MethodRequirement[] = [
  {
    id: "thread_start",
    methodParts: ["thread", "start"],
    detail: "conversation creation is required to create Codex conversations",
  },
  {
    id: "thread_resume",
    methodParts: ["thread", "resume"],
    detail: "conversation resume is required to attach IM chats to existing Codex conversations",
  },
  {
    id: "turn_start",
    methodParts: ["turn", "start"],
    detail: "turn creation is required to send user prompts to Codex",
  },
];

const REQUIRED_SERVER_NOTIFICATIONS: readonly MethodRequirement[] = [
  {
    id: "assistant_delta",
    methodParts: ["item", "agentMessage", "delta"],
    detail: "assistant message deltas are required for ordinary IM replies",
  },
  {
    id: "turn_completed",
    methodParts: ["turn", "completed"],
    detail: "turn completion is required to close IM progress and failure states",
  },
  {
    id: "thread_status_changed",
    methodParts: ["thread", "status", "changed"],
    detail: "thread status updates are required for active/idle tracking",
  },
  {
    id: "server_request_resolved",
    methodParts: ["serverRequest", "resolved"],
    detail: "server request resolution events are required for approval lifecycle feedback",
  },
];

const OPTIONAL_CLIENT_REQUESTS: readonly MethodRequirement[] = [
  {
    id: "thread_turns_list",
    methodParts: ["thread", "turns", "list"],
    detail: "legacy turn listing is no longer required by the 0.130 runtime path",
  },
  {
    id: "plugin_skill_read",
    methodParts: ["plugin", "skill", "read"],
    detail: "skill-read details are report-only until the bridge uses that surface",
  },
  {
    id: "plugin_share",
    methodParts: ["plugin", "share"],
    detail: "plugin sharing is report-only and not part of the alpha runtime path",
  },
  {
    id: "windows_sandbox_readiness",
    methodParts: ["windowsSandbox", "readiness"],
    detail: "Windows sandbox readiness is report-only for the local macOS bridge",
  },
];

const OPTIONAL_SERVER_NOTIFICATIONS: readonly MethodRequirement[] = [
  {
    id: "process_output_delta",
    methodParts: ["process", "outputDelta"],
    detail: "process output events are additive; existing item output events remain supported",
  },
  {
    id: "process_exited",
    methodParts: ["process", "exited"],
    detail: "process exit events are additive; existing turn completion remains supported",
  },
];

export function evaluateCodexRuntimeCompatibility(
  input: CodexRuntimeCompatibilityInput,
): CodexRuntimeCompatibilityReport {
  const clientMethods = new Set(input.schema.clientRequestMethods);
  const serverNotificationMethods = new Set(input.schema.serverNotificationMethods);
  const serverRequestMethods = new Set(input.schema.serverRequestMethods);
  const blockers: CodexRuntimeCompatibilityFinding[] = [];
  const degradedFeatures: CodexRuntimeCompatibilityFinding[] = [];
  const optionalFeatures: CodexRuntimeCompatibilityFinding[] = [];
  const warnings: CodexRuntimeCompatibilityFinding[] = [];

  for (const requirement of REQUIRED_CLIENT_REQUESTS) {
    if (!clientMethods.has(methodName(requirement.methodParts))) {
      blockers.push({ id: requirement.id, detail: requirement.detail });
    }
  }
  for (const requirement of REQUIRED_SERVER_NOTIFICATIONS) {
    if (!serverNotificationMethods.has(methodName(requirement.methodParts))) {
      blockers.push({ id: requirement.id, detail: requirement.detail });
    }
  }
  if (!hasApprovalRequestMethod(serverRequestMethods)) {
    blockers.push({
      id: "approval_request",
      detail: "an approval ServerRequest method is required for guarded command/file/tool actions",
    });
  }

  for (const requirement of OPTIONAL_SERVER_NOTIFICATIONS) {
    if (serverNotificationMethods.has(methodName(requirement.methodParts))) {
      optionalFeatures.push({ id: requirement.id, detail: requirement.detail });
    }
  }
  for (const requirement of OPTIONAL_CLIENT_REQUESTS) {
    const method = methodName(requirement.methodParts);
    const supported =
      requirement.id === "plugin_share"
        ? [...clientMethods].some((candidate) => candidate.startsWith(`${method}/`))
        : clientMethods.has(method);
    if (supported) {
      optionalFeatures.push({ id: requirement.id, detail: requirement.detail });
    }
  }

  const hasPermissionsRequestPath =
    input.schema.threadStartFields.includes("permissions") ||
    input.schema.threadResumeFields.includes("permissions") ||
    input.schema.threadForkFields.includes("permissions");
  if (input.writableRootsConfigured && !hasPermissionsRequestPath) {
    warnings.push({
      id: "writable_roots_metadata_only",
      detail: "writable_roots configured; metadata-only in this alpha",
    });
  }

  const status: CodexRuntimeCompatibilityStatus =
    blockers.length > 0
      ? "blocked"
      : degradedFeatures.length > 0 || warnings.length > 0
        ? "degraded"
        : "compatible";

  return {
    status,
    runtimeVersion: input.runtimeVersion,
    generatedProtocolVersion: input.generatedProtocolVersion,
    blockers,
    degradedFeatures,
    optionalFeatures,
    warnings,
  };
}

export function summarizeCodexRuntimeSchemas(input: {
  readonly clientRequest: unknown;
  readonly serverNotification: unknown;
  readonly serverRequest: unknown;
  readonly clientNotification: unknown;
  readonly threadStartParams: unknown;
  readonly threadResumeParams: unknown;
  readonly threadForkParams: unknown;
}): CodexRuntimeSchemaSummary {
  return {
    clientRequestMethods: schemaMethods(input.clientRequest),
    serverNotificationMethods: schemaMethods(input.serverNotification),
    serverRequestMethods: schemaMethods(input.serverRequest),
    clientNotificationMethods: schemaMethods(input.clientNotification),
    threadStartFields: schemaFields(input.threadStartParams),
    threadResumeFields: schemaFields(input.threadResumeParams),
    threadForkFields: schemaFields(input.threadForkParams),
  };
}

export function readCodexRuntimeSchemaDir(schemaDir: string): CodexRuntimeSchemaSummary {
  return summarizeCodexRuntimeSchemas({
    clientRequest: readJson(join(schemaDir, "ClientRequest.json")),
    serverNotification: readJson(join(schemaDir, "ServerNotification.json")),
    serverRequest: readJson(join(schemaDir, "ServerRequest.json")),
    clientNotification: readJson(join(schemaDir, "ClientNotification.json")),
    threadStartParams: readJson(join(schemaDir, "v2", "ThreadStartParams.json")),
    threadResumeParams: readJson(join(schemaDir, "v2", "ThreadResumeParams.json")),
    threadForkParams: readJson(join(schemaDir, "v2", "ThreadForkParams.json")),
  });
}

export function formatCodexRuntimeCompatibilityReport(
  report: CodexRuntimeCompatibilityReport,
): string {
  const lines = [
    "codex runtime compatibility:",
    `  status: ${formatStatus(report.status)}`,
    `  runtime: ${report.runtimeVersion}`,
    `  generated protocol pin: ${report.generatedProtocolVersion}`,
  ];
  appendFindings(lines, "blockers", report.blockers);
  appendFindings(lines, "degraded", report.degradedFeatures);
  appendFindings(lines, "warnings", report.warnings);
  appendFindings(lines, "optional available", report.optionalFeatures);
  return lines.join("\n");
}

function methodName(parts: readonly string[]): string {
  return parts.join("/");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function hasApprovalRequestMethod(methods: ReadonlySet<string>): boolean {
  for (const method of methods) {
    if (method.endsWith(methodName(["requestApproval"]))) {
      return true;
    }
  }
  return false;
}

function schemaMethods(schema: unknown): readonly string[] {
  if (!isRecord(schema)) {
    return [];
  }
  const fromOneOf = Array.isArray(schema.oneOf)
    ? schema.oneOf.flatMap((entry) => methodFromVariant(entry))
    : [];
  const unique = new Set(fromOneOf);
  return [...unique].sort();
}

function methodFromVariant(value: unknown): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }
  const method = value.properties;
  if (!isRecord(method)) {
    return [];
  }
  const methodProperty = method.method;
  if (!isRecord(methodProperty)) {
    return [];
  }
  if (typeof methodProperty.const === "string") {
    return [methodProperty.const];
  }
  if (Array.isArray(methodProperty.enum)) {
    return methodProperty.enum.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function schemaFields(schema: unknown): readonly string[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  return Object.keys(schema.properties).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatStatus(status: CodexRuntimeCompatibilityStatus): string {
  switch (status) {
    case "compatible":
      return "compatible";
    case "degraded":
      return "degraded (compatible with fallbacks)";
    case "blocked":
      return "blocked: missing hard-required App Server semantics";
  }
}

function appendFindings(
  lines: string[],
  title: string,
  findings: readonly CodexRuntimeCompatibilityFinding[],
): void {
  if (findings.length === 0) {
    return;
  }
  lines.push(`  ${title}:`);
  for (const finding of findings) {
    lines.push(`    - ${finding.id}: ${finding.detail}`);
  }
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CodexRuntimeSchemaSummary,
  evaluateCodexRuntimeCompatibility,
  formatCodexRuntimeCompatibilityReport,
  readCodexRuntimeSchemaDir,
  summarizeCodexRuntimeSchemas,
} from "../src/compatibility.js";

describe("Codex runtime schema compatibility", () => {
  it("accepts a legacy pinned-style schema when required runtime semantics are present", () => {
    const report = evaluateCodexRuntimeCompatibility({
      runtimeVersion: "codex-cli 0.128.0",
      generatedProtocolVersion: "0.128.0",
      writableRootsConfigured: false,
      schema: makeSchemaSummary(),
    });

    expect(report.status).toBe("compatible");
    expect(report.blockers).toEqual([]);
    expect(report.degradedFeatures).toEqual([]);
  });

  it("accepts the 0.130 schema without legacy thread turns list or excludeTurns", () => {
    const report = evaluateCodexRuntimeCompatibility({
      runtimeVersion: "codex-cli 0.130.0",
      generatedProtocolVersion: "0.130.0",
      writableRootsConfigured: false,
      schema: makeSchemaSummary({
        clientRequestMethods: [
          "thread/start",
          "thread/resume",
          "thread/fork",
          "thread/name/set",
          "thread/archive",
          "thread/unarchive",
          "thread/list",
          "thread/read",
          "turn/start",
          "plugin/skill/read",
          "plugin/share/save",
          "windowsSandbox/readiness",
        ],
        serverNotificationMethods: [
          "item/agentMessage/delta",
          "turn/completed",
          "thread/status/changed",
          "serverRequest/resolved",
          "process/outputDelta",
          "process/exited",
        ],
        threadResumeFields: ["threadId"],
        threadForkFields: ["threadId"],
      }),
    });

    expect(report.status).toBe("compatible");
    expect(report.blockers).toEqual([]);
    expect(report.degradedFeatures).toEqual([]);
    expect(report.optionalFeatures.map((feature) => feature.id)).toEqual([
      "process_output_delta",
      "process_exited",
      "plugin_skill_read",
      "plugin_share",
      "windows_sandbox_readiness",
    ]);
    expect(formatCodexRuntimeCompatibilityReport(report)).toContain("status: compatible");
  });

  it("reports degraded native thread features when user-visible thread methods are absent", () => {
    const report = evaluateCodexRuntimeCompatibility({
      runtimeVersion: "codex-cli 0.131.0",
      generatedProtocolVersion: "0.130.0",
      writableRootsConfigured: false,
      schema: makeSchemaSummary({
        clientRequestMethods: [
          "thread/start",
          "thread/resume",
          "turn/start",
          "thread/list",
          "thread/read",
        ],
      }),
    });

    expect(report.status).toBe("degraded");
    expect(report.blockers).toEqual([]);
    expect(report.degradedFeatures.map((feature) => feature.id)).toEqual([
      "thread_fork",
      "thread_name_set",
      "thread_archive",
      "thread_unarchive",
    ]);
    expect(formatCodexRuntimeCompatibilityReport(report)).toContain(
      "thread_fork: /fork is unavailable with this Codex runtime",
    );
  });

  it("blocks when a hard-required App Server runtime semantic disappears", () => {
    const report = evaluateCodexRuntimeCompatibility({
      runtimeVersion: "codex-cli 0.131.0",
      generatedProtocolVersion: "0.128.0",
      writableRootsConfigured: false,
      schema: makeSchemaSummary({
        clientRequestMethods: ["thread/start", "thread/resume"],
      }),
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers.map((blocker) => blocker.id)).toEqual(["turn_start"]);
    expect(formatCodexRuntimeCompatibilityReport(report)).toContain(
      "blocked: missing hard-required App Server semantics",
    );
  });

  it("summarizes generated JSON schemas without treating nested permissions as a request path", () => {
    const schema = summarizeCodexRuntimeSchemas({
      clientRequest: schemaOneOf(["thread/start", "thread/resume", "turn/start"]),
      serverNotification: schemaOneOf([
        "item/agentMessage/delta",
        "turn/completed",
        "thread/status/changed",
        "serverRequest/resolved",
      ]),
      serverRequest: schemaOneOf(["item/commandExecution/requestApproval"]),
      clientNotification: schemaOneOf([]),
      threadStartParams: schemaFields(["cwd"], {
        description: "Nested text mentions permissions but this is not a top-level field.",
      }),
      threadResumeParams: schemaFields(["threadId", "excludeTurns"]),
      threadForkParams: schemaFields(["threadId", "excludeTurns"]),
    });

    const report = evaluateCodexRuntimeCompatibility({
      runtimeVersion: "codex-cli 0.130.0",
      generatedProtocolVersion: "0.128.0",
      writableRootsConfigured: true,
      schema,
    });

    expect(schema.threadStartFields).toEqual(["cwd"]);
    expect(report.warnings.map((warning) => warning.id)).toContain("writable_roots_metadata_only");
  });

  it("reads a generated schema directory into a compatibility summary", () => {
    const schemaDir = mkdtempSync(join(tmpdir(), "codex-im-runtime-schema-"));
    try {
      mkdirSync(join(schemaDir, "v2"), { recursive: true });
      writeJson(join(schemaDir, "ClientRequest.json"), schemaOneOf(["thread/start"]));
      writeJson(join(schemaDir, "ServerNotification.json"), schemaOneOf(["turn/completed"]));
      writeJson(
        join(schemaDir, "ServerRequest.json"),
        schemaOneOf(["item/commandExecution/requestApproval"]),
      );
      writeJson(join(schemaDir, "ClientNotification.json"), schemaOneOf([]));
      writeJson(join(schemaDir, "v2", "ThreadStartParams.json"), schemaFields(["cwd"]));
      writeJson(
        join(schemaDir, "v2", "ThreadResumeParams.json"),
        schemaFields(["threadId", "excludeTurns"]),
      );
      writeJson(join(schemaDir, "v2", "ThreadForkParams.json"), schemaFields(["threadId"]));

      const schema = readCodexRuntimeSchemaDir(schemaDir);

      expect(schema.clientRequestMethods).toEqual(["thread/start"]);
      expect(schema.serverNotificationMethods).toEqual(["turn/completed"]);
      expect(schema.serverRequestMethods).toEqual(["item/commandExecution/requestApproval"]);
      expect(schema.threadResumeFields).toEqual(["excludeTurns", "threadId"]);
      expect(schema.threadForkFields).toEqual(["threadId"]);
    } finally {
      rmSync(schemaDir, { force: true, recursive: true });
    }
  });
});

function makeSchemaSummary(
  overrides: Partial<CodexRuntimeSchemaSummary> = {},
): CodexRuntimeSchemaSummary {
  return {
    clientRequestMethods: [
      "thread/start",
      "thread/resume",
      "thread/fork",
      "thread/name/set",
      "thread/archive",
      "thread/unarchive",
      "thread/list",
      "thread/read",
      "thread/turns/list",
      "turn/start",
    ],
    serverNotificationMethods: [
      "item/agentMessage/delta",
      "turn/completed",
      "thread/status/changed",
      "serverRequest/resolved",
    ],
    serverRequestMethods: ["item/commandExecution/requestApproval"],
    clientNotificationMethods: [],
    threadStartFields: ["cwd"],
    threadResumeFields: ["threadId", "excludeTurns"],
    threadForkFields: ["threadId", "excludeTurns"],
    ...overrides,
  };
}

function schemaOneOf(methods: readonly string[]): Record<string, unknown> {
  return {
    oneOf: methods.map((method) => ({
      type: "object",
      properties: { method: { const: method } },
    })),
  };
}

function schemaFields(
  fields: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

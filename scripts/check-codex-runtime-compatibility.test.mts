import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkCodexRuntimeCompatibilityFromSchemaDir,
  exitCodeForCodexRuntimeCompatibility,
} from "./check-codex-runtime-compatibility.mts";

describe("check-codex-runtime-compatibility", () => {
  it("returns success for warning-only schemas and exit 2 for blocked schemas", () => {
    const schemaDir = mkdtempSync(join(tmpdir(), "codex-im-runtime-check-"));
    try {
      writeSchemaBundle(schemaDir, {
        clientMethods: ["thread/start", "thread/resume", "turn/start"],
        serverNotifications: [
          "item/agentMessage/delta",
          "turn/completed",
          "thread/status/changed",
          "serverRequest/resolved",
        ],
        serverRequests: ["item/commandExecution/requestApproval"],
        resumeFields: ["threadId"],
        forkFields: ["threadId"],
      });

      const report = checkCodexRuntimeCompatibilityFromSchemaDir({
        schemaDir,
        runtimeVersion: "codex-cli 0.130.0",
        generatedProtocolVersion: "0.130.0",
        writableRootsConfigured: true,
      });

      expect(report.status).toBe("degraded");
      expect(exitCodeForCodexRuntimeCompatibility(report)).toBe(0);
      expect(exitCodeForCodexRuntimeCompatibility({ ...report, status: "blocked" })).toBe(2);
    } finally {
      rmSync(schemaDir, { force: true, recursive: true });
    }
  });
});

function writeSchemaBundle(
  schemaDir: string,
  input: {
    readonly clientMethods: readonly string[];
    readonly serverNotifications: readonly string[];
    readonly serverRequests: readonly string[];
    readonly resumeFields: readonly string[];
    readonly forkFields: readonly string[];
  },
): void {
  mkdirSync(join(schemaDir, "v2"), { recursive: true });
  writeJson(join(schemaDir, "ClientRequest.json"), schemaOneOf(input.clientMethods));
  writeJson(join(schemaDir, "ServerNotification.json"), schemaOneOf(input.serverNotifications));
  writeJson(join(schemaDir, "ServerRequest.json"), schemaOneOf(input.serverRequests));
  writeJson(join(schemaDir, "ClientNotification.json"), schemaOneOf([]));
  writeJson(join(schemaDir, "v2", "ThreadStartParams.json"), schemaFields(["cwd"]));
  writeJson(join(schemaDir, "v2", "ThreadResumeParams.json"), schemaFields(input.resumeFields));
  writeJson(join(schemaDir, "v2", "ThreadForkParams.json"), schemaFields(input.forkFields));
}

function schemaOneOf(methods: readonly string[]): Record<string, unknown> {
  return {
    oneOf: methods.map((method) => ({
      type: "object",
      properties: { method: { const: method } },
    })),
  };
}

function schemaFields(fields: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

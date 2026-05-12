#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CodexRuntimeCompatibilityReport,
  evaluateCodexRuntimeCompatibility,
  formatCodexRuntimeCompatibilityReport,
  readCodexRuntimeSchemaDir,
} from "../packages/codex-runtime/src/compatibility.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface CheckCodexRuntimeCompatibilityFromSchemaDirInput {
  readonly schemaDir: string;
  readonly runtimeVersion: string;
  readonly generatedProtocolVersion: string;
  readonly writableRootsConfigured?: boolean;
}

export interface ProbeCodexRuntimeCompatibilityInput {
  readonly codexBinary?: string;
  readonly generatedProtocolVersion?: string;
  readonly writableRootsConfigured?: boolean;
  readonly tmpRoot?: string;
}

export function checkCodexRuntimeCompatibilityFromSchemaDir(
  input: CheckCodexRuntimeCompatibilityFromSchemaDirInput,
): CodexRuntimeCompatibilityReport {
  return evaluateCodexRuntimeCompatibility({
    runtimeVersion: input.runtimeVersion,
    generatedProtocolVersion: input.generatedProtocolVersion,
    writableRootsConfigured: input.writableRootsConfigured === true,
    schema: readCodexRuntimeSchemaDir(input.schemaDir),
  });
}

export function exitCodeForCodexRuntimeCompatibility(
  report: Pick<CodexRuntimeCompatibilityReport, "status">,
): number {
  return report.status === "blocked" ? 2 : 0;
}

export function probeCodexRuntimeCompatibility(
  input: ProbeCodexRuntimeCompatibilityInput = {},
): CodexRuntimeCompatibilityReport {
  const codexBinary = input.codexBinary ?? "codex";
  const version = spawnSync(codexBinary, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (version.status !== 0) {
    return blockedReport({
      runtimeVersion: `${codexBinary} unavailable`,
      generatedProtocolVersion: input.generatedProtocolVersion ?? readGeneratedProtocolVersion(),
      detail: `${codexBinary} --version failed: ${firstNonEmptyLine(version.stderr) ?? "unknown error"}`,
    });
  }

  const schemaDir = mkdtempSync(join(input.tmpRoot ?? tmpdir(), "codex-im-runtime-schema-"));
  try {
    const generated = spawnSync(
      codexBinary,
      ["app-server", "generate-json-schema", "--out", schemaDir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (generated.status !== 0) {
      return blockedReport({
        runtimeVersion: normalizedRuntimeVersion(version.stdout, codexBinary),
        generatedProtocolVersion: input.generatedProtocolVersion ?? readGeneratedProtocolVersion(),
        detail: `${codexBinary} app-server generate-json-schema failed: ${firstNonEmptyLine(generated.stderr) ?? "unknown error"}`,
      });
    }

    return checkCodexRuntimeCompatibilityFromSchemaDir({
      schemaDir,
      runtimeVersion: normalizedRuntimeVersion(version.stdout, codexBinary),
      generatedProtocolVersion: input.generatedProtocolVersion ?? readGeneratedProtocolVersion(),
      writableRootsConfigured: input.writableRootsConfigured,
    });
  } finally {
    rmSync(schemaDir, { force: true, recursive: true });
  }
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const report = probeCodexRuntimeCompatibility(options);
  console.log(formatCodexRuntimeCompatibilityReport(report));
  return exitCodeForCodexRuntimeCompatibility(report);
}

function parseArgs(argv: readonly string[]): ProbeCodexRuntimeCompatibilityInput {
  let codexBinary: string | undefined;
  let writableRootsConfigured = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--codex-binary":
        codexBinary = requiredValue(argv[++index], "--codex-binary");
        break;
      case "--writable-roots-configured":
        writableRootsConfigured = true;
        break;
      default:
        throw new Error(`check-codex-runtime-compatibility: unknown argument ${arg}`);
    }
  }
  return { codexBinary, writableRootsConfigured };
}

function blockedReport(input: {
  readonly runtimeVersion: string;
  readonly generatedProtocolVersion: string;
  readonly detail: string;
}): CodexRuntimeCompatibilityReport {
  return {
    status: "blocked",
    runtimeVersion: input.runtimeVersion,
    generatedProtocolVersion: input.generatedProtocolVersion,
    blockers: [{ id: "runtime_schema_probe", detail: input.detail }],
    degradedFeatures: [],
    optionalFeatures: [],
    warnings: [],
  };
}

function readGeneratedProtocolVersion(): string {
  return readFileSync(join(REPO_ROOT, "CODEX_VERSION"), "utf8").trim();
}

function normalizedRuntimeVersion(stdout: string, fallback: string): string {
  return firstNonEmptyLine(stdout) ?? fallback;
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function requiredValue(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`check-codex-runtime-compatibility: ${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

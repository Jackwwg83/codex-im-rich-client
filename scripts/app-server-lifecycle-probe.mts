#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { basename } from "node:path";

export type AppServerLifecycleProbeResult =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "available";
      readonly backend?: string;
      readonly socketPath?: string;
      readonly cliVersion?: string;
      readonly appServerVersion?: string;
      readonly rawRedacted: unknown;
    };

export type AppServerLifecycleProbeRunner = (
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number },
) => { readonly status: number | null; readonly stdout: string; readonly stderr: string };

export interface ProbeAppServerLifecycleOptions {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly runner?: AppServerLifecycleProbeRunner;
}

const DEFAULT_TIMEOUT_MS = 2000;

export function probeAppServerLifecycle(
  options: ProbeAppServerLifecycleOptions = {},
): AppServerLifecycleProbeResult {
  const command = options.command ?? "codex";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? defaultRunner;
  const result = runner(command, ["app-server", "daemon", "version"], { timeoutMs });

  if (result.status !== 0) {
    return { kind: "unavailable", reason: "command_unavailable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { kind: "unavailable", reason: "invalid_json" };
  }
  if (!isRecord(parsed)) {
    return { kind: "unavailable", reason: "invalid_json" };
  }

  return {
    kind: "available",
    backend: stringField(parsed, "backend"),
    socketPath: redactPathString(stringField(parsed, "socketPath")),
    cliVersion: stringField(parsed, "cliVersion"),
    appServerVersion: stringField(parsed, "appServerVersion"),
    rawRedacted: redactLifecycleJson(parsed),
  };
}

export function formatAppServerLifecycleProbe(result: AppServerLifecycleProbeResult): string {
  if (result.kind === "unavailable") {
    if (result.reason === "command_unavailable") {
      return "Codex App Server lifecycle daemon: unavailable in current pinned Codex";
    }
    return `Codex App Server lifecycle daemon: unavailable (${result.reason})`;
  }
  return [
    "Codex App Server lifecycle daemon: available",
    result.backend === undefined ? undefined : `backend=${result.backend}`,
    result.cliVersion === undefined ? undefined : `cli=${result.cliVersion}`,
    result.appServerVersion === undefined ? undefined : `app-server=${result.appServerVersion}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function defaultRunner(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number },
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function redactLifecycleJson(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactLifecycleJson(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactLifecycleJson(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === "string" && /path|socket/i.test(key)) {
    return redactPathString(value);
  }
  return value;
}

function redactPathString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value.includes("/")) return value;
  return `<redacted-path>/${basename(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_STATUS_FILENAME = "daemon-status.json";

export interface DaemonStatusFatal {
  readonly at: string;
  readonly message: string;
}

export interface DaemonStatusSnapshot {
  readonly pid: number;
  readonly startedAt: string;
  readonly currentCodexThreadCount: number;
  readonly pendingApprovalCount: number;
  readonly lastCodexSpawnAt?: string | null;
  readonly supervisorFailureCount: number;
  readonly lastFatal?: DaemonStatusFatal | null;
}

export interface DaemonStatusFlags {
  readonly statusPath?: string;
}

export interface RunDaemonStatusCoreOptions {
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly now?: Date;
  readonly readFile?: (path: string, encoding: "utf8") => string;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
}

export function parseDaemonStatusArgs(argv: readonly string[]): DaemonStatusFlags {
  const flags: { statusPath?: string } = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--status-file") {
      if (next === undefined || next.startsWith("--")) {
        throw new Error("daemon status: --status-file requires a value");
      }
      flags.statusPath = next;
      i += 2;
      continue;
    }
    throw new Error(`daemon status: unknown flag '${arg}'`);
  }
  return flags;
}

export function defaultDaemonStatusPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const home = env.HOME;
  if (home === undefined || home.length === 0) {
    throw new Error("daemon status: HOME is required when --status-file is not provided");
  }
  return join(home, ".codex-im-bridge", DEFAULT_STATUS_FILENAME);
}

export function runDaemonStatusCore(options: RunDaemonStatusCoreOptions = {}): number {
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? readFileSync;
  let statusPath: string;

  try {
    statusPath =
      parseDaemonStatusArgs(options.argv ?? []).statusPath ?? defaultDaemonStatusPath(env);
  } catch (error) {
    errorOutput(errorMessage(error));
    return 2;
  }

  let raw: string;
  try {
    raw = readFile(statusPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      errorOutput(`daemon status unavailable: ${statusPath}`);
      errorOutput("daemon is not running or has not written a status snapshot");
      return 2;
    }
    errorOutput(`daemon status unavailable: unable to read ${statusPath}`);
    return 3;
  }

  let snapshot: DaemonStatusSnapshot;
  try {
    snapshot = parseDaemonStatusSnapshot(raw);
  } catch (error) {
    errorOutput(`daemon status unavailable: invalid status snapshot at ${statusPath}`);
    errorOutput(errorMessage(error));
    return 3;
  }

  output(formatDaemonStatus(snapshot, options.now ?? new Date()));
  return 0;
}

export async function run(argv: readonly string[] = process.argv.slice(4)): Promise<void> {
  const exitCode = runDaemonStatusCore({ argv });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

export function formatDaemonStatus(snapshot: DaemonStatusSnapshot, now: Date = new Date()): string {
  const lines = [
    "daemon: running",
    `pid: ${snapshot.pid}`,
    `uptime: ${formatUptime(now.getTime() - Date.parse(snapshot.startedAt))}`,
    `codex_threads: ${snapshot.currentCodexThreadCount}`,
    `pending_approvals: ${snapshot.pendingApprovalCount}`,
    `last_codex_spawn: ${snapshot.lastCodexSpawnAt ?? "none"}`,
    `supervisor_failures: ${snapshot.supervisorFailureCount}`,
  ];

  if (snapshot.lastFatal === undefined || snapshot.lastFatal === null) {
    lines.push("last_fatal: none");
  } else {
    lines.push(
      `last_fatal: ${snapshot.lastFatal.at} ${redactStatusText(snapshot.lastFatal.message)}`,
    );
  }

  return lines.join("\n");
}

function parseDaemonStatusSnapshot(raw: string): DaemonStatusSnapshot {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("daemon status: snapshot must be a JSON object");
  }

  const snapshot: {
    pid: number;
    startedAt: string;
    currentCodexThreadCount: number;
    pendingApprovalCount: number;
    lastCodexSpawnAt?: string | null;
    supervisorFailureCount: number;
    lastFatal?: DaemonStatusFatal | null;
  } = {
    pid: requireFiniteNumber(parsed, "pid"),
    startedAt: requireIsoString(parsed, "startedAt"),
    currentCodexThreadCount: requireNonNegativeInteger(parsed, "currentCodexThreadCount"),
    pendingApprovalCount: requireNonNegativeInteger(parsed, "pendingApprovalCount"),
    supervisorFailureCount: requireNonNegativeInteger(parsed, "supervisorFailureCount"),
  };

  if (parsed.lastCodexSpawnAt !== undefined) {
    snapshot.lastCodexSpawnAt = requireNullableIsoString(parsed, "lastCodexSpawnAt");
  }
  if (parsed.lastFatal !== undefined) {
    snapshot.lastFatal = requireNullableFatal(parsed, "lastFatal");
  }

  return snapshot;
}

function formatUptime(ms: number): string {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds -= hours * 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function redactStatusText(value: string): string {
  return value
    .replace(/IM_TELEGRAM_BOT_TOKEN=([^\s]+)/g, "IM_TELEGRAM_BOT_TOKEN=<redacted>")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "<redacted:telegram-token>");
}

function requireNullableFatal(
  record: Record<string, unknown>,
  field: string,
): DaemonStatusFatal | null {
  const value = record[field];
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error(`daemon status: ${field} must be null or an object`);
  }
  return {
    at: requireIsoString(value, "at"),
    message: requireString(value, "message"),
  };
}

function requireNullableIsoString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`daemon status: ${field} must be null or an ISO timestamp string`);
  }
  return value;
}

function requireIsoString(record: Record<string, unknown>, field: string): string {
  const value = requireString(record, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`daemon status: ${field} must be an ISO timestamp string`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`daemon status: ${field} must be a string`);
  }
  return value;
}

function requireFiniteNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`daemon status: ${field} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(record: Record<string, unknown>, field: string): number {
  const value = requireFiniteNumber(record, field);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`daemon status: ${field} must be a non-negative integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

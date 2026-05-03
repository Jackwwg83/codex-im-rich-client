#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface ReleaseReadinessStep {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly expectedExitCodes: readonly number[];
  readonly env?: Record<string, string | undefined>;
  readonly safeOutputPattern?: RegExp;
}

export interface ReleaseReadinessOptions {
  readonly includeFullGates?: boolean;
}

export interface ReleaseReadinessStepResult {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ReleaseReadinessReport {
  readonly ok: boolean;
  readonly includeFullGates: boolean;
  readonly results: readonly ReleaseReadinessStepResult[];
}

const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const GENERIC_SECRET_RE =
  /\b(?:ghp_[A-Za-z0-9_]{20,}|xox[abdprs]-[A-Za-z0-9-]{10,}|sk-(?!ip\b)[A-Za-z0-9_-]{20,}|Authorization:\s*Bearer\s+\S+)/i;
const FAKE_KEYCHAIN_TOKEN = "fake-keychain-token-value";

const FULL_GATE_STEPS: readonly ReleaseReadinessStep[] = [
  step("check-codex-version", "Check Codex version pin", "pnpm", ["check:codex-version"]),
  step("typecheck", "Typecheck source", "pnpm", ["typecheck"]),
  step("typecheck-tests", "Typecheck tests", "pnpm", ["typecheck:tests"]),
  step("test", "Unit and contract tests", "pnpm", ["test"]),
  step("test-cli-smoke", "CLI smoke tests", "pnpm", ["test:cli-smoke"]),
  step("lint", "Lint", "pnpm", ["lint"]),
  step("protocol-check", "Protocol generation check", "pnpm", ["protocol:check"]),
  step("verify-fixtures", "Verify captured fixtures", "pnpm", [
    "exec",
    "tsx",
    "scripts/verify-phase1-fixtures.mts",
  ]),
];

export function buildReleaseReadinessSteps(
  options: ReleaseReadinessOptions = {},
): readonly ReleaseReadinessStep[] {
  const includeFullGates = options.includeFullGates !== false;
  return [
    ...(includeFullGates ? FULL_GATE_STEPS : []),
    step("launchd-install-dry-run", "launchd install dry-run", "pnpm", [
      "launchd:install",
      "--dry-run",
    ]),
    loadAndRunDryRunStep(),
    sqliteBackupProofStep(),
    step("smoke-telegram-fake", "Telegram fake smoke", "pnpm", ["smoke:telegram-fake"]),
    step("smoke-lark-fake", "Lark fake smoke", "pnpm", ["smoke:lark-fake"]),
    step("smoke-dingtalk-fake", "DingTalk fake smoke", "pnpm", ["smoke:dingtalk-fake"]),
    step(
      "smoke-telegram-live-default-gate",
      "Telegram live smoke default gate",
      "pnpm",
      ["smoke:telegram-live"],
      { expectedExitCodes: [1], safeOutputPattern: /operator-gated/i },
    ),
    step(
      "smoke-telegram-real-default-gate",
      "Telegram real smoke default gate",
      "pnpm",
      ["smoke:telegram-real"],
      { expectedExitCodes: [1], safeOutputPattern: /operator-gated/i },
    ),
    step("smoke-lark-live-default-skip", "Lark live smoke default skip", "pnpm", [
      "smoke:lark-live",
    ]),
    step("smoke-dingtalk-live-default-skip", "DingTalk live smoke default skip", "pnpm", [
      "smoke:dingtalk-live",
    ]),
    step("smoke-computer-use-default-skip", "Computer Use live smoke default skip", "pnpm", [
      "smoke:computer-use-live",
    ]),
  ];
}

export function assertNoSecretMaterial(output: string): void {
  if (TOKEN_SHAPED_RE.test(output) || GENERIC_SECRET_RE.test(output)) {
    throw new Error("release-readiness-check: command output contains token-shaped material");
  }
  if (output.includes(FAKE_KEYCHAIN_TOKEN)) {
    throw new Error("release-readiness-check: command output contains fake Keychain token bytes");
  }
}

export function runReleaseReadinessCheck(
  options: ReleaseReadinessOptions = {},
): ReleaseReadinessReport {
  const includeFullGates = options.includeFullGates !== false;
  const results: ReleaseReadinessStepResult[] = [];
  for (const stepDef of buildReleaseReadinessSteps({ includeFullGates })) {
    const result = runStep(stepDef);
    results.push(result);
    process.stdout.write(formatStepResult(result));
    if (!result.ok) {
      break;
    }
  }
  return {
    ok: results.every((result) => result.ok),
    includeFullGates,
    results,
  };
}

function runStep(stepDef: ReleaseReadinessStep): ReleaseReadinessStepResult {
  const result = spawnSync(stepDef.command, stepDef.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...stepDef.env,
    },
    encoding: "utf8",
  });
  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  let ok = stepDef.expectedExitCodes.includes(exitCode);
  if (ok && stepDef.safeOutputPattern !== undefined) {
    ok = stepDef.safeOutputPattern.test(`${stdout}\n${stderr}`);
  }
  try {
    assertNoSecretMaterial(`${stdout}\n${stderr}`);
  } catch (error) {
    ok = false;
  }
  return {
    id: stepDef.id,
    title: stepDef.title,
    command: [stepDef.command, ...stepDef.args].join(" "),
    exitCode,
    ok,
    stdout,
    stderr,
  };
}

function formatStepResult(result: ReleaseReadinessStepResult): string {
  const status = result.ok ? "PASS" : "FAIL";
  return `[release-readiness] ${status} ${result.id}: ${result.command} (exit ${result.exitCode})\n`;
}

function step(
  id: string,
  title: string,
  command: string,
  args: readonly string[],
  options: {
    readonly expectedExitCodes?: readonly number[];
    readonly env?: Record<string, string | undefined>;
    readonly safeOutputPattern?: RegExp;
  } = {},
): ReleaseReadinessStep {
  return {
    id,
    title,
    command,
    args,
    expectedExitCodes: options.expectedExitCodes ?? [0],
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.safeOutputPattern === undefined
      ? {}
      : { safeOutputPattern: options.safeOutputPattern }),
  };
}

function loadAndRunDryRunStep(): ReleaseReadinessStep {
  const shimDir = mkdtempSync(join(tmpdir(), "codex-im-release-security-"));
  writeFileSync(
    join(shimDir, "security"),
    ["#!/usr/bin/env bash", 'printf "%s" "$FAKE_SECURITY_TOKEN"'].join("\n"),
    { mode: 0o700 },
  );
  return step(
    "load-and-run-dry-run",
    "Keychain wrapper dry-run",
    "bash",
    ["bin/load-and-run.sh", "--dry-run"],
    {
      env: {
        PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
        USER: process.env.USER ?? "codex",
        NODE_BIN: process.execPath,
        DAEMON_ENTRY: join(process.cwd(), "packages/daemon/src/index.ts"),
        FAKE_SECURITY_TOKEN: FAKE_KEYCHAIN_TOKEN,
      },
    },
  );
}

function sqliteBackupProofStep(): ReleaseReadinessStep {
  const root = mkdtempSync(join(tmpdir(), "codex-im-release-db-"));
  const sourcePath = join(root, "state.db");
  const backupDir = join(root, "backups");
  const create = spawnSync(
    "pnpm",
    [
      "--filter",
      "@codex-im/cli",
      "exec",
      "node",
      "-e",
      [
        'const Database = require("better-sqlite3");',
        "const db = new Database(process.argv[1]);",
        "db.exec(\"CREATE TABLE readiness(id INTEGER PRIMARY KEY, ok TEXT); INSERT INTO readiness(ok) VALUES ('yes');\");",
        "db.close();",
      ].join(" "),
      sourcePath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if ((create.status ?? 1) !== 0) {
    return step("db-backup-proof-setup", "SQLite backup proof setup", "node", [
      "-e",
      'process.exitCode = 1; console.error("sqlite setup failed")',
    ]);
  }
  return step("db-backup-proof", "SQLite backup proof", "pnpm", [
    "db:backup",
    "--",
    "--source",
    sourcePath,
    "--backup-dir",
    backupDir,
    "--keep",
    "1",
  ]);
}

function parseArgs(argv: readonly string[]): ReleaseReadinessOptions {
  const normalized = argv.filter((arg) => arg !== "--");
  const includeFullGates = !normalized.includes("--skip-full-gates");
  const unknown = normalized.filter((arg) => arg !== "--skip-full-gates");
  if (unknown.length > 0) {
    throw new Error(`release-readiness-check: unknown flag ${unknown.join(", ")}`);
  }
  return { includeFullGates };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const report = runReleaseReadinessCheck(parseArgs(process.argv.slice(2)));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

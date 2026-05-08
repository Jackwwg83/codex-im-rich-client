#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface ReleaseReadinessStep {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly expectedExitCodes: readonly number[];
  readonly env?: Record<string, string | undefined>;
  readonly unsetEnv?: readonly string[];
  readonly safeOutputPattern?: RegExp;
  readonly prepare?: () => ReleaseReadinessStepPrepared;
}

export interface ReleaseReadinessStepPrepared {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly unsetEnv?: readonly string[];
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
const DEFAULT_LIVE_SMOKE_UNSET_ENV = [
  "TELEGRAM_LIVE",
  "TELEGRAM_LIVE_FILE",
  "TELEGRAM_LIVE_INBOUND_ATTACHMENT",
  "TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND",
  "TELEGRAM_LIVE_TARGET_CHAT_ID",
  "TELEGRAM_LIVE_ROUNDTRIP",
  "TELEGRAM_LIVE_DURATION_MS",
  "IM_TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ROUNDTRIP_ALLOWED_CHAT_ID",
  "TELEGRAM_ROUNDTRIP_ALLOWED_USER_ID",
  "TELEGRAM_ROUNDTRIP_NONCE",
  "TELEGRAM_ROUNDTRIP_TIMEOUT_MS",
  "CODEX_REAL_SMOKE",
  "CODEX_REAL_SMOKE_PROMPT",
  "LARK_LIVE",
  "LARK_LIVE_FILE",
  "LARK_LIVE_INBOUND_ATTACHMENT",
  "LARK_LIVE_INBOUND_ATTACHMENT_KIND",
  "LARK_LIVE_DURATION_MS",
  "LARK_LIVE_DRY_RUN",
  "LARK_APP_ID",
  "LARK_APP_SECRET_ENV",
  "LARK_APP_SECRET",
  "LARK_TARGET_CHAT_ID",
  "LARK_LIVE_TEXT",
  "LARK_DOMAIN",
  "DINGTALK_LIVE",
  "DINGTALK_LIVE_DRY_RUN",
  "DINGTALK_LIVE_INBOUND_ATTACHMENT",
  "DINGTALK_LIVE_INBOUND_ATTACHMENT_KIND",
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET_ENV",
  "DINGTALK_CLIENT_SECRET",
  "DINGTALK_LIVE_DURATION_MS",
  "SLACK_LIVE",
  "SLACK_LIVE_DRY_RUN",
  "SLACK_LIVE_TEXT",
  "SLACK_LIVE_FILE",
  "SLACK_TARGET_CHANNEL_ID",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_BOT_TOKEN_ENV",
  "COMPUTER_USE_LIVE",
  "COMPUTER_USE_PROVIDER_VERIFIED",
  "COMPUTER_USE_LIVE_DRY_RUN",
  "COMPUTER_USE_LIVE_APP",
  "COMPUTER_USE_LIVE_TASK",
] as const;
const DEFAULT_SKIP_PATTERN = /"status":\s*"skip"[\s\S]*"gate":\s*"disabled"[\s\S]*SKIP/i;

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
  const bridgeContext = createBridgeReleaseContext();
  return [
    ...(includeFullGates ? FULL_GATE_STEPS : []),
    step("bridge-build", "Build daemon bridge artifact", "pnpm", ["bridge:build"]),
    bridgeInstallDryRunStep(bridgeContext),
    bridgeInstallStep(bridgeContext),
    launchdInstallDryRunStep(bridgeContext),
    loadAndRunDryRunStep(bridgeContext),
    bridgeRedactionScanStep(bridgeContext),
    sqliteBackupProofStep(),
    daemonRoundtripSmokeStep(bridgeContext),
    step("smoke-telegram-fake", "Telegram fake smoke", "pnpm", ["smoke:telegram-fake"]),
    step("smoke-lark-fake", "Lark fake smoke", "pnpm", ["smoke:lark-fake"]),
    step("smoke-dingtalk-fake", "DingTalk fake smoke", "pnpm", ["smoke:dingtalk-fake"]),
    step(
      "smoke-telegram-live-default-gate",
      "Telegram live smoke default gate",
      "pnpm",
      ["smoke:telegram-live"],
      {
        expectedExitCodes: [1],
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: /operator-gated/i,
      },
    ),
    step(
      "smoke-telegram-live-roundtrip-default-gate",
      "Telegram live roundtrip smoke default gate",
      "pnpm",
      ["smoke:telegram-live-roundtrip"],
      {
        expectedExitCodes: [1],
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: /operator-gated/i,
      },
    ),
    step(
      "smoke-telegram-side-by-side-default-gate",
      "Telegram side-by-side smoke default gate",
      "pnpm",
      ["smoke:telegram-side-by-side"],
      {
        expectedExitCodes: [1],
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: /operator-gated/i,
      },
    ),
    step(
      "smoke-lark-live-default-skip",
      "Lark live smoke default skip",
      "pnpm",
      ["smoke:lark-live"],
      {
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: DEFAULT_SKIP_PATTERN,
      },
    ),
    step(
      "smoke-dingtalk-live-default-skip",
      "DingTalk live smoke default skip",
      "pnpm",
      ["smoke:dingtalk-live"],
      {
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: DEFAULT_SKIP_PATTERN,
      },
    ),
    step(
      "smoke-slack-live-default-skip",
      "Slack live smoke default skip",
      "pnpm",
      ["smoke:slack-live"],
      {
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: DEFAULT_SKIP_PATTERN,
      },
    ),
    step(
      "smoke-computer-use-default-skip",
      "Computer Use live smoke default skip",
      "pnpm",
      ["smoke:computer-use-live"],
      {
        unsetEnv: DEFAULT_LIVE_SMOKE_UNSET_ENV,
        safeOutputPattern: DEFAULT_SKIP_PATTERN,
      },
    ),
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
  let effectiveStep: ReleaseReadinessStep;
  try {
    effectiveStep = prepareStep(stepDef);
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return {
      id: stepDef.id,
      title: stepDef.title,
      command: [stepDef.command, ...stepDef.args].join(" "),
      exitCode: 1,
      ok: false,
      stdout: "",
      stderr,
    };
  }
  const result = spawnSync(effectiveStep.command, effectiveStep.args, {
    cwd: process.cwd(),
    env: buildStepEnv(effectiveStep),
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
    command: [effectiveStep.command, ...effectiveStep.args].join(" "),
    exitCode,
    ok,
    stdout,
    stderr,
  };
}

function prepareStep(stepDef: ReleaseReadinessStep): ReleaseReadinessStep {
  const prepared = stepDef.prepare?.();
  if (prepared === undefined) {
    return stepDef;
  }
  return {
    ...stepDef,
    command: prepared.command ?? stepDef.command,
    args: prepared.args ?? stepDef.args,
    env: { ...(stepDef.env ?? {}), ...(prepared.env ?? {}) },
    unsetEnv: [...(stepDef.unsetEnv ?? []), ...(prepared.unsetEnv ?? [])],
  };
}

export function buildStepEnv(
  stepDef: Pick<ReleaseReadinessStep, "env" | "unsetEnv">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of stepDef.unsetEnv ?? []) {
    delete env[name];
  }
  for (const [name, value] of Object.entries(stepDef.env ?? {})) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return env;
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
    readonly unsetEnv?: readonly string[];
    readonly safeOutputPattern?: RegExp;
    readonly prepare?: () => ReleaseReadinessStepPrepared;
  } = {},
): ReleaseReadinessStep {
  return {
    id,
    title,
    command,
    args,
    expectedExitCodes: options.expectedExitCodes ?? [0],
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.unsetEnv === undefined ? {} : { unsetEnv: options.unsetEnv }),
    ...(options.safeOutputPattern === undefined
      ? {}
      : { safeOutputPattern: options.safeOutputPattern }),
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  };
}

interface BridgeReleaseContext {
  readonly home: string;
  readonly bridgeDir: string;
  readonly configPath: string;
  readonly appDaemon: string;
  readonly wrapperEntry: string;
  readonly migrationsDir: string;
  readonly logsDir: string;
  configWritten: boolean;
}

function createBridgeReleaseContext(): BridgeReleaseContext {
  const home = mkdtempSync(join(tmpdir(), "codex-im-release-bridge-home-"));
  const bridgeDir = join(home, ".codex-im-bridge");
  return {
    home,
    bridgeDir,
    configPath: join(bridgeDir, "config.toml"),
    appDaemon: join(bridgeDir, "app", "daemon.mjs"),
    wrapperEntry: join(bridgeDir, "bin", "load-and-run.sh"),
    migrationsDir: join(bridgeDir, "app", "migrations"),
    logsDir: join(bridgeDir, "logs"),
    configWritten: false,
  };
}

function ensureBridgeConfig(context: BridgeReleaseContext): void {
  if (context.configWritten) {
    return;
  }
  mkdirSync(context.bridgeDir, { recursive: true, mode: 0o700 });
  writeFileSync(context.configPath, releaseBridgeConfigToml(context), { mode: 0o600 });
  context.configWritten = true;
}

function bridgeInstallDryRunStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "bridge-install-dry-run",
    "Bridge install dry-run in temp HOME",
    "pnpm",
    ["bridge:install", "--", "--dry-run"],
    {
      prepare: () => {
        ensureBridgeConfig(context);
        return {
          args: ["bridge:install", "--", "--dry-run", "--home", context.home],
        };
      },
    },
  );
}

function bridgeInstallStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "bridge-install",
    "Bridge install with installed daemon preflight",
    "pnpm",
    ["bridge:install"],
    {
      prepare: () => {
        ensureBridgeConfig(context);
        return { args: ["bridge:install", "--", "--home", context.home] };
      },
      safeOutputPattern: /preflight:\s*ok/i,
    },
  );
}

function launchdInstallDryRunStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "launchd-install-dry-run",
    "launchd install dry-run against installed bridge",
    "pnpm",
    ["launchd:install", "--dry-run"],
    {
      prepare: () => {
        ensureBridgeConfig(context);
        return {
          args: [
            "launchd:install",
            "--",
            "--dry-run",
            "--home",
            context.home,
            "--daemon-entry",
            context.appDaemon,
            "--wrapper-entry",
            context.wrapperEntry,
          ],
        };
      },
    },
  );
}

function loadAndRunDryRunStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "load-and-run-dry-run",
    "Installed Keychain wrapper dry-run",
    "bash",
    ["bin/load-and-run.sh", "--dry-run"],
    {
      prepare: () => {
        ensureBridgeConfig(context);
        const shimDir = mkdtempSync(join(tmpdir(), "codex-im-release-security-"));
        writeFileSync(
          join(shimDir, "security"),
          ["#!/usr/bin/env bash", 'printf "%s" "$FAKE_SECURITY_TOKEN"'].join("\n"),
          { mode: 0o700 },
        );
        return {
          command: "bash",
          args: [context.wrapperEntry, "--dry-run"],
          env: {
            PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
            USER: process.env.USER ?? "codex",
            NODE_BIN: process.execPath,
            DAEMON_ENTRY: context.appDaemon,
            CONFIG_PATH: context.configPath,
            MIGRATIONS_DIR: context.migrationsDir,
            FAKE_SECURITY_TOKEN: FAKE_KEYCHAIN_TOKEN,
          },
        };
      },
    },
  );
}

function bridgeRedactionScanStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "bridge-redaction-scan",
    "Bridge installed artifact and launchd plist redaction scan",
    "node",
    ["scripts/bridge-redaction-scan.mjs"],
    {
      prepare: () => {
        ensureBridgeConfig(context);
        return {
          env: {
            BRIDGE_HOME: context.home,
            BRIDGE_DAEMON: context.appDaemon,
            BRIDGE_WRAPPER: context.wrapperEntry,
            BRIDGE_CONFIG: context.configPath,
            BRIDGE_MIGRATIONS: context.migrationsDir,
            BRIDGE_LOGS: context.logsDir,
            NODE_BIN: process.execPath,
            FAKE_SECURITY_TOKEN_VALUE: FAKE_KEYCHAIN_TOKEN,
          },
        };
      },
      safeOutputPattern: /redaction scan ok/i,
    },
  );
}

function daemonRoundtripSmokeStep(context: BridgeReleaseContext): ReleaseReadinessStep {
  return step(
    "smoke-daemon-roundtrip",
    "Daemon injected roundtrip smoke",
    "pnpm",
    ["smoke:daemon-roundtrip"],
    {
      prepare: () => ({
        env: {
          CODEX_IM_SMOKE_MIGRATIONS_DIR: context.migrationsDir,
        },
      }),
      safeOutputPattern: /smoke:daemon-roundtrip ok/i,
    },
  );
}

function sqliteBackupProofStep(): ReleaseReadinessStep {
  return step("db-backup-proof", "SQLite backup proof", "pnpm", ["db:backup", "--"], {
    prepare: () => {
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
        throw new Error(`sqlite setup failed\n${create.stderr ?? ""}`);
      }
      return {
        args: ["db:backup", "--", "--source", sourcePath, "--backup-dir", backupDir, "--keep", "1"],
      };
    },
  });
}

function releaseBridgeConfigToml(context: BridgeReleaseContext): string {
  return `
[daemon]
data_dir = "${context.bridgeDir}/data"
log_dir = "${context.logsDir}"

[storage]
sqlite_path = "${context.bridgeDir}/data/state.db"
auto_migrate = true

[codex]
binary = "codex"
version_pin = "0.128.0"

[security]
allowed_users = []
allowed_chats = []
admin_users = []

[security.commands]
deny_patterns = []
require_admin_patterns = []

[adapters.telegram]
enabled = false
bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

[adapters.lark]
enabled = false
app_id = "disabled"
app_secret_env = "LARK_APP_SECRET"
domain = "feishu"
allowed_chat_ids = []

[adapters.dingtalk]
enabled = false
client_id = "disabled"
client_secret_env = "DINGTALK_CLIENT_SECRET"

[projects.default]
cwd = "${context.home}"
allowed_users = []
allowed_chats = []
writable_roots = ["${context.home}"]
`;
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

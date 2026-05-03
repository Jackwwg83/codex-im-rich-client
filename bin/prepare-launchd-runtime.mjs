#!/usr/bin/env node
import { constants, accessSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CONFIG_PATH = ".codex-im-bridge/config.toml";
const TOKEN_SHAPED_LITERAL = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const SECRET_ENV_LITERAL = /IM_TELEGRAM_BOT_TOKEN|bot_token/i;

export function renderDaemonEntry(plan) {
  const cliEntry = join(plan.repoRoot, "packages", "cli", "src", "index.ts");
  const lines = [
    "#!/usr/bin/env node",
    'import { spawn } from "node:child_process";',
    "",
    `const PNPM_BIN = ${JSON.stringify(plan.pnpmBin)};`,
    `const REPO_ROOT = ${JSON.stringify(plan.repoRoot)};`,
    `const CLI_ENTRY = ${JSON.stringify(cliEntry)};`,
    `const CONFIG_PATH = ${JSON.stringify(plan.configPath)};`,
    `const MIGRATIONS_DIR = ${JSON.stringify(plan.migrationsDir)};`,
    "",
    "const child = spawn(",
    "  PNPM_BIN,",
    '  ["exec", "tsx", CLI_ENTRY, "daemon", "run", "--config", CONFIG_PATH, "--migrations-dir", MIGRATIONS_DIR],',
    '  { cwd: REPO_ROOT, env: process.env, stdio: "inherit" },',
    ");",
    "",
    "let exiting = false;",
    "const forward = (signal) => {",
    "  if (exiting) return;",
    "  exiting = true;",
    "  child.kill(signal);",
    "};",
    'process.once("SIGINT", () => forward("SIGINT"));',
    'process.once("SIGTERM", () => forward("SIGTERM"));',
    "",
    'child.once("error", (error) => {',
    "  console.error(`codex-im daemon entry failed to spawn pnpm: ${error.message}`);",
    "  process.exitCode = 1;",
    "});",
    "",
    'child.once("exit", (code, signal) => {',
    "  if (signal !== null) {",
    "    process.kill(process.pid, signal);",
    "    return;",
    "  }",
    "  process.exit(code ?? 1);",
    "});",
    "",
  ].join("\n");

  assertNoRuntimeSecretMaterial(lines);
  return lines;
}

export function assertNoRuntimeSecretMaterial(text, forbiddenSubstrings = []) {
  if (TOKEN_SHAPED_LITERAL.test(text)) {
    throw new Error("prepare-launchd-runtime: generated daemon entry contains token-shaped text");
  }
  if (SECRET_ENV_LITERAL.test(text)) {
    throw new Error(
      "prepare-launchd-runtime: generated daemon entry must not reference token names",
    );
  }
  for (const secret of forbiddenSubstrings) {
    if (secret.length > 0 && text.includes(secret)) {
      throw new Error("prepare-launchd-runtime: generated daemon entry contains forbidden secret");
    }
  }
}

export async function planLaunchdRuntime(options = {}) {
  const env = options.env ?? process.env;
  const home = required(options.home ?? env.HOME, "HOME");
  const runtimeDir = options.runtimeDir ?? join(home, ".codex-im-bridge", "bin");
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const wrapperSource = options.wrapperSource ?? join(repoRoot, "bin", "load-and-run.sh");
  const wrapperEntry = options.wrapperEntry ?? join(runtimeDir, "load-and-run.sh");
  const daemonEntry = options.daemonEntry ?? join(runtimeDir, "daemon.mjs");
  const configPath = resolve(options.configPath ?? join(home, DEFAULT_CONFIG_PATH));
  const migrationsDir = resolve(
    options.migrationsDir ?? join(repoRoot, "packages", "storage-sqlite", "src", "migrations"),
  );
  const pnpmBin = required(options.pnpmBin ?? resolvePnpmBin(env), "PNPM_BIN or pnpm on PATH");
  const nodeBin = required(options.nodeBin ?? process.execPath, "NODE_BIN");
  const daemonSource = renderDaemonEntry({
    repoRoot,
    pnpmBin,
    configPath,
    migrationsDir,
  });

  return {
    home,
    runtimeDir,
    repoRoot,
    wrapperSource,
    wrapperEntry,
    daemonEntry,
    nodeBin,
    pnpmBin,
    configPath,
    migrationsDir,
    daemonSource,
  };
}

export async function prepareLaunchdRuntime(options = {}) {
  const plan = await planLaunchdRuntime(options);
  if (options.dryRun === true) {
    return { dryRun: true, plan, wroteWrapper: false, wroteDaemon: false };
  }

  const wrapperSource = await readFile(plan.wrapperSource, "utf8");
  await mkdir(plan.runtimeDir, { recursive: true, mode: 0o700 });
  await writeFile(plan.wrapperEntry, wrapperSource, { mode: 0o700 });
  await chmod(plan.wrapperEntry, 0o700);
  await writeFile(plan.daemonEntry, plan.daemonSource, { mode: 0o700 });
  await chmod(plan.daemonEntry, 0o700);
  return { dryRun: false, plan, wroteWrapper: true, wroteDaemon: true };
}

function resolvePnpmBin(env) {
  if (typeof env.PNPM_BIN === "string" && env.PNPM_BIN.length > 0) {
    return env.PNPM_BIN;
  }
  const fromPath = findExecutableOnPath("pnpm", env.PATH);
  if (fromPath !== undefined) {
    return fromPath;
  }
  if (typeof env.npm_execpath === "string" && env.npm_execpath.length > 0) {
    return env.npm_execpath;
  }
  return undefined;
}

function findExecutableOnPath(name, pathValue) {
  if (typeof pathValue !== "string" || pathValue.length === 0) {
    return undefined;
  }
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return undefined;
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`prepare-launchd-runtime: ${name} is required`);
  }
  return value;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "dry-run": { type: "boolean", default: false },
      home: { type: "string" },
      "node-bin": { type: "string" },
      "pnpm-bin": { type: "string" },
      "repo-root": { type: "string" },
      config: { type: "string" },
      "migrations-dir": { type: "string" },
      "wrapper-entry": { type: "string" },
      "daemon-entry": { type: "string" },
    },
  });
  const result = await prepareLaunchdRuntime({
    dryRun: values["dry-run"],
    home: values.home,
    nodeBin: values["node-bin"],
    pnpmBin: values["pnpm-bin"],
    repoRoot: values["repo-root"],
    configPath: values.config,
    migrationsDir: values["migrations-dir"],
    wrapperEntry: values["wrapper-entry"],
    daemonEntry: values["daemon-entry"],
  });
  const lines = [
    `runtime: ${result.plan.runtimeDir}`,
    `wrapper: ${result.plan.wrapperEntry}`,
    `daemon: ${result.plan.daemonEntry}`,
    `repo: ${result.plan.repoRoot}`,
    `pnpm: ${result.plan.pnpmBin}`,
    `config: ${result.plan.configPath}`,
    `mode: ${result.dryRun ? "dry-run" : "prepared"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

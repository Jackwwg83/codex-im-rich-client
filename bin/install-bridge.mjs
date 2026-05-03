#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants, accessSync, readFileSync } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE_DIR_NAME = ".codex-im-bridge";
const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const GENERIC_SECRET_RE =
  /\b(?:ghp_[A-Za-z0-9_]{20,}|xox[abdprs]-[A-Za-z0-9-]{10,}|sk-(?!ip\b)[A-Za-z0-9_-]{20,}|Authorization:\s*Bearer\s+\S+)/i;

export function planBridgeInstall(options = {}) {
  const env = options.env ?? process.env;
  const home = resolve(required(options.home ?? env.HOME, "HOME"));
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const bridgeDir = resolve(options.bridgeDir ?? join(home, BRIDGE_DIR_NAME));
  const appDir = join(bridgeDir, "app");
  const binDir = join(bridgeDir, "bin");
  const dataDir = join(bridgeDir, "data");
  const logsDir = join(bridgeDir, "logs");
  const nodeModulesDir = join(appDir, "node_modules");
  const migrationsDir = join(appDir, "migrations");
  const configPath = resolve(options.configPath ?? join(bridgeDir, "config.toml"));
  const appDaemon = resolve(options.appDaemon ?? join(appDir, "daemon.mjs"));
  const wrapperEntry = resolve(options.wrapperEntry ?? join(binDir, "load-and-run.sh"));
  const daemonBundle = resolve(
    options.daemonBundle ?? join(repoRoot, "dist", "codex-im-daemon.mjs"),
  );
  const wrapperSource = resolve(options.wrapperSource ?? join(repoRoot, "bin", "load-and-run.sh"));
  const sourceMigrationsDir = resolve(
    options.sourceMigrationsDir ??
      join(repoRoot, "packages", "storage-sqlite", "src", "migrations"),
  );
  const runtimePackages = options.runtimePackages ?? resolveRuntimePackages(repoRoot);
  const appPackageJson = join(appDir, "package.json");
  const appPackage = {
    name: "codex-im-bridge-runtime",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: Object.fromEntries(
      runtimePackages.map((runtimePackage) => [runtimePackage.name, runtimePackage.version]),
    ),
  };

  const plan = {
    home,
    repoRoot,
    bridgeDir,
    appDir,
    binDir,
    dataDir,
    logsDir,
    nodeModulesDir,
    migrationsDir,
    configPath,
    daemonBundle,
    appDaemon,
    wrapperSource,
    wrapperEntry,
    sourceMigrationsDir,
    appPackageJson,
    appPackage,
    nodeBin: resolve(options.nodeBin ?? process.execPath),
    runtimePackages: runtimePackages.map((runtimePackage) => ({
      ...runtimePackage,
      targetDir: join(nodeModulesDir, runtimePackage.name),
    })),
  };
  assertNoBridgeSecretMaterial(formatBridgePlan(plan));
  return plan;
}

export async function installBridge(options = {}) {
  const plan = planBridgeInstall(options);
  await requireReadableRegularFile(plan.configPath, "config.toml");
  await requireReadableRegularFile(plan.daemonBundle, "daemon bundle");
  await requireReadableRegularFile(plan.wrapperSource, "Keychain wrapper");
  await requireReadableDirectory(plan.sourceMigrationsDir, "source migrations");
  await assertNoSymlinkTargets(plan);

  if (options.dryRun === true) {
    return { dryRun: true, plan, wroteApp: false, preflight: "skipped" };
  }

  await mkdir(plan.appDir, { recursive: true, mode: 0o700 });
  await mkdir(plan.binDir, { recursive: true, mode: 0o700 });
  await mkdir(plan.dataDir, { recursive: true, mode: 0o700 });
  await mkdir(plan.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(plan.nodeModulesDir, { recursive: true, mode: 0o700 });
  await chmod(plan.appDir, 0o700);
  await chmod(plan.binDir, 0o700);
  await chmod(plan.dataDir, 0o700);
  await chmod(plan.logsDir, 0o700);

  await copyFile(plan.daemonBundle, plan.appDaemon);
  await chmod(plan.appDaemon, 0o755);
  await copyFile(plan.wrapperSource, plan.wrapperEntry);
  await chmod(plan.wrapperEntry, 0o755);
  await writeFile(plan.appPackageJson, `${JSON.stringify(plan.appPackage, null, 2)}\n`, {
    mode: 0o600,
  });

  await rm(plan.migrationsDir, { recursive: true, force: true });
  await cp(plan.sourceMigrationsDir, plan.migrationsDir, { recursive: true, force: true });

  for (const runtimePackage of plan.runtimePackages) {
    await copyRuntimePackage(runtimePackage.sourceDir, runtimePackage.targetDir);
  }

  const preflight =
    options.preflight === false
      ? "skipped"
      : await runInstalledDaemonPreflight(plan, { env: options.env });
  return { dryRun: false, plan, wroteApp: true, preflight };
}

export async function runInstalledDaemonPreflight(plan, options = {}) {
  const args = [
    plan.appDaemon,
    "--preflight",
    "--config",
    plan.configPath,
    "--migrations-dir",
    plan.migrationsDir,
  ];
  const result = await spawnCapture(plan.nodeBin, args, {
    cwd: plan.home,
    env: options.env ?? process.env,
  });
  assertNoBridgeSecretMaterial(`${result.stdout}\n${result.stderr}`);
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `install-bridge: installed daemon preflight failed with exit ${result.exitCode}`,
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join(": "),
    );
  }
  if (!/daemon preflight: ok/.test(result.stdout)) {
    throw new Error("install-bridge: installed daemon preflight did not report ok");
  }
  return "ok";
}

export function assertNoBridgeSecretMaterial(text) {
  if (TOKEN_SHAPED_RE.test(text) || GENERIC_SECRET_RE.test(text)) {
    throw new Error("install-bridge: output contains token-shaped material");
  }
}

function resolveRuntimePackages(repoRoot) {
  const cliRequire = createRequire(
    pathToFileURL(join(repoRoot, "packages", "cli", "src", "daemon-run.ts")),
  );
  const betterSqlite = readRuntimePackage("better-sqlite3", cliRequire);
  const betterSqliteRequire = createRequire(
    pathToFileURL(join(betterSqlite.sourceDir, "package.json")),
  );
  const bindings = readRuntimePackage("bindings", betterSqliteRequire);
  const bindingsRequire = createRequire(pathToFileURL(join(bindings.sourceDir, "package.json")));
  const fileUriToPath = readRuntimePackage("file-uri-to-path", bindingsRequire);
  return [betterSqlite, bindings, fileUriToPath];
}

function readRuntimePackage(name, requireFn) {
  const packageJsonPath = requireFn.resolve(`${name}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return {
    name,
    version: String(packageJson.version),
    sourceDir: dirname(packageJsonPath),
  };
}

async function copyRuntimePackage(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = relative(sourceDir, source);
      return rel === "" || !rel.split(sep).includes("node_modules");
    },
  });
  await assertNoSymlinksUnder(targetDir);
}

async function assertNoSymlinkTargets(plan) {
  const paths = [
    ["bridge dir", plan.bridgeDir],
    ["config.toml", plan.configPath],
    ["app dir", plan.appDir],
    ["bin dir", plan.binDir],
    ["data dir", plan.dataDir],
    ["logs dir", plan.logsDir],
    ["daemon entry", plan.appDaemon],
    ["wrapper entry", plan.wrapperEntry],
    ["node_modules dir", plan.nodeModulesDir],
    ["migrations dir", plan.migrationsDir],
    ["app package.json", plan.appPackageJson],
    ...plan.runtimePackages.map((runtimePackage) => [
      `${runtimePackage.name} package`,
      runtimePackage.targetDir,
    ]),
  ];
  for (const [label, path] of paths) {
    await assertPathIsNotSymlink(path, label);
  }
}

async function assertPathIsNotSymlink(path, label) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`install-bridge: refusing symlink ${label}: ${path}`);
    }
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function assertNoSymlinksUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`install-bridge: refusing copied symlink: ${child}`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinksUnder(child);
    }
  }
}

async function requireReadableRegularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new Error(`install-bridge: ${label} is required: ${path}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`install-bridge: ${label} must not be a symlink: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`install-bridge: ${label} must be a regular file: ${path}`);
  }
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw new Error(`install-bridge: ${label} must be readable: ${path}`);
  }
}

async function requireReadableDirectory(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new Error(`install-bridge: ${label} is required: ${path}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`install-bridge: ${label} must not be a symlink: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`install-bridge: ${label} must be a directory: ${path}`);
  }
}

function spawnCapture(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => {
      resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

function formatBridgePlan(plan) {
  return [
    `bridge: ${plan.bridgeDir}`,
    `config: ${plan.configPath}`,
    `app: ${plan.appDir}`,
    `daemon: ${plan.appDaemon}`,
    `wrapper: ${plan.wrapperEntry}`,
    `migrations: ${plan.migrationsDir}`,
    `node: ${plan.nodeBin}`,
    `runtime packages: ${plan.runtimePackages
      .map((runtimePackage) => `${runtimePackage.name}@${runtimePackage.version}`)
      .join(", ")}`,
  ].join("\n");
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`install-bridge: ${name} is required`);
  }
  return value;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "dry-run": { type: "boolean", default: false },
      home: { type: "string" },
      config: { type: "string" },
      "repo-root": { type: "string" },
      "daemon-bundle": { type: "string" },
      "node-bin": { type: "string" },
      "skip-preflight": { type: "boolean", default: false },
    },
  });
  const result = await installBridge({
    dryRun: values["dry-run"],
    home: values.home,
    configPath: values.config,
    repoRoot: values["repo-root"],
    daemonBundle: values["daemon-bundle"],
    nodeBin: values["node-bin"],
    preflight: values["skip-preflight"] ? false : undefined,
  });
  const lines = [
    formatBridgePlan(result.plan),
    `mode: ${result.dryRun ? "dry-run" : "installed"}`,
    `preflight: ${result.preflight}`,
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

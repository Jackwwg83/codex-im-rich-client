#!/usr/bin/env node
import { lstat, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const BRIDGE_DIR_NAME = ".codex-im-bridge";

export function planBridgeUninstall(options = {}) {
  const env = options.env ?? process.env;
  const home = resolve(required(options.home ?? env.HOME, "HOME"));
  const bridgeDir = resolve(options.bridgeDir ?? join(home, BRIDGE_DIR_NAME));
  const appDir = join(bridgeDir, "app");
  const wrapperEntry = join(bridgeDir, "bin", "load-and-run.sh");
  assertSafeBridgePath(appDir, bridgeDir);
  assertSafeBridgePath(wrapperEntry, bridgeDir);
  return { home, bridgeDir, appDir, wrapperEntry };
}

export async function uninstallBridge(options = {}) {
  const plan = planBridgeUninstall(options);
  if (options.dryRun === true) {
    return { dryRun: true, plan, removedApp: false, removedWrapper: false };
  }
  await assertNotSymlink(plan.appDir, "app dir");
  await assertNotSymlink(plan.wrapperEntry, "wrapper entry");
  const removedApp = await removePath(plan.appDir);
  const removedWrapper = await removePath(plan.wrapperEntry);
  return { dryRun: false, plan, removedApp, removedWrapper };
}

export function assertSafeBridgePath(path, bridgeDir) {
  const rel = relative(bridgeDir, path);
  if (rel.startsWith("..") || rel.length === 0) {
    throw new Error(`uninstall-bridge: refusing path outside bridge artifacts: ${path}`);
  }
}

async function assertNotSymlink(path, label) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`uninstall-bridge: refusing symlink ${label}: ${path}`);
    }
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function removePath(path) {
  try {
    await rm(path, { recursive: true, force: false });
    return true;
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`uninstall-bridge: ${name} is required`);
  }
  return value;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "dry-run": { type: "boolean", default: false },
      home: { type: "string" },
    },
  });
  const result = await uninstallBridge({
    dryRun: values["dry-run"],
    home: values.home,
  });
  const lines = [
    `bridge: ${result.plan.bridgeDir}`,
    `app: ${result.plan.appDir}`,
    `wrapper: ${result.plan.wrapperEntry}`,
    `mode: ${result.dryRun ? "dry-run" : "uninstalled"}`,
    "config: untouched",
    "data: untouched",
    "logs: untouched",
    "keychain: untouched",
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

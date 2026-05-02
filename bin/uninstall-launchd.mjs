#!/usr/bin/env node
import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const LABEL = "io.codex-im-bridge";
const PLIST_NAME = `${LABEL}.plist`;
const TOKEN_SHAPED_LITERAL = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;

export function planLaunchdUninstall(options = {}) {
  const env = options.env ?? process.env;
  const home = required(options.home ?? env.HOME, "HOME");
  const plistPath = options.plistPath ?? join(home, "Library", "LaunchAgents", PLIST_NAME);
  assertSafePlistPath(plistPath, home);
  return {
    label: LABEL,
    home,
    plistPath,
    launchctlArgs: ["unload", plistPath],
  };
}

export async function uninstallLaunchd(options = {}) {
  const plan = planLaunchdUninstall(options);
  assertNoTokenMaterial(`${plan.plistPath}\n${plan.launchctlArgs.join(" ")}`);
  if (options.dryRun === true) {
    return { dryRun: true, plan, unloaded: false, removed: false };
  }

  await (options.runLaunchctl ?? runLaunchctl)(plan.launchctlArgs);
  const removed = await removePlist(plan.plistPath, options.unlink ?? unlink);
  return { dryRun: false, plan, unloaded: true, removed };
}

export function assertSafePlistPath(plistPath, home) {
  const launchAgentsDir = join(home, "Library", "LaunchAgents");
  if (!isAbsolute(plistPath)) {
    throw new Error("uninstall-launchd: plist path must be absolute");
  }
  const rel = relative(launchAgentsDir, plistPath);
  if (rel.startsWith("..") || isAbsolute(rel) || basename(plistPath) !== PLIST_NAME) {
    throw new Error("uninstall-launchd: refusing to remove path outside LaunchAgents plist");
  }
}

function assertNoTokenMaterial(text) {
  if (TOKEN_SHAPED_LITERAL.test(text)) {
    throw new Error("uninstall-launchd: command plan contains token-shaped material");
  }
}

async function removePlist(plistPath, unlinkFn) {
  try {
    await unlinkFn(plistPath);
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
    throw new Error(`uninstall-launchd: ${name} is required`);
  }
  return value;
}

async function runLaunchctl(args) {
  const child = spawn("launchctl", args, { stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`uninstall-launchd: launchctl ${args.join(" ")} failed with exit ${code}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      home: { type: "string" },
      "plist-path": { type: "string" },
    },
  });
  const result = await uninstallLaunchd({
    dryRun: values["dry-run"],
    home: values.home,
    plistPath: values["plist-path"],
  });
  const lines = [
    `label: ${result.plan.label}`,
    `plist: ${result.plan.plistPath}`,
    `launchctl: launchctl ${result.plan.launchctlArgs.join(" ")}`,
    `mode: ${result.dryRun ? "dry-run" : "uninstalled"}`,
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

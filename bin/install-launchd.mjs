#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { prepareLaunchdRuntime } from "./prepare-launchd-runtime.mjs";

const LABEL = "io.codex-im-bridge";
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TEMPLATE_PATH = join(REPO_ROOT, "templates", `${LABEL}.plist.tmpl`);
const TOKEN_SHAPED_LITERAL = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const SECRET_NAME_LITERAL = /bot_token/i;

export function escapeXmlText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderLaunchdPlist(template, replacements) {
  const rendered = Object.entries(replacements).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, escapeXmlText(value)),
    template,
  );
  const unresolved = rendered.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved !== null) {
    throw new Error(`install-launchd: unresolved plist placeholders: ${unresolved.join(", ")}`);
  }
  assertNoLaunchdSecretMaterial(rendered, replacements.forbiddenSubstrings ?? []);
  return rendered;
}

export function assertNoLaunchdSecretMaterial(renderedPlist, forbiddenSubstrings = []) {
  if (TOKEN_SHAPED_LITERAL.test(renderedPlist)) {
    throw new Error("install-launchd: rendered plist contains a token-shaped literal");
  }
  if (SECRET_NAME_LITERAL.test(renderedPlist)) {
    throw new Error("install-launchd: rendered plist must not reference bot token material");
  }
  for (const secret of forbiddenSubstrings) {
    if (secret.length > 0 && renderedPlist.includes(secret)) {
      throw new Error("install-launchd: rendered plist contains forbidden secret material");
    }
  }
}

export async function planLaunchdInstall(options = {}) {
  const env = options.env ?? process.env;
  const home = required(options.home ?? env.HOME, "HOME");
  const user = required(options.user ?? env.USER, "USER");
  const nodeBin = required(options.nodeBin ?? process.execPath, "NODE_BIN");
  const daemonEntry = options.daemonEntry ?? join(home, ".codex-im-bridge", "app", "daemon.mjs");
  const wrapperEntry =
    options.wrapperEntry ?? join(home, ".codex-im-bridge", "bin", "load-and-run.sh");
  const plistPath = options.plistPath ?? join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const template =
    options.template ?? (await readFile(options.templatePath ?? DEFAULT_TEMPLATE_PATH, "utf8"));
  const renderedPlist = renderLaunchdPlist(template, {
    HOME: home,
    NODE_BIN: nodeBin,
    DAEMON_ENTRY: daemonEntry,
    WRAPPER_ENTRY: wrapperEntry,
    forbiddenSubstrings: options.forbiddenSubstrings ?? [],
  });
  return {
    label: LABEL,
    user,
    home,
    nodeBin,
    daemonEntry,
    wrapperEntry,
    plistPath,
    renderedPlist,
    launchctlArgs: ["load", plistPath],
  };
}

export async function installLaunchd(options = {}) {
  const plan = await planLaunchdInstall(options);
  if (options.dryRun === true) {
    await verifyLaunchdRuntimePaths(plan, {
      access: options.access ?? access,
      lstat: options.lstat ?? lstat,
      stat: options.stat ?? stat,
    });
    return { dryRun: true, plan, wrotePlist: false, loaded: false };
  }

  const prepareRuntime =
    options.prepareRuntime === true
      ? prepareLaunchdRuntime
      : typeof options.prepareRuntime === "function"
        ? options.prepareRuntime
        : undefined;
  if (prepareRuntime !== undefined) {
    await prepareRuntime({
      home: plan.home,
      nodeBin: plan.nodeBin,
      daemonEntry: plan.daemonEntry,
      wrapperEntry: plan.wrapperEntry,
    });
  }
  await verifyLaunchdRuntimePaths(plan, {
    access: options.access ?? access,
    lstat: options.lstat ?? lstat,
    stat: options.stat ?? stat,
  });
  await (options.mkdir ?? mkdir)(dirname(plan.plistPath), { recursive: true });
  await (options.writeFile ?? writeFile)(plan.plistPath, plan.renderedPlist, { mode: 0o600 });
  await (options.runLaunchctl ?? runLaunchctl)(plan.launchctlArgs);
  return { dryRun: false, plan, wrotePlist: true, loaded: true };
}

export async function verifyLaunchdRuntimePaths(plan, options = {}) {
  const accessFn = options.access ?? access;
  const lstatFn = options.lstat ?? lstat;
  const statFn = options.stat ?? stat;
  await requireInstallFileAccess(
    lstatFn,
    statFn,
    accessFn,
    plan.wrapperEntry,
    "WRAPPER_ENTRY",
    constants.X_OK,
  );
  await requireFileAccess(statFn, accessFn, plan.nodeBin, "NODE_BIN", constants.X_OK);
  await requireInstallFileAccess(
    lstatFn,
    statFn,
    accessFn,
    plan.daemonEntry,
    "DAEMON_ENTRY",
    constants.R_OK,
  );
}

async function requireInstallFileAccess(lstatFn, statFn, accessFn, path, label, mode) {
  let linkStats;
  try {
    linkStats = await lstatFn(path);
  } catch (error) {
    throw new Error(`install-launchd: ${label} does not exist or is not accessible: ${path}`);
  }
  if (typeof linkStats.isSymbolicLink === "function" && linkStats.isSymbolicLink()) {
    throw new Error(`install-launchd: ${label} must not be a symlink: ${path}`);
  }
  await requireFileAccess(statFn, accessFn, path, label, mode);
}

async function requireFileAccess(statFn, accessFn, path, label, mode) {
  let stats;
  try {
    stats = await statFn(path);
  } catch (error) {
    throw new Error(`install-launchd: ${label} does not exist or is not accessible: ${path}`);
  }
  if (typeof stats.isFile !== "function" || !stats.isFile()) {
    throw new Error(`install-launchd: ${label} must be a regular file: ${path}`);
  }
  try {
    await accessFn(path, mode);
  } catch (error) {
    const accessName = mode === constants.X_OK ? "executable" : "readable";
    throw new Error(`install-launchd: ${label} must be ${accessName}: ${path}`);
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`install-launchd: ${name} is required`);
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
    throw new Error(`install-launchd: launchctl ${args.join(" ")} failed with exit ${code}`);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "dry-run": { type: "boolean", default: false },
      home: { type: "string" },
      user: { type: "string" },
      "node-bin": { type: "string" },
      "daemon-entry": { type: "string" },
      "wrapper-entry": { type: "string" },
      "plist-path": { type: "string" },
    },
  });
  const result = await installLaunchd({
    dryRun: values["dry-run"],
    home: values.home,
    user: values.user,
    nodeBin: values["node-bin"],
    daemonEntry: values["daemon-entry"],
    wrapperEntry: values["wrapper-entry"],
    plistPath: values["plist-path"],
  });
  const lines = [
    `label: ${result.plan.label}`,
    `user: ${result.plan.user}`,
    `plist: ${result.plan.plistPath}`,
    `wrapper: ${result.plan.wrapperEntry}`,
    `node: ${result.plan.nodeBin}`,
    `daemon: ${result.plan.daemonEntry}`,
    `launchctl: launchctl ${result.plan.launchctlArgs.join(" ")}`,
    `mode: ${result.dryRun ? "dry-run" : "installed"}`,
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

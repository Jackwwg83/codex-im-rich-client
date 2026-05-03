#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const LABEL = "io.codex-im-bridge";
const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;
const GENERIC_SECRET_RE =
  /\b(?:ghp_[A-Za-z0-9_]{20,}|xox[abdprs]-[A-Za-z0-9-]{10,}|sk-(?!ip\b)[A-Za-z0-9_-]{20,}|Authorization:\s*Bearer\s+\S+)/gi;

export function planLaunchdStatus(options = {}) {
  const env = options.env ?? process.env;
  const home = resolve(options.home ?? env.HOME ?? homedir());
  const uid = String(options.uid ?? process.getuid?.() ?? "");
  if (uid.length === 0) {
    throw new Error("launchd-status: uid is required");
  }
  const label = options.label ?? LABEL;
  return {
    home,
    uid,
    label,
    serviceTarget: `gui/${uid}/${label}`,
    plistPath: options.plistPath ?? join(home, "Library", "LaunchAgents", `${label}.plist`),
    statusPath: options.statusPath ?? join(home, ".codex-im-bridge", "daemon-status.json"),
  };
}

export async function runLaunchdStatus(options = {}) {
  const plan = planLaunchdStatus(options);
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? readFileSync;
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const launchctl = options.launchctl ?? ((target) => spawnCapture("launchctl", ["print", target]));
  const output = options.output ?? ((line) => process.stdout.write(`${line}\n`));

  const plistPresent = exists(plan.plistPath);
  const statusPresent = exists(plan.statusPath);
  const launchctlResult = await launchctl(plan.serviceTarget);
  const launchctlOk = launchctlResult.exitCode === 0;
  const statusSummary = statusPresent
    ? summarizeStatusSnapshot(readFile(plan.statusPath, "utf8"), pidAlive)
    : "missing";

  const lines = [
    `launchd target: ${plan.serviceTarget}`,
    `plist: ${plistPresent ? "present" : "missing"} ${plan.plistPath}`,
    `launchctl: ${launchctlOk ? "loaded" : "not-loaded"} exit=${launchctlResult.exitCode}`,
    `daemon status: ${statusSummary}`,
  ];
  if (!launchctlOk && launchctlResult.stderr.trim().length > 0) {
    lines.push(`launchctl stderr: ${redact(launchctlResult.stderr.trim())}`);
  }
  output(lines.join("\n"));
  return launchctlOk && statusPresent ? 0 : 2;
}

function summarizeStatusSnapshot(raw, pidAlive) {
  try {
    const parsed = JSON.parse(raw);
    const pid = typeof parsed.pid === "number" ? parsed.pid : "unknown";
    const startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown";
    const pending =
      typeof parsed.pendingApprovalCount === "number" ? parsed.pendingApprovalCount : "unknown";
    const threads =
      typeof parsed.currentCodexThreadCount === "number"
        ? parsed.currentCodexThreadCount
        : "unknown";
    const state = typeof pid === "number" && pidAlive(pid) ? "present" : "stale";
    return `${state} pid=${pid} startedAt=${startedAt} codexThreads=${threads} pendingApprovals=${pending}`;
  } catch (error) {
    return "invalid";
  }
}

function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function redact(value) {
  return value
    .replace(TOKEN_SHAPED_RE, "<redacted:telegram-token>")
    .replace(GENERIC_SECRET_RE, "<redacted:secret>");
}

async function spawnCapture(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return { exitCode, stdout: redact(stdout), stderr: redact(stderr) };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      home: { type: "string" },
      uid: { type: "string" },
      label: { type: "string" },
      "plist-path": { type: "string" },
      "status-file": { type: "string" },
    },
  });
  const exitCode = await runLaunchdStatus({
    home: values.home,
    uid: values.uid,
    label: values.label,
    plistPath: values["plist-path"],
    statusPath: values["status-file"],
  });
  process.exitCode = exitCode;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redact(message)}\n`);
    process.exitCode = 1;
  });
}

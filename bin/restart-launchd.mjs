#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const LABEL = "io.codex-im-bridge";

export function planLaunchdRestart(options = {}) {
  const uid = required(options.uid ?? String(process.getuid?.() ?? ""), "uid");
  const serviceTarget = options.serviceTarget ?? `gui/${uid}/${LABEL}`;
  return {
    serviceTarget,
    launchctlArgs: ["kickstart", "-k", serviceTarget],
  };
}

export async function runLaunchdRestart(options = {}) {
  const output = options.output ?? console.log;
  const plan = planLaunchdRestart(options);
  const lines = [
    `launchd target: ${plan.serviceTarget}`,
    `launchctl: launchctl ${plan.launchctlArgs.join(" ")}`,
  ];
  if (options.dryRun === true) {
    for (const line of [...lines, "mode: dry-run"]) {
      output(line);
    }
    return 0;
  }

  const exitCode = await (options.runLaunchctl ?? runLaunchctl)(plan.launchctlArgs);
  for (const line of [...lines, `mode: ${exitCode === 0 ? "restarted" : "failed"}`]) {
    output(line);
  }
  return exitCode;
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`restart-launchd: ${name} is required`);
  }
  return value;
}

async function runLaunchctl(args) {
  const child = spawn("launchctl", args, { stdio: "inherit" });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "dry-run": { type: "boolean", default: false },
      uid: { type: "string" },
    },
  });
  process.exitCode = await runLaunchdRestart({
    dryRun: values["dry-run"],
    uid: values.uid,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env -S pnpm exec tsx

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ComputerUsePolicy } from "../packages/core/src/computer-use-policy.js";
import {
  ComputerUseSessionRegistry,
  ComputerUseToolGate,
} from "../packages/core/src/computer-use-session.js";
import {
  type AppleScriptExecutor,
  MacChromeComputerUseProvider,
} from "../packages/daemon/src/mac-chrome-computer-use-provider.js";

type SmokeStatus = "skip" | "blocked" | "ready_dry_run" | "executed";

type SmokeReport = {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly providerVerified: "yes" | "no";
  readonly dryRun: "yes" | "no";
  readonly provider: "mac-chrome" | "missing" | "invalid";
  readonly app: "Google Chrome" | "missing" | "invalid";
  readonly task: "present" | "missing";
  readonly missing?: readonly string[];
  readonly reason?: string;
};

const REQUIRED_FOR_DRY_RUN = ["COMPUTER_USE_LIVE_APP", "COMPUTER_USE_LIVE_TASK"] as const;

async function main(): Promise<void> {
  if (process.env.COMPUTER_USE_LIVE !== "1") {
    printReport({
      ...baseReport("skip"),
      gate: "disabled",
      reason: "set COMPUTER_USE_LIVE=1 to enter the explicit live smoke gate",
    });
    console.log("[computer-use-live-smoke] SKIP: live Computer Use smoke is disabled.");
    return;
  }

  if (process.env.COMPUTER_USE_PROVIDER_VERIFIED !== "1") {
    printReport({
      ...baseReport("blocked"),
      reason: "real Computer Use provider capability is not verified",
    });
    console.error("[computer-use-live-smoke] BLOCKED: provider capability is not verified.");
    process.exitCode = 2;
    return;
  }

  if (process.env.COMPUTER_USE_LIVE_APP !== "Google Chrome") {
    printReport({
      ...baseReport("blocked"),
      reason: "only Google Chrome is allowed for Phase 6 live smoke",
    });
    console.error(
      "[computer-use-live-smoke] BLOCKED: COMPUTER_USE_LIVE_APP must be Google Chrome.",
    );
    process.exitCode = 2;
    return;
  }

  const missing = REQUIRED_FOR_DRY_RUN.filter((name) => process.env[name] === undefined);
  if (missing.length > 0) {
    printReport({ ...baseReport("blocked"), missing });
    console.error(`[computer-use-live-smoke] BLOCKED: missing ${missing.join(", ")}.`);
    process.exitCode = 2;
    return;
  }

  if (process.env.COMPUTER_USE_LIVE_DRY_RUN === "1") {
    printReport(baseReport("ready_dry_run"));
    console.log("[computer-use-live-smoke] READY_DRY_RUN: no desktop action was executed.");
    return;
  }

  if (providerStatus() !== "mac-chrome") {
    printReport({
      ...baseReport("blocked"),
      reason: "COMPUTER_USE_LIVE_PROVIDER must be mac-chrome for non-dry-run smoke",
    });
    console.error("[computer-use-live-smoke] BLOCKED: provider must be mac-chrome.");
    process.exitCode = 3;
    return;
  }

  const report = await runMacChromeSmoke();
  printReport(report);
  if (report.status === "executed") {
    console.log("[computer-use-live-smoke] EXECUTED: bounded Chrome provider action completed.");
    return;
  }
  console.error("[computer-use-live-smoke] BLOCKED: bounded Chrome provider action failed.");
  process.exitCode = 3;
}

function baseReport(status: SmokeStatus): SmokeReport {
  return {
    status,
    gate: process.env.COMPUTER_USE_LIVE === "1" ? "enabled" : "disabled",
    providerVerified: process.env.COMPUTER_USE_PROVIDER_VERIFIED === "1" ? "yes" : "no",
    dryRun: process.env.COMPUTER_USE_LIVE_DRY_RUN === "1" ? "yes" : "no",
    provider: providerStatus(),
    app: appStatus(),
    task: process.env.COMPUTER_USE_LIVE_TASK === undefined ? "missing" : "present",
  };
}

function appStatus(): SmokeReport["app"] {
  const app = process.env.COMPUTER_USE_LIVE_APP;
  if (app === undefined) return "missing";
  return app === "Google Chrome" ? "Google Chrome" : "invalid";
}

function providerStatus(): SmokeReport["provider"] {
  const provider = process.env.COMPUTER_USE_LIVE_PROVIDER;
  if (provider === undefined) return "missing";
  return provider === "mac-chrome" ? "mac-chrome" : "invalid";
}

async function runMacChromeSmoke(): Promise<SmokeReport> {
  const dir = mkdtempSync(join(tmpdir(), "codex-im-cu-smoke-"));
  try {
    const htmlPath = join(dir, "index.html");
    writeFileSync(
      htmlPath,
      [
        "<!doctype html>",
        '<meta charset="utf-8">',
        "<title>Codex IM Computer Use Smoke</title>",
        "<h1>Codex IM Computer Use Smoke</h1>",
      ].join("\n"),
    );
    const url = pathToFileURL(htmlPath).toString();
    const provider = new MacChromeComputerUseProvider({
      ...(process.env.COMPUTER_USE_LIVE_FAKE_EXECUTOR === "1"
        ? { execAppleScript: fakeExecutor(url) }
        : {}),
    });
    const navigateParams = {
      threadId: "computer-use-live-smoke",
      turnId: "computer-use-live-smoke",
      callId: "navigate",
      namespace: "codex_im.computer_use",
      tool: "operate",
      arguments: { app: "Google Chrome", action: "navigate", url },
    } as const;
    const navigate = await executeThroughGate(provider, navigateParams);
    if (!navigate.success) {
      return { ...baseReport("blocked"), reason: "navigate failed" };
    }
    const observeParams = {
      threadId: "computer-use-live-smoke",
      turnId: "computer-use-live-smoke",
      callId: "observe",
      namespace: "codex_im.computer_use",
      tool: "operate",
      arguments: { app: "Google Chrome", action: "observe" },
    } as const;
    const observe = await executeThroughGate(provider, observeParams);
    if (!observe.success) {
      return { ...baseReport("blocked"), reason: "observe failed" };
    }
    return baseReport("executed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function executeThroughGate(
  provider: MacChromeComputerUseProvider,
  params: Parameters<ComputerUseToolGate["handleToolCall"]>[0]["params"],
) {
  const registry = new ComputerUseSessionRegistry();
  registry.start({
    sessionId: "computer-use-live-smoke",
    targetKey: "smoke:local",
    actorKey: "smoke:operator",
    projectId: "codex-im",
    threadId: params.threadId,
    turnId: params.turnId,
    app: "Google Chrome",
    task: "computer use live smoke",
  });
  const gate = new ComputerUseToolGate({
    registry,
    policy: new ComputerUsePolicy({
      enabled: true,
      requireExplicitPrefix: true,
      defaultApp: "Google Chrome",
      allowedApps: ["Google Chrome"],
      denyApps: ["1Password", "Keychain Access", "System Settings", "Terminal"],
      unknownAppPolicy: "deny",
      requireApprovalKeywords: ["login", "password", "token"],
      liveSmokeEnabled: true,
    }),
    provider,
    allowedTools: [{ namespace: "codex_im.computer_use", tool: "operate" }],
  });
  return gate.handleToolCall({ params });
}

function fakeExecutor(url: string): AppleScriptExecutor {
  return async (script) => {
    if (script.includes("set URL of active tab")) {
      return { stdout: "navigated\n", stderr: "" };
    }
    if (script.includes("pageTitle")) {
      return { stdout: `Codex IM Computer Use Smoke\n${url}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

function printReport(report: SmokeReport): void {
  console.log(JSON.stringify(report, undefined, 2));
}

await main();

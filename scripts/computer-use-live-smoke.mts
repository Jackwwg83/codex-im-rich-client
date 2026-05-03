#!/usr/bin/env -S pnpm exec tsx

type SmokeStatus = "skip" | "blocked" | "ready_dry_run";

type SmokeReport = {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly providerVerified: "yes" | "no";
  readonly dryRun: "yes" | "no";
  readonly app: "Google Chrome" | "missing" | "invalid";
  readonly task: "present" | "missing";
  readonly missing?: readonly string[];
  readonly reason?: string;
};

const REQUIRED_FOR_DRY_RUN = ["COMPUTER_USE_LIVE_APP", "COMPUTER_USE_LIVE_TASK"] as const;

function main(): void {
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

  printReport({
    ...baseReport("blocked"),
    reason: "real desktop execution is not implemented in Phase 6 harness",
  });
  console.error("[computer-use-live-smoke] BLOCKED: real desktop execution is not implemented.");
  process.exitCode = 3;
}

function baseReport(status: SmokeStatus): SmokeReport {
  return {
    status,
    gate: process.env.COMPUTER_USE_LIVE === "1" ? "enabled" : "disabled",
    providerVerified: process.env.COMPUTER_USE_PROVIDER_VERIFIED === "1" ? "yes" : "no",
    dryRun: process.env.COMPUTER_USE_LIVE_DRY_RUN === "1" ? "yes" : "no",
    app: appStatus(),
    task: process.env.COMPUTER_USE_LIVE_TASK === undefined ? "missing" : "present",
  };
}

function appStatus(): SmokeReport["app"] {
  const app = process.env.COMPUTER_USE_LIVE_APP;
  if (app === undefined) return "missing";
  return app === "Google Chrome" ? "Google Chrome" : "invalid";
}

function printReport(report: SmokeReport): void {
  console.log(JSON.stringify(report, undefined, 2));
}

main();

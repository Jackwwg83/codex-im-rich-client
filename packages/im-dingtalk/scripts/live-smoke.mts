#!/usr/bin/env -S pnpm exec tsx

import { DingTalkChannelAdapter, createDingTalkStreamClient } from "../src/index.js";

const REQUIRED_FOR_LIVE = ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET_ENV"] as const;
const DEFAULT_DURATION_MS = 5_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 30_000;

type SmokeStatus = "skip" | "blocked" | "ready_dry_run" | "connected";

interface RedactedStatus {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly clientId: "present" | "missing";
  readonly clientSecretEnv: string | "missing";
  readonly clientSecret: "present" | "missing";
  readonly durationMs?: number;
  readonly robotEvents?: number;
  readonly cardEvents?: number;
  readonly missing?: readonly string[];
}

async function main(): Promise<void> {
  const gateEnabled = process.env.DINGTALK_LIVE === "1";
  if (!gateEnabled) {
    printStatus({
      ...redactedStatus("skip"),
      gate: "disabled",
    });
    console.log("[dingtalk-live-smoke] SKIP: set DINGTALK_LIVE=1 to enable explicit live smoke.");
    return;
  }

  const missing = missingLiveRequirements();
  if (missing.length > 0) {
    printStatus({ ...redactedStatus("blocked"), missing });
    console.error(`[dingtalk-live-smoke] BLOCKED: missing ${missing.join(", ")}.`);
    process.exitCode = 2;
    return;
  }

  const durationMs = parseDurationMs(process.env.DINGTALK_LIVE_DURATION_MS);
  if (process.env.DINGTALK_LIVE_DRY_RUN === "1") {
    printStatus({ ...redactedStatus("ready_dry_run"), durationMs });
    console.log("[dingtalk-live-smoke] READY_DRY_RUN: live env is present; no network call made.");
    return;
  }

  const counters = { robotEvents: 0, cardEvents: 0 };
  const streamClient = createDingTalkStreamClient({
    clientId: requiredEnv("DINGTALK_CLIENT_ID"),
    clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    debug: false,
  });
  const adapter = new DingTalkChannelAdapter({ streamClient });
  adapter.onMessage(() => {
    counters.robotEvents++;
  });
  adapter.onAction(() => {
    counters.cardEvents++;
  });

  try {
    await adapter.start();
    await sleep(durationMs);
    printStatus({
      ...redactedStatus("connected"),
      durationMs,
      robotEvents: counters.robotEvents,
      cardEvents: counters.cardEvents,
    });
    console.log("[dingtalk-live-smoke] CONNECTED: redacted Stream connection smoke completed.");
  } catch (error) {
    printStatus({ ...redactedStatus("blocked"), durationMs });
    console.error(`[dingtalk-live-smoke] BLOCKED: ${redactKnownValues(errorMessage(error))}`);
    process.exitCode = 3;
  } finally {
    await adapter.stop();
  }
}

function redactedStatus(status: SmokeStatus): RedactedStatus {
  const secretEnvName = process.env.DINGTALK_CLIENT_SECRET_ENV;
  return {
    status,
    gate: "enabled",
    clientId: present("DINGTALK_CLIENT_ID"),
    clientSecretEnv: secretEnvName ?? "missing",
    clientSecret: secretEnvName === undefined ? "missing" : present(secretEnvName),
  };
}

function printStatus(status: RedactedStatus): void {
  console.log(JSON.stringify(status, undefined, 2));
}

function missingLiveRequirements(): string[] {
  const missing = REQUIRED_FOR_LIVE.filter((name) => process.env[name] === undefined);
  const secretEnvName = process.env.DINGTALK_CLIENT_SECRET_ENV;
  if (secretEnvName !== undefined && process.env[secretEnvName] === undefined) {
    missing.push(secretEnvName as (typeof REQUIRED_FOR_LIVE)[number]);
  }
  return missing;
}

function present(name: string): "present" | "missing" {
  return process.env[name] === undefined ? "missing" : "present";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`required env missing: ${name}`);
  }
  return value;
}

function parseDurationMs(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_DURATION_MS;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new Error("DINGTALK_LIVE_DURATION_MS must be an integer");
  }
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, parsed));
}

function redactKnownValues(text: string): string {
  let out = text;
  for (const value of [
    process.env.DINGTALK_CLIENT_ID,
    process.env.DINGTALK_CLIENT_SECRET_ENV === undefined
      ? undefined
      : process.env[process.env.DINGTALK_CLIENT_SECRET_ENV],
  ]) {
    if (value !== undefined && value.length > 0) {
      out = out.split(value).join("<redacted>");
    }
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

await main();

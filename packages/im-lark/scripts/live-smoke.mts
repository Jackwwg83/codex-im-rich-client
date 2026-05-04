#!/usr/bin/env -S pnpm exec tsx

import * as lark from "@larksuiteoapi/node-sdk";
import { createLarkSdkAdapterOptions, renderLarkApprovalCard } from "../src/index.js";

const REQUIRED_FOR_LIVE = ["LARK_APP_ID", "LARK_APP_SECRET_ENV", "LARK_TARGET_CHAT_ID"] as const;

type SmokeStatus = "skip" | "blocked" | "ready_dry_run" | "sent";

interface RedactedStatus {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly mode: "text" | "card";
  readonly domain: "feishu" | "lark";
  readonly appId: "present" | "missing";
  readonly appSecretEnv: string | "missing";
  readonly appSecret: "present" | "missing";
  readonly targetChatId: "present" | "missing";
  readonly messageId?: "present";
  readonly missing?: readonly string[];
}

async function main(): Promise<void> {
  const gateEnabled = process.env.LARK_LIVE === "1";
  if (!gateEnabled) {
    printStatus({
      ...redactedStatus("skip"),
      gate: "disabled",
    });
    console.log("[lark-live-smoke] SKIP: set LARK_LIVE=1 to enable explicit live smoke.");
    return;
  }

  const missing = missingLiveRequirements();
  if (missing.length > 0) {
    printStatus({ ...redactedStatus("blocked"), missing });
    console.error(`[lark-live-smoke] BLOCKED: missing ${missing.join(", ")}.`);
    process.exitCode = 2;
    return;
  }

  if (process.env.LARK_LIVE_DRY_RUN === "1") {
    printStatus(redactedStatus("ready_dry_run"));
    console.log("[lark-live-smoke] READY_DRY_RUN: live env is present; no network call made.");
    return;
  }

  if (process.env.LARK_LIVE_CARD === "1") {
    const { messageClient } = createLarkSdkAdapterOptions(
      {
        appId: requiredEnv("LARK_APP_ID"),
        appSecret: requiredEnv(requiredEnv("LARK_APP_SECRET_ENV")),
        domain: larkDomainName(),
      },
      {
        createWsClient: () => ({
          async start() {},
          close() {},
        }),
      },
    );
    if (messageClient?.sendCard === undefined) {
      printStatus(redactedStatus("blocked"));
      console.error("[lark-live-smoke] BLOCKED: card message client unavailable.");
      process.exitCode = 4;
      return;
    }
    const card = renderLarkApprovalCard({
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-must-not-be-sent",
      summary: "Live Lark card schema smoke",
      target: { riskLevel: "high" },
      actions: [
        { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
        { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
      ],
      status: "pending",
      createdAt: new Date(0),
    });
    const result = await messageClient.sendCard({
      target: { platform: "lark", chatId: requiredEnv("LARK_TARGET_CHAT_ID") },
      card,
    });
    if (result.messageId.length === 0) {
      printStatus(redactedStatus("blocked"));
      console.error("[lark-live-smoke] BLOCKED: card send returned an empty message id.");
      process.exitCode = 5;
      return;
    }
    printStatus({ ...redactedStatus("sent"), messageId: "present" });
    console.log("[lark-live-smoke] SENT: redacted live card schema smoke succeeded.");
    return;
  }

  const client = new lark.Client({
    appId: requiredEnv("LARK_APP_ID"),
    appSecret: requiredEnv(requiredEnv("LARK_APP_SECRET_ENV")),
    appType: lark.AppType.SelfBuild,
    domain: larkDomain(),
  });
  const result = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: requiredEnv("LARK_TARGET_CHAT_ID"),
      msg_type: "text",
      content: JSON.stringify({
        text: process.env.LARK_LIVE_TEXT ?? `[codex-im] live smoke ${new Date().toISOString()}`,
      }),
    },
  });

  if (result.code !== undefined && result.code !== 0) {
    printStatus(redactedStatus("blocked"));
    console.error(`[lark-live-smoke] BLOCKED: SDK returned code ${result.code}.`);
    process.exitCode = 3;
    return;
  }

  printStatus({ ...redactedStatus("sent"), messageId: "present" });
  console.log("[lark-live-smoke] SENT: redacted live message send succeeded.");
}

function redactedStatus(status: SmokeStatus): RedactedStatus {
  const secretEnvName = process.env.LARK_APP_SECRET_ENV;
  return {
    status,
    gate: "enabled",
    mode: process.env.LARK_LIVE_CARD === "1" ? "card" : "text",
    domain: larkDomainName(),
    appId: present("LARK_APP_ID"),
    appSecretEnv: secretEnvName ?? "missing",
    appSecret: secretEnvName === undefined ? "missing" : present(secretEnvName),
    targetChatId: present("LARK_TARGET_CHAT_ID"),
  };
}

function printStatus(status: RedactedStatus): void {
  console.log(JSON.stringify(status, undefined, 2));
}

function missingLiveRequirements(): string[] {
  const missing = REQUIRED_FOR_LIVE.filter((name) => process.env[name] === undefined);
  const secretEnvName = process.env.LARK_APP_SECRET_ENV;
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

function larkDomainName(): "feishu" | "lark" {
  return process.env.LARK_DOMAIN === "lark" ? "lark" : "feishu";
}

function larkDomain(): lark.Domain {
  return larkDomainName() === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

await main();

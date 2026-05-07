#!/usr/bin/env -S pnpm exec tsx

import * as lark from "@larksuiteoapi/node-sdk";
import {
  LarkChannelAdapter,
  SILENT_LARK_SDK_LOGGER,
  createLarkSdkAdapterOptions,
  renderLarkApprovalCard,
} from "../src/index.js";

const REQUIRED_FOR_LIVE = ["LARK_APP_ID", "LARK_APP_SECRET_ENV", "LARK_TARGET_CHAT_ID"] as const;
const DEFAULT_INBOUND_ATTACHMENT_DURATION_MS = 60_000;
const MAX_INBOUND_ATTACHMENT_DURATION_MS = 120_000;

type SmokeStatus =
  | "skip"
  | "blocked"
  | "ready_dry_run"
  | "sent"
  | "updated"
  | "inbound_attachment_received";
type InboundAttachmentKind = "any" | "file" | "image";

interface RedactedStatus {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly mode: "text" | "card" | "file" | "inbound_attachment";
  readonly domain: "feishu" | "lark";
  readonly appId: "present" | "missing";
  readonly appSecretEnv: string | "missing";
  readonly appSecret: "present" | "missing";
  readonly targetChatId: "present" | "missing";
  readonly durationMs?: number;
  readonly messageEvents?: number;
  readonly attachmentEvents?: number;
  readonly inboundAttachmentKind?: "file" | "image";
  readonly inboundAttachmentLocalPath?: "present";
  readonly inboundAttachmentSizeBytes?: "present" | "missing";
  readonly inboundAttachmentFilename?: "present";
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

  if (process.env.LARK_LIVE_INBOUND_ATTACHMENT === "1") {
    await runLiveInboundAttachmentSmoke();
    return;
  }

  if (process.env.LARK_LIVE_FILE === "1") {
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
    if (messageClient?.sendFile === undefined) {
      printStatus(redactedStatus("blocked"));
      console.error("[lark-live-smoke] BLOCKED: file message client unavailable.");
      process.exitCode = 4;
      return;
    }
    const result = await messageClient.sendFile({
      target: { platform: "lark", chatId: requiredEnv("LARK_TARGET_CHAT_ID") },
      file: {
        filename: "codex-im-live-attachment.txt",
        bytes: new TextEncoder().encode(`codex-im lark attachment ${new Date().toISOString()}`),
        contentType: "text/plain",
      },
    });
    if (result.messageId.length === 0) {
      printStatus(redactedStatus("blocked"));
      console.error("[lark-live-smoke] BLOCKED: file send returned an empty message id.");
      process.exitCode = 5;
      return;
    }
    printStatus({ ...redactedStatus("sent"), messageId: "present" });
    console.log("[lark-live-smoke] SENT: redacted live file send succeeded.");
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
    if (process.env.LARK_LIVE_CARD_UPDATE === "1") {
      await messageClient.updateCard({
        messageRef: {
          target: { platform: "lark", chatId: requiredEnv("LARK_TARGET_CHAT_ID") },
          messageId: result.messageId,
        },
        card: renderLarkApprovalCard({
          schemaVersion: "approval-card.v1",
          kind: "command_execution",
          approvalId: "approval-must-not-be-sent",
          summary: "Live Lark CardKit update smoke",
          target: { riskLevel: "high" },
          actions: [{ kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" }],
          status: "resolved",
          createdAt: new Date(0),
        }),
      });
      printStatus({ ...redactedStatus("updated"), messageId: "present" });
      console.log("[lark-live-smoke] UPDATED: redacted live CardKit update smoke succeeded.");
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
    logger: SILENT_LARK_SDK_LOGGER,
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
    mode:
      process.env.LARK_LIVE_INBOUND_ATTACHMENT === "1"
        ? "inbound_attachment"
        : process.env.LARK_LIVE_FILE === "1"
          ? "file"
          : process.env.LARK_LIVE_CARD === "1"
            ? "card"
            : "text",
    domain: larkDomainName(),
    appId: present("LARK_APP_ID"),
    appSecretEnv: secretEnvName ?? "missing",
    appSecret: secretEnvName === undefined ? "missing" : present(secretEnvName),
    targetChatId: present("LARK_TARGET_CHAT_ID"),
  };
}

async function runLiveInboundAttachmentSmoke(): Promise<void> {
  const durationMs = parseLarkLiveInboundAttachmentDurationMs(process.env.LARK_LIVE_DURATION_MS);
  const wantedKind = parseLarkLiveInboundAttachmentKind(
    process.env.LARK_LIVE_INBOUND_ATTACHMENT_KIND,
  );
  const counters = { messageEvents: 0, attachmentEvents: 0 };
  let received:
    | {
        readonly kind: "file" | "image";
        readonly hasLocalPath: boolean;
        readonly hasSizeBytes: boolean;
        readonly hasFilename: boolean;
      }
    | undefined;
  const adapter = new LarkChannelAdapter(
    createLarkSdkAdapterOptions({
      appId: requiredEnv("LARK_APP_ID"),
      appSecret: requiredEnv(requiredEnv("LARK_APP_SECRET_ENV")),
      domain: larkDomainName(),
    }),
  );
  const unsubscribe = adapter.onMessage((message) => {
    counters.messageEvents++;
    for (const attachment of message.attachments ?? []) {
      if (wantedKind !== "any" && attachment.kind !== wantedKind) {
        continue;
      }
      counters.attachmentEvents++;
      if (received === undefined) {
        received = {
          kind: attachment.kind,
          hasLocalPath: attachment.localPath.length > 0,
          hasSizeBytes: attachment.sizeBytes !== undefined,
          hasFilename: attachment.filename.length > 0,
        };
      }
    }
  });

  try {
    await adapter.start();
    console.log(
      "[lark-live-smoke] INBOUND_ATTACHMENT_WAITING: send one Feishu/Lark image/file message to the bot during the smoke window.",
    );
    await waitFor(() => received !== undefined, durationMs);
    if (received === undefined) {
      printStatus({
        ...redactedStatus("blocked"),
        durationMs,
        messageEvents: counters.messageEvents,
        attachmentEvents: counters.attachmentEvents,
      });
      console.error(
        "[lark-live-smoke] BLOCKED: no Feishu/Lark inbound image/file attachment arrived before timeout.",
      );
      process.exitCode = 3;
      return;
    }
    printStatus({
      ...redactedStatus("inbound_attachment_received"),
      durationMs,
      messageEvents: counters.messageEvents,
      attachmentEvents: counters.attachmentEvents,
      inboundAttachmentKind: received.kind,
      inboundAttachmentLocalPath: received.hasLocalPath ? "present" : undefined,
      inboundAttachmentSizeBytes: received.hasSizeBytes ? "present" : "missing",
      inboundAttachmentFilename: received.hasFilename ? "present" : undefined,
    });
    console.log(
      "[lark-live-smoke] INBOUND_ATTACHMENT_RECEIVED: redacted live inbound attachment smoke completed.",
    );
  } finally {
    unsubscribe();
    await stopAdapterWithTimeout(adapter);
    scheduleProcessExit();
  }
}

async function stopAdapterWithTimeout(adapter: LarkChannelAdapter): Promise<void> {
  await Promise.race([adapter.stop(), new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
}

function scheduleProcessExit(): void {
  setTimeout(() => process.exit(process.exitCode ?? 0), 0);
}

function parseLarkLiveInboundAttachmentDurationMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_INBOUND_ATTACHMENT_DURATION_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    String(parsed) !== raw ||
    parsed < 0 ||
    parsed > MAX_INBOUND_ATTACHMENT_DURATION_MS
  ) {
    throw new Error(
      `LARK_LIVE_DURATION_MS must be an integer between 0 and ${MAX_INBOUND_ATTACHMENT_DURATION_MS}`,
    );
  }
  return parsed;
}

function parseLarkLiveInboundAttachmentKind(raw: string | undefined): InboundAttachmentKind {
  const kind = raw ?? "any";
  if (kind === "any" || kind === "file" || kind === "image") {
    return kind;
  }
  throw new Error("LARK_LIVE_INBOUND_ATTACHMENT_KIND must be any, file, or image");
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))),
    );
  }
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

try {
  await main();
} catch (error) {
  printStatus(redactedStatus("blocked"));
  console.error(`[lark-live-smoke] BLOCKED: ${errorMessage(error)}.`);
  process.exitCode = 6;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

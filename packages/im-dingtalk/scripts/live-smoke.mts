#!/usr/bin/env -S pnpm exec tsx

import type { Target } from "@codex-im/channel-core";
import {
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  createDingTalkOpenApiCardClient,
  createDingTalkStreamClient,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const REQUIRED_FOR_LIVE = ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET_ENV"] as const;
const REQUIRED_FOR_CARD_LIVE = ["DINGTALK_CARD_TEMPLATE_ID"] as const;
const DEFAULT_DURATION_MS = 5_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 30_000;

type SmokeStatus =
  | "skip"
  | "blocked"
  | "ready_dry_run"
  | "connected"
  | "card_updated"
  | "card_callback_seen";

interface RedactedStatus {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly clientId: "present" | "missing";
  readonly clientSecretEnv: string | "missing";
  readonly clientSecret: "present" | "missing";
  readonly durationMs?: number;
  readonly robotEvents?: number;
  readonly cardEvents?: number;
  readonly robotCode?: "present" | "missing" | "derived_from_client_id";
  readonly cardTemplateId?: "present" | "missing";
  readonly targetChatId?: "present" | "missing";
  readonly targetSource?: "env" | "captured" | "discovered" | "missing";
  readonly messageId?: "present";
  readonly callbackMessageRef?: "present";
  readonly callbackAction?: "present";
  readonly callbackRaw?: "present";
  readonly callbackRawActionId?: "present";
  readonly callbackRawSpaceType?: "IM_GROUP" | "IM_ROBOT" | "unknown";
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
  if (process.env.DINGTALK_LIVE_CARD === "1") {
    const cardMissing = missingLiveCardRequirements();
    if (cardMissing.length > 0) {
      printStatus({ ...redactedStatus("blocked"), missing: cardMissing });
      console.error(`[dingtalk-live-smoke] BLOCKED: missing ${cardMissing.join(", ")}.`);
      process.exitCode = 2;
      return;
    }
    try {
      const resolvedTarget = await resolveCardTarget(durationMs);
      if (resolvedTarget === undefined) {
        printStatus({ ...redactedStatus("blocked"), durationMs, targetSource: "missing" });
        console.error(
          "[dingtalk-live-smoke] BLOCKED: missing DINGTALK_TARGET_CHAT_ID; set it, set DINGTALK_LIVE_DISCOVER_USER=1, or set DINGTALK_LIVE_CAPTURE_TARGET=1 and send one test message to the bot during the smoke window.",
        );
        process.exitCode = 2;
        return;
      }
      if (process.env.DINGTALK_LIVE_CARD_CALLBACK === "1") {
        await runLiveCardCallbackSmoke({ durationMs, resolvedTarget });
        return;
      }
      const messageClient = createDingTalkOpenApiCardClient({
        clientId: requiredEnv("DINGTALK_CLIENT_ID"),
        clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
        robotCode: process.env.DINGTALK_ROBOT_CODE ?? requiredEnv("DINGTALK_CLIENT_ID"),
        cardTemplateId: requiredEnv("DINGTALK_CARD_TEMPLATE_ID"),
        ...(process.env.DINGTALK_CALLBACK_ROUTE_KEY === undefined
          ? {}
          : { callbackRouteKey: process.env.DINGTALK_CALLBACK_ROUTE_KEY }),
      });
      const result = await messageClient.sendCard({
        target: resolvedTarget.target,
        card: renderDingTalkApprovalCard({
          schemaVersion: "approval-card.v1",
          kind: "command_execution",
          approvalId: "approval-must-not-be-sent",
          summary: "Live DingTalk OpenAPI card smoke",
          target: { riskLevel: "high" },
          actions: [{ kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" }],
          status: "pending",
          createdAt: new Date(0),
        }),
      });
      await messageClient.updateCard({
        messageRef: { target: resolvedTarget.target, messageId: result.messageId },
        card: renderDingTalkApprovalCard({
          schemaVersion: "approval-card.v1",
          kind: "command_execution",
          approvalId: "approval-must-not-be-sent",
          summary: "Live DingTalk OpenAPI card smoke",
          target: { riskLevel: "high" },
          actions: [],
          status: "resolved",
          createdAt: new Date(0),
        }),
      });
      printStatus({
        ...redactedStatus("card_updated"),
        messageId: "present",
        targetSource: resolvedTarget.source,
      });
      console.log(
        "[dingtalk-live-smoke] CARD_UPDATED: redacted live OpenAPI card smoke completed.",
      );
    } catch (error) {
      printStatus({ ...redactedStatus("blocked"), durationMs });
      console.error(`[dingtalk-live-smoke] BLOCKED: ${redactKnownValues(errorMessage(error))}`);
      process.exitCode = 3;
    }
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

async function runLiveCardCallbackSmoke(input: {
  readonly durationMs: number;
  readonly resolvedTarget: { target: Target; source: "env" | "captured" | "discovered" };
}): Promise<void> {
  const counters = { cardEvents: 0 };
  let callbackMessageRef: "present" | undefined;
  let callbackAction: "present" | undefined;
  let callbackRaw: "present" | undefined;
  let callbackRawActionId: "present" | undefined;
  let callbackRawSpaceType: "IM_GROUP" | "IM_ROBOT" | "unknown" | undefined;
  const streamClient = createDingTalkStreamClient({
    clientId: requiredEnv("DINGTALK_CLIENT_ID"),
    clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    debug: false,
  });
  const adapter = new DingTalkChannelAdapter({ streamClient });
  adapter.onAction((action) => {
    counters.cardEvents++;
    callbackMessageRef = action.messageRef === undefined ? undefined : "present";
    callbackAction = action.uiAction === undefined ? undefined : "present";
    const raw = (action as DingTalkInboundAction).raw;
    if (raw !== undefined) {
      callbackRaw = "present";
      callbackRawActionId = raw.actionId.length > 0 ? "present" : undefined;
      callbackRawSpaceType = sanitizedDingTalkSpaceType(raw.spaceType);
    }
  });
  const messageClient = createDingTalkOpenApiCardClient({
    clientId: requiredEnv("DINGTALK_CLIENT_ID"),
    clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    robotCode: process.env.DINGTALK_ROBOT_CODE ?? requiredEnv("DINGTALK_CLIENT_ID"),
    cardTemplateId: requiredEnv("DINGTALK_CARD_TEMPLATE_ID"),
    ...(process.env.DINGTALK_CALLBACK_ROUTE_KEY === undefined
      ? {}
      : { callbackRouteKey: process.env.DINGTALK_CALLBACK_ROUTE_KEY }),
  });

  try {
    await adapter.start();
    const sent = await messageClient.sendCard({
      target: input.resolvedTarget.target,
      card: renderDingTalkApprovalCard({
        schemaVersion: "approval-card.v1",
        kind: "command_execution",
        approvalId: "approval-must-not-be-sent",
        summary: "Live DingTalk card callback smoke",
        target: { riskLevel: "high" },
        actions: [
          { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
          { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
        ],
        status: "pending",
        createdAt: new Date(0),
      }),
    });
    await waitFor(() => counters.cardEvents > 0, input.durationMs);
    if (counters.cardEvents === 0) {
      printStatus({
        ...redactedStatus("blocked"),
        durationMs: input.durationMs,
        messageId: "present",
        targetSource: input.resolvedTarget.source,
        cardEvents: 0,
      });
      console.error(
        "[dingtalk-live-smoke] BLOCKED: card sent but no Stream card callback arrived before timeout.",
      );
      process.exitCode = 3;
      return;
    }
    printStatus({
      ...redactedStatus("card_callback_seen"),
      durationMs: input.durationMs,
      messageId: "present",
      targetSource: input.resolvedTarget.source,
      cardEvents: counters.cardEvents,
      callbackMessageRef,
      callbackAction,
      callbackRaw,
      callbackRawActionId,
      callbackRawSpaceType,
    });
    console.log(
      "[dingtalk-live-smoke] CARD_CALLBACK_SEEN: redacted live card callback smoke completed.",
    );
    await messageClient.updateCard({
      messageRef: { target: input.resolvedTarget.target, messageId: sent.messageId },
      card: renderDingTalkApprovalCard({
        schemaVersion: "approval-card.v1",
        kind: "command_execution",
        approvalId: "approval-must-not-be-sent",
        summary: "Live DingTalk card callback smoke",
        target: { riskLevel: "high" },
        actions: [],
        status: "resolved",
        createdAt: new Date(0),
      }),
    });
  } catch (error) {
    printStatus({ ...redactedStatus("blocked"), durationMs: input.durationMs });
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
    robotCode:
      process.env.DINGTALK_ROBOT_CODE === undefined
        ? "derived_from_client_id"
        : present("DINGTALK_ROBOT_CODE"),
    cardTemplateId: present("DINGTALK_CARD_TEMPLATE_ID"),
    targetChatId: present("DINGTALK_TARGET_CHAT_ID"),
  };
}

function printStatus(status: RedactedStatus): void {
  console.log(JSON.stringify(status, undefined, 2));
}

function missingLiveCardRequirements(): string[] {
  return REQUIRED_FOR_CARD_LIVE.filter((name) => process.env[name] === undefined);
}

async function resolveCardTarget(
  durationMs: number,
): Promise<{ target: Target; source: "env" | "captured" | "discovered" } | undefined> {
  const targetChatId = process.env.DINGTALK_TARGET_CHAT_ID;
  if (targetChatId !== undefined && targetChatId.length > 0) {
    return { target: { platform: "dingtalk", chatId: targetChatId }, source: "env" };
  }
  if (process.env.DINGTALK_LIVE_DISCOVER_USER === "1") {
    const userId = await discoverDingTalkUserId();
    return userId === undefined
      ? undefined
      : { target: { platform: "dingtalk", chatId: userId }, source: "discovered" };
  }
  if (process.env.DINGTALK_LIVE_CAPTURE_TARGET !== "1") {
    return undefined;
  }

  let captured: Target | undefined;
  const streamClient = createDingTalkStreamClient({
    clientId: requiredEnv("DINGTALK_CLIENT_ID"),
    clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    debug: false,
  });
  const adapter = new DingTalkChannelAdapter({ streamClient });
  const unsubscribe = adapter.onMessage((message) => {
    captured = message.target;
  });
  try {
    await adapter.start();
    await waitForTarget(() => captured, durationMs);
  } finally {
    unsubscribe();
    await adapter.stop();
  }
  return captured === undefined ? undefined : { target: captured, source: "captured" };
}

async function discoverDingTalkUserId(): Promise<string | undefined> {
  const appKey = requiredEnv("DINGTALK_CLIENT_ID");
  const appSecret = requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV"));
  const tokenResponse = await fetch(
    `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(
      appKey,
    )}&appsecret=${encodeURIComponent(appSecret)}`,
  );
  const tokenBody = await readJsonRecord(tokenResponse);
  const token = stringField(tokenBody, "access_token");
  if (token === undefined) {
    throw new Error(
      `DingTalk user discovery failed: missing access token${formatDingTalkError(tokenBody)}`,
    );
  }

  const departmentIds = await discoverDepartmentIds(token);
  for (const deptId of departmentIds) {
    const userId = await firstUserIdInDepartment(token, deptId);
    if (userId !== undefined) {
      return userId;
    }
  }
  return undefined;
}

async function discoverDepartmentIds(token: string): Promise<number[]> {
  const body = await dingtalkTopApi(token, "/topapi/v2/department/listsub", { dept_id: 1 });
  const result = body.result;
  const departments = Array.isArray(result) ? result : [];
  const childIds = departments.flatMap((department) => {
    const candidate = isRecord(department) ? department.dept_id : undefined;
    return typeof candidate === "number" && Number.isSafeInteger(candidate) ? [candidate] : [];
  });
  return [1, ...childIds.slice(0, 10)];
}

async function firstUserIdInDepartment(token: string, deptId: number): Promise<string | undefined> {
  const body = await dingtalkTopApi(token, "/topapi/v2/user/list", {
    dept_id: deptId,
    cursor: 0,
    size: 10,
  });
  const result = isRecord(body.result) ? body.result : {};
  const users = Array.isArray(result.list) ? result.list : [];
  for (const user of users) {
    const userId = isRecord(user) ? stringField(user, "userid") : undefined;
    if (userId !== undefined) {
      return userId;
    }
  }
  return undefined;
}

async function dingtalkTopApi(
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://oapi.dingtalk.com${path}?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const parsed = await readJsonRecord(response);
  const errorCode = parsed.errcode;
  if (errorCode !== undefined && errorCode !== 0) {
    throw new Error(`DingTalk user discovery failed${formatDingTalkError(parsed)}`);
  }
  return parsed;
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function sanitizedDingTalkSpaceType(value: string): "IM_GROUP" | "IM_ROBOT" | "unknown" {
  return value === "IM_GROUP" || value === "IM_ROBOT" ? value : "unknown";
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
    process.env.DINGTALK_ROBOT_CODE,
    process.env.DINGTALK_CARD_TEMPLATE_ID,
    process.env.DINGTALK_TARGET_CHAT_ID,
    process.env.DINGTALK_CALLBACK_ROUTE_KEY,
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

function formatDingTalkError(record: Record<string, unknown>): string {
  const code = record.errcode ?? record.code;
  return typeof code === "number" || typeof code === "string"
    ? ` code ${safeDiagnosticCode(code)}`
    : "";
}

function safeDiagnosticCode(code: number | string): string {
  const rendered = String(code);
  return /^[A-Za-z0-9._:-]{1,120}$/.test(rendered) ? rendered : "<redacted-code>";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTarget(read: () => Target | undefined, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (read() === undefined && Date.now() < deadline) {
    await sleep(100);
  }
}

async function waitFor(read: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!read() && Date.now() < deadline) {
    await sleep(100);
  }
}

await main();

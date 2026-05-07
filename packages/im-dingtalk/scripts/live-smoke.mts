#!/usr/bin/env -S pnpm exec tsx

import type { Target } from "@codex-im/channel-core";
import {
  DINGTALK_TOPIC_CARD,
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  createDingTalkOpenApiCardClient,
  createDingTalkSessionReplyTextClient,
  createDingTalkStreamClient,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const REQUIRED_FOR_LIVE = ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET_ENV"] as const;
const REQUIRED_FOR_CARD_LIVE = ["DINGTALK_CARD_TEMPLATE_ID"] as const;
const DEFAULT_DURATION_MS = 5_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 120_000;
const CALLBACK_STREAM_READY_DELAY_MS = 3_000;

type SmokeStatus =
  | "skip"
  | "blocked"
  | "ready_dry_run"
  | "connected"
  | "card_updated"
  | "card_callback_seen"
  | "file_sent";

interface RedactedStatus {
  readonly status: SmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly clientId: "present" | "missing";
  readonly clientSecretEnv: string | "missing";
  readonly clientSecret: "present" | "missing";
  readonly durationMs?: number;
  readonly robotEvents?: number;
  readonly cardEvents?: number;
  readonly streamEvents?: number;
  readonly rawCardCallbacks?: number;
  readonly normalizedCardActions?: number;
  readonly rawCardCallbackMessageId?: "present";
  readonly rawCardCallbackShape?: SanitizedCardCallbackShape;
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
  readonly fileKind?: "file" | "image";
  readonly missing?: readonly string[];
}

interface SanitizedCardCallbackShape {
  readonly dataKeys: readonly string[];
  readonly contentKind: "json_string" | "object" | "missing" | "other";
  readonly contentKeys: readonly string[];
  readonly cardPrivateDataKeys: readonly string[];
  readonly paramsKeys: readonly string[];
  readonly actionIdsCount: number;
  readonly actionHints: readonly string[];
  readonly payloadLocations: readonly string[];
  readonly hasOutTrackId: boolean;
  readonly hasSpaceId: boolean;
  readonly spaceType: "IM_GROUP" | "IM_ROBOT" | "unknown" | "missing";
  readonly hasUserId: boolean;
  readonly hasSenderStaffId: boolean;
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
  if (process.env.DINGTALK_LIVE_FILE === "1") {
    await runLiveFileSmoke({ durationMs });
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

async function runLiveFileSmoke(input: { readonly durationMs: number }): Promise<void> {
  const counters = { robotEvents: 0 };
  let capturedTarget: Target | undefined;
  const streamClient = createDingTalkStreamClient({
    clientId: requiredEnv("DINGTALK_CLIENT_ID"),
    clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    debug: false,
  });
  const adapter = new DingTalkChannelAdapter({
    streamClient,
    textClient: createDingTalkSessionReplyTextClient({
      clientId: requiredEnv("DINGTALK_CLIENT_ID"),
      clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
    }),
  });
  const unsubscribe = adapter.onMessage((message) => {
    counters.robotEvents++;
    capturedTarget ??= message.target;
  });

  try {
    const file = liveFilePayload();
    await adapter.start();
    console.log(
      "[dingtalk-live-smoke] FILE_WAITING: send one fresh DingTalk message to the bot to seed a session reply URL.",
    );
    await waitForTarget(() => capturedTarget, input.durationMs);
    if (capturedTarget === undefined) {
      printStatus({
        ...redactedStatus("blocked"),
        durationMs: input.durationMs,
        robotEvents: counters.robotEvents,
        targetSource: "missing",
        fileKind: file.kind,
      });
      console.error(
        "[dingtalk-live-smoke] BLOCKED: no fresh DingTalk inbound robot message arrived before timeout; cannot seed session reply URL for file send.",
      );
      process.exitCode = 3;
      return;
    }
    await adapter.sendFile(capturedTarget, file.outbound);
    printStatus({
      ...redactedStatus("file_sent"),
      durationMs: input.durationMs,
      robotEvents: counters.robotEvents,
      targetSource: "captured",
      messageId: "present",
      fileKind: file.kind,
    });
    console.log("[dingtalk-live-smoke] FILE_SENT: redacted live file smoke completed.");
  } catch (error) {
    printStatus({ ...redactedStatus("blocked"), durationMs: input.durationMs });
    console.error(`[dingtalk-live-smoke] BLOCKED: ${redactKnownValues(errorMessage(error))}`);
    process.exitCode = 3;
  } finally {
    unsubscribe();
    await adapter.stop();
  }
}

async function runLiveCardCallbackSmoke(input: {
  readonly durationMs: number;
  readonly resolvedTarget: { target: Target; source: "env" | "captured" | "discovered" };
}): Promise<void> {
  const counters = { rawCardCallbacks: 0, normalizedCardActions: 0, streamEvents: 0 };
  let callbackMessageRef: "present" | undefined;
  let callbackAction: "present" | undefined;
  let callbackRaw: "present" | undefined;
  let callbackRawActionId: "present" | undefined;
  let callbackRawSpaceType: "IM_GROUP" | "IM_ROBOT" | "unknown" | undefined;
  let rawCardCallbackMessageId: "present" | undefined;
  let rawCardCallbackShape: SanitizedCardCallbackShape | undefined;
  const streamClient = observeLiveCardCallbacks(
    createDingTalkStreamClient({
      clientId: requiredEnv("DINGTALK_CLIENT_ID"),
      clientSecret: requiredEnv(requiredEnv("DINGTALK_CLIENT_SECRET_ENV")),
      debug: false,
    }),
    {
      onRawCardCallback(event) {
        counters.rawCardCallbacks++;
        rawCardCallbackMessageId =
          event.headers?.messageId === undefined || event.headers.messageId.length === 0
            ? undefined
            : "present";
        rawCardCallbackShape = summarizeCardCallbackShape(event);
      },
      onStreamEvent() {
        counters.streamEvents++;
      },
    },
  );
  const adapter = new DingTalkChannelAdapter({ streamClient });
  streamClient.registerAllEventListener?.(() => {
    // The live harness observes generic Stream EVENT frames only to classify callback failures.
  });
  adapter.onAction((action) => {
    counters.normalizedCardActions++;
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
    await sleep(CALLBACK_STREAM_READY_DELAY_MS);
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
    console.log(
      "[dingtalk-live-smoke] CARD_SENT: waiting for a real DingTalk client button click.",
    );
    await waitFor(
      () => counters.rawCardCallbacks > 0 || counters.normalizedCardActions > 0,
      input.durationMs,
    );
    if (counters.normalizedCardActions === 0) {
      printStatus({
        ...redactedStatus("blocked"),
        durationMs: input.durationMs,
        messageId: "present",
        targetSource: input.resolvedTarget.source,
        cardEvents: counters.normalizedCardActions,
        rawCardCallbacks: counters.rawCardCallbacks,
        normalizedCardActions: counters.normalizedCardActions,
        streamEvents: counters.streamEvents,
        rawCardCallbackMessageId,
        rawCardCallbackShape,
      });
      console.error(
        counters.rawCardCallbacks === 0
          ? "[dingtalk-live-smoke] BLOCKED: card sent but no Stream card callback arrived before timeout."
          : "[dingtalk-live-smoke] BLOCKED: raw Stream card callback arrived but did not normalize into an action.",
      );
      process.exitCode = 3;
      return;
    }
    printStatus({
      ...redactedStatus("card_callback_seen"),
      durationMs: input.durationMs,
      messageId: "present",
      targetSource: input.resolvedTarget.source,
      cardEvents: counters.normalizedCardActions,
      rawCardCallbacks: counters.rawCardCallbacks,
      normalizedCardActions: counters.normalizedCardActions,
      streamEvents: counters.streamEvents,
      rawCardCallbackMessageId,
      rawCardCallbackShape,
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

function summarizeCardCallbackShape(
  event: Parameters<DingTalkStreamEventHandler>[0],
): SanitizedCardCallbackShape {
  const data = parseJsonObject(event.data);
  const contentRaw = data === undefined ? undefined : data.content;
  const content =
    typeof contentRaw === "string"
      ? parseJsonObject(contentRaw)
      : isRecord(contentRaw)
        ? contentRaw
        : undefined;
  const contentKind =
    typeof contentRaw === "string"
      ? content === undefined
        ? "other"
        : "json_string"
      : contentRaw === undefined
        ? "missing"
        : isRecord(contentRaw)
          ? "object"
          : "other";
  const cardPrivateData = isRecord(content?.cardPrivateData) ? content.cardPrivateData : undefined;
  const params = isRecord(cardPrivateData?.params) ? cardPrivateData.params : undefined;
  const actionIds = Array.isArray(cardPrivateData?.actionIds) ? cardPrivateData.actionIds : [];
  return {
    dataKeys: sortedKeys(data),
    contentKind,
    contentKeys: sortedKeys(content),
    cardPrivateDataKeys: sortedKeys(cardPrivateData),
    paramsKeys: sortedKeys(params),
    actionIdsCount: actionIds.length,
    actionHints: [
      ...actionIds.flatMap((value) => safeActionHint(value)),
      ...safeActionHint(params?.action),
    ],
    payloadLocations: payloadLocations(data, content, params),
    hasOutTrackId: typeof data?.outTrackId === "string" && data.outTrackId.length > 0,
    hasSpaceId: typeof data?.spaceId === "string" && data.spaceId.length > 0,
    spaceType:
      typeof data?.spaceType === "string" ? sanitizedDingTalkSpaceType(data.spaceType) : "missing",
    hasUserId: typeof data?.userId === "string" && data.userId.length > 0,
    hasSenderStaffId: typeof data?.senderStaffId === "string" && data.senderStaffId.length > 0,
  };
}

function sortedKeys(record: Record<string, unknown> | undefined): string[] {
  return record === undefined ? [] : Object.keys(record).sort();
}

function payloadLocations(
  data: Record<string, unknown> | undefined,
  content: Record<string, unknown> | undefined,
  params: Record<string, unknown> | undefined,
): string[] {
  const locations: string[] = [];
  for (const [prefix, record] of [
    ["data", data],
    ["content", content],
    ["params", params],
  ] as const) {
    if (record === undefined) {
      continue;
    }
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && /^v1:[A-Z2-7]{16}$/.test(value)) {
        locations.push(`${prefix}.${key}`);
      }
    }
  }
  return locations.sort();
}

function safeActionHint(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fff]/g, "");
  if (
    [
      "1",
      "2",
      "agree",
      "accept",
      "allow",
      "approve",
      "confirm",
      "ok",
      "yes",
      "reject",
      "refuse",
      "decline",
      "deny",
      "disagree",
      "同意",
      "通过",
      "拒绝",
      "驳回",
    ].includes(normalized)
  ) {
    return [normalized];
  }
  return ["present"];
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function observeLiveCardCallbacks(
  streamClient: DingTalkStreamClientLike,
  observers: {
    readonly onRawCardCallback: (event: Parameters<DingTalkStreamEventHandler>[0]) => void;
    readonly onStreamEvent: (event: Parameters<DingTalkStreamEventHandler>[0]) => void;
  },
): DingTalkStreamClientLike {
  return {
    registerCallbackListener(topic, handler) {
      return streamClient.registerCallbackListener(topic, async (event) => {
        if (topic === DINGTALK_TOPIC_CARD) {
          observers.onRawCardCallback(event);
        }
        await handler(event);
      });
    },
    registerAllEventListener(handler) {
      return streamClient.registerAllEventListener?.((event) => {
        observers.onStreamEvent(event);
        return handler(event);
      });
    },
    connect() {
      return streamClient.connect();
    },
    disconnect() {
      return streamClient.disconnect();
    },
    ackCallback(messageId) {
      return streamClient.ackCallback?.(messageId);
    },
  };
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

function liveFilePayload(): {
  readonly kind: "file" | "image";
  readonly outbound: {
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  };
} {
  const kind = process.env.DINGTALK_LIVE_FILE_KIND ?? "file";
  if (kind === "image") {
    return {
      kind,
      outbound: {
        filename: "codex-im-live-smoke.png",
        bytes: Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
          0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
          0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60,
          0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
        contentType: "image/png",
      },
    };
  }
  if (kind === "file") {
    return {
      kind,
      outbound: {
        filename: "codex-im-live-smoke.txt",
        bytes: new TextEncoder().encode("codex-im dingtalk live file smoke\n"),
        contentType: "text/plain",
      },
    };
  }
  throw new Error("DINGTALK_LIVE_FILE_KIND must be file or image");
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

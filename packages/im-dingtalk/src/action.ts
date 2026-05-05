import type { InboundAction, Target } from "@codex-im/channel-core";
import {
  extractDingTalkCardCallbackWirePayload,
  hasUnsafeDingTalkCardCallbackCompanionPayload,
} from "./callback-codec.js";
import { DINGTALK_TOPIC_CARD, type DingTalkStreamEventLike } from "./client.js";

const DINGTALK_CALLBACK_HANDLE_PREFIX = "dingtalk-card-action:";
const REDACTED_DINGTALK_ID = "[redacted]";

export interface DingTalkSanitizedCardActionRaw {
  readonly topic: string;
  readonly streamMessageId: string;
  readonly outTrackId: string;
  readonly spaceId: string;
  readonly spaceType: string;
  readonly actionId: string;
}

export type DingTalkInboundAction = InboundAction & {
  readonly idempotencyKey: string;
  readonly raw: DingTalkSanitizedCardActionRaw;
};

export interface DingTalkDecodedCallbackHandle {
  readonly streamMessageId: string;
  readonly outTrackId: string;
  readonly receivedAtMs: number;
}

export function normalizeDingTalkRawCardAction(
  input: unknown,
  nowMs: number,
): DingTalkInboundAction | undefined {
  const event = asStreamEvent(input);
  if (event === undefined || event.headers?.topic !== DINGTALK_TOPIC_CARD) {
    return undefined;
  }
  const streamMessageId = event.headers.messageId;
  const request = parseCardRequest(event.data);
  const content = parseCardContent(request?.content);
  if (hasUnsafeDingTalkCardCallbackCompanionPayload(event)) {
    return undefined;
  }
  const actionId = singleActionId(content);
  const actionParam = actionParamValue(content);
  const rawCallbackData =
    extractDingTalkCardCallbackWirePayload(event) ??
    templateActionWirePayload(actionParam ?? actionId);
  const outTrackId = stringField(request?.outTrackId);
  const spaceId = stringField(request?.spaceId);
  const spaceType = stringField(request?.spaceType);
  const senderUserId = stringField(request?.userId);
  const actionKey = actionId ?? actionParam;

  if (
    streamMessageId === undefined ||
    rawCallbackData === undefined ||
    outTrackId === undefined ||
    isSynthesizedRef(outTrackId) ||
    spaceId === undefined ||
    spaceType === undefined ||
    senderUserId === undefined ||
    actionKey === undefined
  ) {
    return undefined;
  }

  const chatId = chatIdFromSpace(spaceId, spaceType);
  if (chatId === undefined) {
    return undefined;
  }

  const uiAction = templateUiAction(actionParam ?? actionId);
  const target: Target = { platform: "dingtalk", chatId };
  const receivedAt = new Date(nowMs);
  return {
    approvalId: "<opaque>",
    uiAction: uiAction ?? { kind: "decline" },
    target,
    sender: { userId: senderUserId },
    messageRef: { target, messageId: outTrackId },
    callbackNonce: callbackNonceForRawCallbackData(rawCallbackData),
    rawCallbackData,
    receivedAt,
    callbackHandle: encodeDingTalkCallbackHandle(streamMessageId, outTrackId, receivedAt),
    idempotencyKey: dingtalkCardActionIdempotencyKey(streamMessageId, outTrackId, actionKey),
    raw: {
      topic: DINGTALK_TOPIC_CARD,
      streamMessageId: REDACTED_DINGTALK_ID,
      outTrackId: REDACTED_DINGTALK_ID,
      spaceId: REDACTED_DINGTALK_ID,
      spaceType,
      actionId: actionKey,
    },
  };
}

function callbackNonceForRawCallbackData(rawCallbackData: string): string {
  return rawCallbackData.startsWith("v1:") ? rawCallbackData.slice("v1:".length) : rawCallbackData;
}

function templateActionWirePayload(actionId: string | undefined): string | undefined {
  const uiAction = templateUiAction(actionId);
  if (uiAction === undefined) {
    return undefined;
  }
  return `dingtalk-template-action:${uiAction.kind}`;
}

function templateUiAction(
  actionId: string | undefined,
): { kind: "allow_once" } | { kind: "decline" } | undefined {
  if (actionId === undefined) {
    return undefined;
  }
  const normalized = actionId.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fff]/g, "");
  if (
    [
      "agree",
      "accept",
      "allow",
      "approve",
      "confirm",
      "ok",
      "yes",
      "btnagree",
      "btnaccept",
      "同意",
      "通过",
    ].includes(normalized)
  ) {
    return { kind: "allow_once" };
  }
  if (
    [
      "reject",
      "refuse",
      "decline",
      "deny",
      "disagree",
      "notagree",
      "btnreject",
      "btnrefuse",
      "拒绝",
      "驳回",
    ].includes(normalized)
  ) {
    return { kind: "decline" };
  }
  return undefined;
}

export function encodeDingTalkCallbackHandle(
  streamMessageId: string,
  outTrackId: string,
  receivedAt: Date,
): string {
  return `${DINGTALK_CALLBACK_HANDLE_PREFIX}${receivedAt.getTime()}:${encodeURIComponent(
    streamMessageId,
  )}:${encodeURIComponent(outTrackId)}`;
}

export function decodeDingTalkCallbackHandle(
  handle: string,
): DingTalkDecodedCallbackHandle | undefined {
  if (!handle.startsWith(DINGTALK_CALLBACK_HANDLE_PREFIX)) {
    return undefined;
  }
  const body = handle.slice(DINGTALK_CALLBACK_HANDLE_PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    return undefined;
  }
  const [receivedAtText, encodedStreamMessageId, encodedOutTrackId] = parts;
  const receivedAtMs = Number.parseInt(receivedAtText ?? "", 10);
  if (!Number.isSafeInteger(receivedAtMs) || String(receivedAtMs) !== receivedAtText) {
    return undefined;
  }
  try {
    const streamMessageId = decodeURIComponent(encodedStreamMessageId ?? "");
    const outTrackId = decodeURIComponent(encodedOutTrackId ?? "");
    return streamMessageId.length > 0 && outTrackId.length > 0
      ? { streamMessageId, outTrackId, receivedAtMs }
      : undefined;
  } catch {
    return undefined;
  }
}

export function dingtalkCardActionIdempotencyKey(
  streamMessageId: string,
  outTrackId: string,
  actionId: string,
): string {
  return `card:${streamMessageId}:${outTrackId}:${actionId}`;
}

function asStreamEvent(input: unknown): DingTalkStreamEventLike | undefined {
  const event = asRecord(input);
  if (event === undefined) {
    return undefined;
  }
  const headers = asRecord(event.headers);
  return {
    ...(headers === undefined
      ? {}
      : {
          headers: {
            ...(typeof headers.messageId === "string" ? { messageId: headers.messageId } : {}),
            ...(typeof headers.topic === "string" ? { topic: headers.topic } : {}),
          },
        }),
    ...(typeof event.data === "string" ? { data: event.data } : {}),
  };
}

function parseCardRequest(data: string | undefined): Record<string, unknown> | undefined {
  return parseJsonRecord(data);
}

function parseCardContent(content: unknown): Record<string, unknown> | undefined {
  return typeof content === "string" ? parseJsonRecord(content) : undefined;
}

function singleActionId(content: Record<string, unknown> | undefined): string | undefined {
  const cardPrivateData = asRecord(content?.cardPrivateData);
  const actionIds = cardPrivateData?.actionIds;
  if (!Array.isArray(actionIds) || actionIds.length !== 1) {
    return undefined;
  }
  const actionId = actionIds[0];
  return typeof actionId === "string" && actionId.length > 0 ? actionId : undefined;
}

function actionParamValue(content: Record<string, unknown> | undefined): string | undefined {
  const cardPrivateData = asRecord(content?.cardPrivateData);
  const params = asRecord(cardPrivateData?.params);
  return stringField(params?.action);
}

function chatIdFromSpace(spaceId: string, spaceType: string): string | undefined {
  const prefix =
    spaceType === "IM_GROUP"
      ? "dtv1.card//IM_GROUP."
      : spaceType === "IM_ROBOT"
        ? "dtv1.card//IM_ROBOT."
        : undefined;
  if (prefix === undefined || !spaceId.startsWith(prefix)) {
    return undefined;
  }
  const chatId = spaceId.slice(prefix.length);
  return chatId.length > 0 ? chatId : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSynthesizedRef(value: string): boolean {
  return value === "<unknown>" || value.startsWith("synthetic:");
}

function parseJsonRecord(data: string | undefined): Record<string, unknown> | undefined {
  if (data === undefined || data.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  return asRecord(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { DINGTALK_TOPIC_CARD, type DingTalkStreamEventLike } from "./client.js";

const DINGTALK_ACTION_WIRE_RE = /^v1:[A-Z2-7]{16}$/;

export function isDingTalkActionWirePayload(value: string): boolean {
  return DINGTALK_ACTION_WIRE_RE.test(value);
}

export function extractDingTalkActionWirePayload(value: unknown): string | undefined {
  return typeof value === "string" && isDingTalkActionWirePayload(value) ? value : undefined;
}

export function extractDingTalkCardCallbackWirePayload(
  event: DingTalkStreamEventLike,
): string | undefined {
  if (event.headers?.topic !== DINGTALK_TOPIC_CARD) {
    return undefined;
  }
  const data = parseCallbackData(event.data);
  if (data === undefined || hasUnsafeDingTalkCardCallbackCompanionPayload(event)) {
    return undefined;
  }
  return singlePayload(
    extractDingTalkActionWirePayload(data.value),
    extractDingTalkActionWirePayload(data.wirePayload),
    extractDingTalkActionWirePayload(data.token),
    extractContentWirePayload(data.content),
  );
}

export function hasUnsafeDingTalkCardCallbackCompanionPayload(
  event: DingTalkStreamEventLike,
): boolean {
  if (event.headers?.topic !== DINGTALK_TOPIC_CARD) {
    return false;
  }
  const data = parseCallbackData(event.data);
  if (data === undefined) {
    return false;
  }
  return (
    hasUnsafeOpaquePayloadCompanion(data) ||
    hasUnsafeOpaquePayloadCompanion(extractContentParams(data.content))
  );
}

export function redactDingTalkActionPayloadForLog(value: unknown): string {
  return extractDingTalkActionWirePayload(value) === undefined
    ? "[invalid-dingtalk-action-payload]"
    : "v1:[redacted]";
}

function parseCallbackData(data: string | undefined): Record<string, unknown> | undefined {
  if (data === undefined || data.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

function extractContentWirePayload(content: unknown): string | undefined {
  const params = extractContentParams(content);
  if (params === undefined) {
    return undefined;
  }
  return singlePayload(
    extractDingTalkActionWirePayload(params.wirePayload),
    extractDingTalkActionWirePayload(params.value),
    extractDingTalkActionWirePayload(params.token),
  );
}

function extractContentParams(content: unknown): Record<string, unknown> | undefined {
  if (typeof content !== "string") {
    return undefined;
  }
  const contentRecord = parseCallbackData(content);
  const cardPrivateData = asRecord(contentRecord?.cardPrivateData);
  return asRecord(cardPrivateData?.params);
}

function singlePayload(...values: readonly (string | undefined)[]): string | undefined {
  const present = values.filter((value): value is string => value !== undefined);
  if (new Set(present).size > 1) {
    return undefined;
  }
  return present[0];
}

function hasUnsafeOpaquePayloadCompanion(data: Record<string, unknown> | undefined): boolean {
  if (data === undefined || !hasOpaquePayloadField(data)) {
    return false;
  }
  return (
    "approvalId" in data ||
    "nonce" in data ||
    "kind" in data ||
    "rawCallbackData" in data ||
    "action" in data
  );
}

function hasOpaquePayloadField(data: Record<string, unknown>): boolean {
  return "value" in data || "wirePayload" in data || "token" in data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (data === undefined || containsUnsafeCompanionPayload(data)) {
    return undefined;
  }
  return singlePayload(
    extractDingTalkActionWirePayload(data.value),
    extractContentWirePayload(data.content),
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
  if (typeof content !== "string") {
    return undefined;
  }
  const contentRecord = parseCallbackData(content);
  const cardPrivateData = asRecord(contentRecord?.cardPrivateData);
  const params = asRecord(cardPrivateData?.params);
  if (params === undefined || containsUnsafeCompanionPayload(params)) {
    return undefined;
  }
  return extractDingTalkActionWirePayload(params.wirePayload ?? params.value);
}

function singlePayload(left: string | undefined, right: string | undefined): string | undefined {
  if (left !== undefined && right !== undefined && left !== right) {
    return undefined;
  }
  return left ?? right;
}

function containsUnsafeCompanionPayload(data: Record<string, unknown>): boolean {
  return "approvalId" in data || "action" in data || "rawCallbackData" in data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

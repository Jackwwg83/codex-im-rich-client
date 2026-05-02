import type { InboundAction, Target } from "@codex-im/channel-core";
import { extractLarkActionWirePayload } from "./callback-codec.js";

const LARK_CALLBACK_HANDLE_PREFIX = "lark-card-action:";

export interface LarkDecodedCallbackHandle {
  readonly eventId: string;
  readonly receivedAtMs: number;
}

export interface LarkRawCardActionEnvelope {
  readonly header?: {
    readonly event_id?: string;
  };
  readonly event?: LarkRawCardActionEvent;
}

export interface LarkRawCardActionEvent {
  readonly event_id?: string;
  readonly header?: {
    readonly event_id?: string;
  };
  readonly operator?: {
    readonly open_id?: string;
    readonly user_id?: string;
    readonly union_id?: string;
    readonly name?: string;
  };
  readonly action?: {
    readonly value?: unknown;
  };
  readonly context?: {
    readonly open_message_id?: string;
    readonly open_chat_id?: string;
  };
  readonly open_message_id?: string;
  readonly open_chat_id?: string;
}

export type LarkRawCardActionInput = unknown;

export function normalizeLarkRawCardAction(
  input: LarkRawCardActionInput,
  nowMs: number,
): InboundAction | undefined {
  const event = cardActionEvent(input);
  if (event === undefined) {
    return undefined;
  }
  const eventId = envelopeEventId(input) ?? event.header?.event_id ?? event.event_id;
  const rawCallbackData = extractLarkActionWirePayload(event.action?.value);
  const senderId = larkOperatorId(event.operator);
  const chatId = singleRequiredRef(event.context?.open_chat_id, event.open_chat_id);
  const messageId = singleRequiredRef(event.context?.open_message_id, event.open_message_id);

  if (
    eventId === undefined ||
    rawCallbackData === undefined ||
    senderId === undefined ||
    chatId === undefined ||
    messageId === undefined
  ) {
    return undefined;
  }

  const target: Target = { platform: "lark", chatId };
  const receivedAt = new Date(nowMs);
  return {
    approvalId: "<opaque>",
    uiAction: { kind: "decline" },
    target,
    sender: {
      userId: senderId,
      ...(event.operator?.name === undefined ? {} : { displayName: event.operator.name }),
    },
    messageRef: { target, messageId },
    callbackNonce: rawCallbackData.slice("v1:".length),
    rawCallbackData,
    receivedAt,
    callbackHandle: encodeLarkCallbackHandle(eventId, receivedAt),
  };
}

export function encodeLarkCallbackHandle(eventId: string, receivedAt: Date): string {
  return `${LARK_CALLBACK_HANDLE_PREFIX}${receivedAt.getTime()}:${encodeURIComponent(eventId)}`;
}

export function decodeLarkCallbackHandle(handle: string): LarkDecodedCallbackHandle | undefined {
  if (!handle.startsWith(LARK_CALLBACK_HANDLE_PREFIX)) {
    return undefined;
  }
  const body = handle.slice(LARK_CALLBACK_HANDLE_PREFIX.length);
  const separatorIndex = body.indexOf(":");
  if (separatorIndex <= 0) {
    return undefined;
  }
  const receivedAtText = body.slice(0, separatorIndex);
  const encodedEventId = body.slice(separatorIndex + 1);
  const receivedAtMs = Number.parseInt(receivedAtText, 10);
  if (!Number.isSafeInteger(receivedAtMs) || String(receivedAtMs) !== receivedAtText) {
    return undefined;
  }
  try {
    const eventId = decodeURIComponent(encodedEventId);
    return eventId.length > 0 ? { eventId, receivedAtMs } : undefined;
  } catch {
    return undefined;
  }
}

function larkOperatorId(operator: LarkRawCardActionEvent["operator"]): string | undefined {
  return operator?.open_id ?? operator?.user_id ?? operator?.union_id;
}

function singleRequiredRef(primary: string | undefined, fallback: string | undefined) {
  if (primary !== undefined && fallback !== undefined && primary !== fallback) {
    return undefined;
  }
  return primary ?? fallback;
}

function cardActionEvent(input: LarkRawCardActionInput): LarkRawCardActionEvent | undefined {
  const record = asRecord(input);
  if (record === undefined) {
    return undefined;
  }
  const event = asRecord(record.event);
  return event === undefined
    ? (record as unknown as LarkRawCardActionEvent)
    : (event as unknown as LarkRawCardActionEvent);
}

function envelopeEventId(input: LarkRawCardActionInput): string | undefined {
  const record = asRecord(input);
  if (record === undefined || asRecord(record.event) === undefined) {
    return undefined;
  }
  const eventId = asRecord(record.header)?.event_id;
  return typeof eventId === "string" ? eventId : undefined;
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

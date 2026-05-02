import type { InboundMessage, Sender, Target } from "@codex-im/channel-core";
import { DINGTALK_TOPIC_ROBOT, type DingTalkStreamEventLike } from "./client.js";

const REDACTED_DINGTALK_ID = "[redacted]";

export interface DingTalkRawRobotMessage {
  readonly conversationId?: string;
  readonly msgId?: string;
  readonly senderNick?: string;
  readonly senderStaffId?: string;
  readonly senderId?: string;
  readonly createAt?: number | string;
  readonly conversationType?: string;
  readonly msgtype?: string;
  readonly text?: {
    readonly content?: string;
  };
}

export interface DingTalkSanitizedRobotRaw {
  readonly topic: string;
  readonly streamMessageId: string;
  readonly robotMsgId: string;
  readonly conversationId: string;
  readonly conversationType: string;
  readonly msgtype: string;
}

export type DingTalkInboundMessage = InboundMessage & {
  readonly idempotencyKey: string;
  readonly raw: DingTalkSanitizedRobotRaw;
};

export function normalizeDingTalkRawRobotMessage(
  event: DingTalkStreamEventLike,
  nowMs: number,
): DingTalkInboundMessage {
  const topic = event.headers?.topic;
  const streamMessageId = event.headers?.messageId;
  const raw = parseRobotData(event.data);
  const robotMsgId = raw.msgId;
  const conversationId = raw.conversationId;
  const conversationType = raw.conversationType;
  const msgtype = raw.msgtype;
  const senderUserId = raw.senderStaffId ?? raw.senderId;

  if (
    topic !== DINGTALK_TOPIC_ROBOT ||
    streamMessageId === undefined ||
    robotMsgId === undefined ||
    conversationId === undefined ||
    conversationType === undefined ||
    msgtype === undefined ||
    senderUserId === undefined
  ) {
    throw new Error("DingTalkChannelAdapter.onMessage received incomplete robot event");
  }

  const target: Target = {
    platform: "dingtalk",
    chatId: conversationId,
  };
  const sender: Sender = {
    userId: senderUserId,
    ...(raw.senderNick === undefined ? {} : { displayName: raw.senderNick }),
  };

  return {
    target,
    sender,
    text: extractRobotText(raw),
    receivedAt: dingTalkReceivedAt(raw.createAt, nowMs),
    messageRef: { target, messageId: robotMsgId },
    idempotencyKey: dingtalkRobotIdempotencyKey(streamMessageId, robotMsgId),
    raw: {
      topic,
      streamMessageId: REDACTED_DINGTALK_ID,
      robotMsgId: REDACTED_DINGTALK_ID,
      conversationId: REDACTED_DINGTALK_ID,
      conversationType,
      msgtype,
    },
  };
}

export function dingtalkRobotIdempotencyKey(_streamMessageId: string, robotMsgId: string): string {
  return `robot:${robotMsgId}`;
}

function parseRobotData(data: string | undefined): DingTalkRawRobotMessage {
  if (data === undefined) {
    throw new Error("DingTalkChannelAdapter.onMessage missing robot event data");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("DingTalkChannelAdapter.onMessage received invalid robot event data");
  }

  if (!isRecord(parsed)) {
    throw new Error("DingTalkChannelAdapter.onMessage received non-object robot event data");
  }

  return parsed;
}

function extractRobotText(raw: DingTalkRawRobotMessage): string {
  if (raw.msgtype !== "text") {
    return `Unsupported DingTalk message type: ${raw.msgtype ?? "<missing>"}`;
  }
  return raw.text?.content ?? "";
}

function dingTalkReceivedAt(createAt: number | string | undefined, nowMs: number): Date {
  if (createAt === undefined) {
    return new Date(nowMs);
  }
  const ms = typeof createAt === "number" ? createAt : Number(createAt);
  return Number.isFinite(ms) ? new Date(ms) : new Date(nowMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

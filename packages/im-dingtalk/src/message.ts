import type { InboundAttachment, InboundMessage, Sender, Target } from "@codex-im/channel-core";
import { DINGTALK_TOPIC_ROBOT, type DingTalkStreamEventLike } from "./client.js";

const REDACTED_DINGTALK_ID = "[redacted]";

export interface DingTalkRawRobotMessage {
  readonly conversationId?: string;
  readonly msgId?: string;
  readonly senderNick?: string;
  readonly senderStaffId?: string;
  readonly senderId?: string;
  readonly sessionWebhook?: string;
  readonly createAt?: number | string;
  readonly conversationType?: string;
  readonly msgtype?: string;
  readonly downloadCode?: string;
  readonly pictureDownloadCode?: string;
  readonly fileName?: string;
  readonly filename?: string;
  readonly fileSize?: number | string;
  readonly content?: unknown;
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

export interface DingTalkRobotSessionReply {
  readonly target: Target;
  readonly url: string;
}

export interface DingTalkRobotAttachmentDescriptor {
  readonly downloadCode: string;
  readonly filename: string;
  readonly contentType: string;
  readonly kind: "image" | "file";
  readonly sizeBytes?: number;
}

export function normalizeDingTalkRawRobotMessage(
  event: DingTalkStreamEventLike,
  nowMs: number,
  attachments: readonly InboundAttachment[] = [],
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

  const target = targetFromRobotMessage(raw);
  const sender: Sender = {
    userId: senderUserId,
    ...(raw.senderNick === undefined ? {} : { displayName: raw.senderNick }),
  };

  return {
    target,
    sender,
    text: extractRobotText(raw, attachments),
    receivedAt: dingTalkReceivedAt(raw.createAt, nowMs),
    messageRef: { target, messageId: robotMsgId, kind: "inbound" },
    ...(attachments.length === 0 ? {} : { attachments }),
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

export function dingtalkRobotAttachmentDescriptor(
  event: DingTalkStreamEventLike,
): DingTalkRobotAttachmentDescriptor | undefined {
  let raw: DingTalkRawRobotMessage;
  try {
    raw = parseRobotData(event.data);
  } catch {
    return undefined;
  }
  if (
    event.headers?.topic !== DINGTALK_TOPIC_ROBOT ||
    raw.msgId === undefined ||
    raw.msgtype === undefined
  ) {
    return undefined;
  }
  const content = parseRobotContent(raw.content);
  const genericDownloadCode =
    nonEmptyString(raw.downloadCode) ?? stringField(content, "downloadCode");
  const pictureDownloadCode =
    nonEmptyString(raw.pictureDownloadCode) ?? stringField(content, "pictureDownloadCode");
  const hasPictureDownloadCode = pictureDownloadCode !== undefined;
  const hasFileShape =
    nonEmptyString(raw.fileName) !== undefined ||
    nonEmptyString(raw.filename) !== undefined ||
    numericValue(raw.fileSize) !== undefined ||
    stringField(content, "fileName") !== undefined ||
    stringField(content, "filename") !== undefined ||
    numericField(content, "fileSize") !== undefined;
  const kind = dingTalkAttachmentKind(raw.msgtype, {
    hasPictureDownloadCode,
    hasFileShape,
  });
  if (kind === undefined) {
    return undefined;
  }
  const downloadCode =
    kind === "image"
      ? (genericDownloadCode ?? pictureDownloadCode)
      : (genericDownloadCode ?? pictureDownloadCode);
  if (downloadCode === undefined) {
    return undefined;
  }
  const filename =
    nonEmptyString(raw.fileName) ??
    nonEmptyString(raw.filename) ??
    stringField(content, "fileName") ??
    stringField(content, "filename") ??
    defaultDingTalkAttachmentFilename(kind, raw.msgId);
  const sizeBytes =
    numericValue(raw.fileSize) ??
    numericField(content, "fileSize") ??
    numericField(content, "size");
  return {
    kind,
    downloadCode,
    filename,
    contentType: kind === "image" ? "image/jpeg" : "application/octet-stream",
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  };
}

export function extractDingTalkRobotSessionReply(
  event: DingTalkStreamEventLike,
): DingTalkRobotSessionReply | undefined {
  let raw: DingTalkRawRobotMessage;
  try {
    raw = parseRobotData(event.data);
  } catch {
    return undefined;
  }
  if (
    event.headers?.topic !== DINGTALK_TOPIC_ROBOT ||
    raw.conversationId === undefined ||
    raw.sessionWebhook === undefined ||
    raw.sessionWebhook.length === 0
  ) {
    return undefined;
  }
  return {
    target: targetFromRobotMessage(raw),
    url: raw.sessionWebhook,
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

function extractRobotText(
  raw: DingTalkRawRobotMessage,
  attachments: readonly InboundAttachment[],
): string {
  if (attachments.length > 0) {
    return "";
  }
  if (raw.msgtype !== "text") {
    return `Unsupported DingTalk message type: ${raw.msgtype ?? "<missing>"}`;
  }
  return raw.text?.content ?? "";
}

function dingTalkAttachmentKind(
  msgtype: string,
  hints: {
    readonly hasPictureDownloadCode: boolean;
    readonly hasFileShape: boolean;
  } = { hasPictureDownloadCode: false, hasFileShape: false },
): "image" | "file" | undefined {
  if (msgtype === "image") return "image";
  if (msgtype === "file") return "file";
  if (hints.hasPictureDownloadCode) return "image";
  if (hints.hasFileShape) return "file";
  return undefined;
}

function defaultDingTalkAttachmentFilename(kind: "image" | "file", msgId: string): string {
  return kind === "image" ? `dingtalk-image-${msgId}.jpg` : `dingtalk-file-${msgId}`;
}

function parseRobotContent(content: unknown): Record<string, unknown> | undefined {
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isRecord(content) ? content : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return nonEmptyString(value);
}

function numericField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  return numericValue(record?.[key]);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function targetFromRobotMessage(raw: DingTalkRawRobotMessage): Target {
  if (raw.conversationType === "1" && raw.senderStaffId !== undefined) {
    return { platform: "dingtalk", chatId: raw.senderStaffId };
  }
  if (raw.conversationId !== undefined) {
    return { platform: "dingtalk", chatId: raw.conversationId };
  }
  throw new Error("DingTalkChannelAdapter.onMessage missing robot target");
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

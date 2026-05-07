import type { InboundAttachment, InboundMessage, Target } from "@codex-im/channel-core";

export interface LarkRawMessageEvent {
  readonly sender?: {
    readonly sender_id?: {
      readonly open_id?: string;
      readonly user_id?: string;
      readonly union_id?: string;
    };
    readonly sender_type?: string;
    readonly tenant_key?: string;
  };
  readonly message?: {
    readonly message_id?: string;
    readonly root_id?: string;
    readonly parent_id?: string;
    readonly create_time?: string;
    readonly update_time?: string;
    readonly chat_id?: string;
    readonly thread_id?: string;
    readonly chat_type?: "p2p" | "group";
    readonly message_type?: string;
    readonly content?: string;
    readonly mentions?: readonly LarkRawMention[];
  };
}

export interface LarkRawMention {
  readonly key: string;
  readonly id?: {
    readonly open_id?: string;
    readonly user_id?: string;
    readonly union_id?: string;
  };
  readonly name?: string;
  readonly tenant_key?: string;
}

export interface LarkMessageResourceAttachmentDescriptor {
  readonly kind: "image" | "file";
  readonly fileKey: string;
  readonly filename: string;
  readonly contentType: string;
}

export function normalizeLarkRawMessage(
  event: LarkRawMessageEvent,
  nowMs: number,
  attachments: readonly InboundAttachment[] = [],
): InboundMessage {
  const message = event.message;
  const senderId =
    event.sender?.sender_id?.open_id ??
    event.sender?.sender_id?.user_id ??
    event.sender?.sender_id?.union_id;

  if (
    message?.message_id === undefined ||
    message.chat_id === undefined ||
    message.message_type === undefined ||
    senderId === undefined
  ) {
    throw new Error("LarkChannelAdapter.onMessage received incomplete message event");
  }

  const target = larkTarget(message);
  return {
    target,
    sender: { userId: senderId },
    text: extractText(message, attachments),
    receivedAt: larkReceivedAt(message.create_time, nowMs),
    messageRef: { target, messageId: message.message_id, kind: "inbound" },
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

export function larkMessageResourceAttachmentDescriptor(
  event: LarkRawMessageEvent,
): LarkMessageResourceAttachmentDescriptor | undefined {
  const message = event.message;
  if (message?.message_id === undefined || message.message_type === undefined) {
    return undefined;
  }
  const content = parseLarkContent(message.content);
  if (message.message_type === "image") {
    const imageKey = readString(content, "image_key");
    if (imageKey === undefined) {
      return undefined;
    }
    return {
      kind: "image",
      fileKey: imageKey,
      filename: `lark-image-${message.message_id}.jpg`,
      contentType: "image/jpeg",
    };
  }
  if (message.message_type === "file") {
    const fileKey = readString(content, "file_key");
    if (fileKey === undefined) {
      return undefined;
    }
    return {
      kind: "file",
      fileKey,
      filename: readString(content, "file_name") ?? `lark-file-${message.message_id}`,
      contentType: "application/octet-stream",
    };
  }
  return undefined;
}

function larkTarget(message: NonNullable<LarkRawMessageEvent["message"]>): Target {
  const threadKey = message.thread_id ?? message.root_id;
  return {
    platform: "lark",
    chatId: message.chat_id ?? "<unknown>",
    ...(threadKey === undefined ? {} : { threadKey }),
  };
}

function extractText(
  message: NonNullable<LarkRawMessageEvent["message"]>,
  attachments: readonly InboundAttachment[],
): string {
  if (
    attachments.length > 0 &&
    (message.message_type === "image" || message.message_type === "file")
  ) {
    return "";
  }
  if (message.message_type !== "text") {
    return `Unsupported Lark message type: ${message.message_type}`;
  }

  const content = message.content;
  if (content === undefined || content.length === 0) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
}

function parseLarkContent(content: string | undefined): Record<string, unknown> | undefined {
  if (content === undefined || content.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function larkReceivedAt(createTime: string | undefined, nowMs: number): Date {
  if (createTime === undefined) {
    return new Date(nowMs);
  }
  const ms = Number(createTime);
  return Number.isFinite(ms) ? new Date(ms) : new Date(nowMs);
}

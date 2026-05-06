import type { InboundMessage, Target } from "@codex-im/channel-core";

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

export function normalizeLarkRawMessage(event: LarkRawMessageEvent, nowMs: number): InboundMessage {
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
    text: extractText(message),
    receivedAt: larkReceivedAt(message.create_time, nowMs),
    messageRef: { target, messageId: message.message_id, kind: "inbound" },
  };
}

function larkTarget(message: NonNullable<LarkRawMessageEvent["message"]>): Target {
  const threadKey = message.thread_id ?? message.root_id;
  return {
    platform: "lark",
    chatId: message.chat_id ?? "<unknown>",
    ...(threadKey === undefined ? {} : { threadKey }),
  };
}

function extractText(message: NonNullable<LarkRawMessageEvent["message"]>): string {
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

function larkReceivedAt(createTime: string | undefined, nowMs: number): Date {
  if (createTime === undefined) {
    return new Date(nowMs);
  }
  const ms = Number(createTime);
  return Number.isFinite(ms) ? new Date(ms) : new Date(nowMs);
}

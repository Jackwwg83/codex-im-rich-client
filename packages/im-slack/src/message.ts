import type { InboundAttachment, InboundMessage, Target } from "@codex-im/channel-core";

export interface SlackRawMessagePayload {
  readonly team_id?: string;
  readonly team?: { readonly id?: string };
  readonly authorizations?: readonly SlackRawAuthorization[];
  readonly event?: SlackRawMessageEvent;
  readonly ack?: () => void | Promise<void>;
}

export interface SlackRawAuthorization {
  readonly team_id?: string;
}

export interface SlackRawMessageEvent {
  readonly type?: "message" | "app_mention";
  readonly channel?: string;
  readonly channel_type?: string;
  readonly user?: string;
  readonly text?: string;
  readonly ts?: string;
  readonly event_ts?: string;
  readonly thread_ts?: string;
  readonly subtype?: string;
  readonly bot_id?: string;
  readonly files?: readonly SlackRawFile[];
}

export interface SlackRawFile {
  readonly id?: string;
  readonly name?: string;
  readonly title?: string;
  readonly mimetype?: string;
  readonly filetype?: string;
  readonly url_private?: string;
  readonly url_private_download?: string;
  readonly size?: number;
}

export interface SlackFileAttachmentDescriptor {
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly url: string;
  readonly kind: "image" | "file";
}

export function normalizeSlackRawMessage(
  payload: SlackRawMessagePayload,
  nowMs: number,
  attachments: readonly InboundAttachment[] = [],
): InboundMessage | undefined {
  const event = payload.event;
  if (event === undefined) {
    throw new Error("SlackChannelAdapter.onMessage received missing event");
  }
  if (event.bot_id !== undefined || isUnsupportedSlackSubtype(event)) {
    return undefined;
  }
  const teamId = slackTeamId(payload);
  if (
    teamId === undefined ||
    event.channel === undefined ||
    event.user === undefined ||
    event.ts === undefined
  ) {
    throw new Error("SlackChannelAdapter.onMessage received incomplete message event");
  }
  if (event.type !== "message" && event.type !== "app_mention") {
    throw new Error("SlackChannelAdapter.onMessage received unsupported event type");
  }

  const target = slackTarget(teamId, event);
  return {
    target,
    sender: { userId: `${teamId}:${event.user}` },
    text: slackText(event),
    receivedAt: slackReceivedAt(event.event_ts ?? event.ts, nowMs),
    messageRef: {
      target,
      messageId: `${event.channel}:${event.ts}`,
      kind: "inbound",
    },
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

export function slackFileAttachmentDescriptors(
  event: SlackRawMessageEvent | undefined,
): readonly SlackFileAttachmentDescriptor[] {
  const files = event?.files ?? [];
  return files.flatMap((file) => {
    const fileId = nonEmptyString(file.id);
    const url = nonEmptyString(file.url_private_download) ?? nonEmptyString(file.url_private);
    if (fileId === undefined || url === undefined) {
      return [];
    }
    const contentType =
      nonEmptyString(file.mimetype) ??
      contentTypeForSlackFiletype(file.filetype) ??
      "application/octet-stream";
    return [
      {
        fileId,
        filename: nonEmptyString(file.name) ?? nonEmptyString(file.title) ?? `slack-file-${fileId}`,
        contentType,
        url,
        kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
      },
    ];
  });
}

function slackTeamId(payload: SlackRawMessagePayload): string | undefined {
  return payload.team_id ?? payload.team?.id ?? payload.authorizations?.[0]?.team_id;
}

function slackTarget(teamId: string, event: SlackRawMessageEvent): Target {
  const threadKey = event.thread_ts;
  return {
    platform: "slack",
    chatId: `${teamId}:${event.channel ?? "<unknown>"}`,
    ...(threadKey === undefined ? {} : { threadKey }),
  };
}

function slackText(event: SlackRawMessageEvent): string {
  const text = event.text ?? "";
  if (event.type !== "app_mention") {
    return text;
  }
  return text.replace(/^<@[A-Z0-9_]+(?:\|[^>]+)?>\s*/u, "");
}

function isUnsupportedSlackSubtype(event: SlackRawMessageEvent): boolean {
  if (event.subtype === undefined) {
    return false;
  }
  return event.subtype !== "file_share" || (event.files?.length ?? 0) === 0;
}

function slackReceivedAt(ts: string | undefined, nowMs: number): Date {
  if (ts === undefined) {
    return new Date(nowMs);
  }
  const [secondsRaw, fractionRaw = ""] = ts.split(".");
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(seconds)) {
    return new Date(nowMs);
  }
  const fractionMs = Number(`0.${fractionRaw}`);
  const ms = seconds * 1000 + (Number.isFinite(fractionMs) ? Math.floor(fractionMs * 1000) : 0);
  return new Date(ms);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contentTypeForSlackFiletype(filetype: string | undefined): string | undefined {
  const normalized = filetype?.toLowerCase();
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "pdf") {
    return "application/pdf";
  }
  if (normalized === "text" || normalized === "txt") {
    return "text/plain";
  }
  return undefined;
}

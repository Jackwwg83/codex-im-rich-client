import type { InboundMessage, Target } from "@codex-im/channel-core";

export interface SlackRawMessagePayload {
  readonly team_id?: string;
  readonly team?: { readonly id?: string };
  readonly authorizations?: readonly SlackRawAuthorization[];
  readonly event?: SlackRawMessageEvent;
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
}

export function normalizeSlackRawMessage(
  payload: SlackRawMessagePayload,
  nowMs: number,
): InboundMessage | undefined {
  const event = payload.event;
  if (event === undefined) {
    throw new Error("SlackChannelAdapter.onMessage received missing event");
  }
  if (event.bot_id !== undefined || event.subtype !== undefined) {
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
  };
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

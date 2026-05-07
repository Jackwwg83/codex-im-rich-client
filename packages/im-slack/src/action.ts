import type { InboundAction, Target } from "@codex-im/channel-core";
import { extractSlackActionWirePayload } from "./callback-codec.js";

const SLACK_CALLBACK_HANDLE_PREFIX = "slack-block-action:";

export interface SlackDecodedCallbackHandle {
  readonly actionId: string;
  readonly receivedAtMs: number;
}

export interface SlackRawBlockActionPayload {
  readonly team_id?: string;
  readonly team?: { readonly id?: string };
  readonly user?: {
    readonly id?: string;
    readonly username?: string;
    readonly name?: string;
  };
  readonly channel?: { readonly id?: string };
  readonly message?: {
    readonly ts?: string;
    readonly thread_ts?: string;
  };
  readonly actions?: readonly SlackRawBlockAction[];
  readonly trigger_id?: string;
  readonly action_ts?: string;
  readonly ack?: () => void | Promise<void>;
}

export interface SlackRawBlockAction {
  readonly action_id?: string;
  readonly value?: unknown;
}

export async function normalizeSlackRawBlockAction(
  input: unknown,
  nowMs: number,
): Promise<InboundAction | undefined> {
  const payload = asRecord(input) as SlackRawBlockActionPayload | undefined;
  if (payload === undefined) {
    return undefined;
  }
  await payload.ack?.();

  const rawCallbackData = extractSlackActionWirePayload(payload.actions?.[0]?.value);
  const teamId = payload.team_id ?? payload.team?.id;
  const userId = payload.user?.id;
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  const actionId = payload.trigger_id ?? payload.action_ts ?? messageTs;
  if (
    rawCallbackData === undefined ||
    teamId === undefined ||
    userId === undefined ||
    channelId === undefined ||
    messageTs === undefined ||
    actionId === undefined
  ) {
    return undefined;
  }

  const target: Target = {
    platform: "slack",
    chatId: `${teamId}:${channelId}`,
    ...(payload.message?.thread_ts === undefined ? {} : { threadKey: payload.message.thread_ts }),
  };
  const receivedAt = new Date(nowMs);
  return {
    approvalId: "<opaque>",
    uiAction: { kind: "decline" },
    target,
    sender: {
      userId: `${teamId}:${userId}`,
      ...slackDisplayName(payload.user),
    },
    messageRef: {
      target,
      messageId: `${channelId}:${messageTs}`,
      kind: "approval_card",
      textUpdateMode: "edit",
    },
    callbackNonce: rawCallbackData.slice("v1:".length),
    rawCallbackData,
    receivedAt,
    callbackHandle: encodeSlackCallbackHandle(actionId, receivedAt),
  };
}

export function encodeSlackCallbackHandle(actionId: string, receivedAt: Date): string {
  return `${SLACK_CALLBACK_HANDLE_PREFIX}${receivedAt.getTime()}:${encodeURIComponent(actionId)}`;
}

export function decodeSlackCallbackHandle(handle: string): SlackDecodedCallbackHandle | undefined {
  if (!handle.startsWith(SLACK_CALLBACK_HANDLE_PREFIX)) {
    return undefined;
  }
  const body = handle.slice(SLACK_CALLBACK_HANDLE_PREFIX.length);
  const separatorIndex = body.indexOf(":");
  if (separatorIndex <= 0) {
    return undefined;
  }
  const receivedAtText = body.slice(0, separatorIndex);
  const encodedActionId = body.slice(separatorIndex + 1);
  const receivedAtMs = Number.parseInt(receivedAtText, 10);
  if (!Number.isSafeInteger(receivedAtMs) || String(receivedAtMs) !== receivedAtText) {
    return undefined;
  }
  try {
    const actionId = decodeURIComponent(encodedActionId);
    return actionId.length > 0 ? { actionId, receivedAtMs } : undefined;
  } catch {
    return undefined;
  }
}

function slackDisplayName(
  user: SlackRawBlockActionPayload["user"],
): { displayName: string } | Record<string, never> {
  const displayName = user?.username ?? user?.name;
  return displayName === undefined ? {} : { displayName };
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

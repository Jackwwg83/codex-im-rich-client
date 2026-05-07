import type { InboundMessage, Target } from "@codex-im/channel-core";

const SLACK_CODEX_COMMAND = "/codex";
const SLASH_MESSAGE_ID_PREFIX = "slash:";

const SLACK_CODEX_BARE_COMMANDS = new Set<string>([
  "start",
  "help",
  "projects",
  "new",
  "threads",
  "use",
  "switch",
  "alias",
  "fork",
  "status",
  "whoami",
  "stop",
  "model",
  "compact",
  "usage",
  "diagnostics",
  "tools",
  "skills",
  "plugins",
  "apps",
  "mcp",
  "approvals",
  "approve",
  "cu",
  "computer-use",
]);

export interface SlackRawSlashCommandPayload {
  readonly command?: string;
  readonly text?: string;
  readonly team_id?: string;
  readonly team?: { readonly id?: string };
  readonly channel_id?: string;
  readonly user_id?: string;
  readonly user_name?: string;
  readonly trigger_id?: string;
  readonly ack?: () => void | Promise<void>;
}

export async function normalizeSlackRawSlashCommand(
  input: unknown,
  nowMs: number,
): Promise<InboundMessage | undefined> {
  const payload = asRecord(input) as SlackRawSlashCommandPayload | undefined;
  if (payload === undefined) {
    return undefined;
  }
  await payload.ack?.();

  const teamId = payload.team_id ?? payload.team?.id;
  if (
    payload.command !== SLACK_CODEX_COMMAND ||
    teamId === undefined ||
    payload.channel_id === undefined ||
    payload.user_id === undefined ||
    payload.trigger_id === undefined
  ) {
    return undefined;
  }

  const target: Target = {
    platform: "slack",
    chatId: `${teamId}:${payload.channel_id}`,
  };
  return {
    target,
    sender: {
      userId: `${teamId}:${payload.user_id}`,
      ...slackDisplayName(payload.user_name),
    },
    text: slackSlashText(payload.text),
    receivedAt: new Date(nowMs),
    messageRef: {
      target,
      messageId: encodeSlackSlashCommandMessageId(payload.trigger_id),
      kind: "inbound",
      textUpdateMode: "append",
    },
  };
}

export function encodeSlackSlashCommandMessageId(triggerId: string): string {
  return `${SLASH_MESSAGE_ID_PREFIX}${triggerId}`;
}

export function isSlackSlashCommandMessageId(messageId: string): boolean {
  return messageId.startsWith(SLASH_MESSAGE_ID_PREFIX);
}

function slackSlashText(text: string | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length === 0) {
    return "/help";
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  const [firstWord = ""] = trimmed.split(/\s+/u);
  return SLACK_CODEX_BARE_COMMANDS.has(firstWord.toLowerCase()) ? `/${trimmed}` : trimmed;
}

function slackDisplayName(
  name: string | undefined,
): { displayName: string } | Record<string, never> {
  return name === undefined || name.length === 0 ? {} : { displayName: name };
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

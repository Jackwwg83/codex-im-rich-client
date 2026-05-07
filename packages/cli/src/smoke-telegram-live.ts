import { TelegramChannelAdapter, TelegramLiveSmokeBot } from "@codex-im/im-telegram";

export type TelegramLiveSmokeFailureReason =
  | "missing-live-flag"
  | "missing-token"
  | "missing-target"
  | "invalid-inbound-attachment-kind"
  | "invalid-duration"
  | "live-failed";

export type TelegramLiveInboundAttachmentKind = "any" | "file" | "image";

export type TelegramLiveSmokeResult =
  | {
      readonly ok: true;
      readonly durationMs: number;
      readonly started: boolean;
      readonly stopped: boolean;
      readonly fileSent?: boolean;
      readonly inboundAttachmentReceived?: boolean;
      readonly inboundAttachmentKind?: "file" | "image";
    }
  | { readonly ok: false; readonly reason: TelegramLiveSmokeFailureReason };

export interface TelegramLiveRunnerInput {
  readonly botToken: string;
  readonly durationMs: number;
  readonly fileTargetChatId?: string;
  readonly inboundAttachmentKind?: TelegramLiveInboundAttachmentKind;
  readonly sleep: (ms: number) => Promise<void>;
  readonly output: (line: string) => void;
}

export type TelegramLiveRunner = (input: TelegramLiveRunnerInput) => Promise<{
  readonly started: boolean;
  readonly stopped: boolean;
  readonly fileSent?: boolean;
  readonly inboundAttachmentReceived?: boolean;
  readonly inboundAttachmentKind?: "file" | "image";
}>;

export interface RunTelegramLiveSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly runLive?: TelegramLiveRunner;
}

const DEFAULT_DURATION_MS = 5_000;
const MAX_DURATION_MS = 60_000;

export async function runTelegramLiveSmokeCore(
  options: RunTelegramLiveSmokeOptions = {},
): Promise<TelegramLiveSmokeResult> {
  const env = options.env ?? process.env;
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const runLive = options.runLive ?? runTelegramLiveSmokeWithAdapter;

  if (env.TELEGRAM_LIVE !== "1") {
    errorOutput(
      [
        "smoke:telegram-live is operator-gated.",
        "Run with TELEGRAM_LIVE=1 and IM_TELEGRAM_BOT_TOKEN set in the environment.",
      ].join("\n"),
    );
    return { ok: false, reason: "missing-live-flag" };
  }

  const botToken = env.IM_TELEGRAM_BOT_TOKEN;
  if (botToken === undefined || botToken.trim().length === 0) {
    errorOutput("smoke:telegram-live requires IM_TELEGRAM_BOT_TOKEN in the environment.");
    return { ok: false, reason: "missing-token" };
  }

  const fileTargetChatId =
    env.TELEGRAM_LIVE_FILE === "1" ? env.TELEGRAM_LIVE_TARGET_CHAT_ID : undefined;
  if (env.TELEGRAM_LIVE_FILE === "1" && fileTargetChatId === undefined) {
    errorOutput("smoke:telegram-live file mode requires TELEGRAM_LIVE_TARGET_CHAT_ID.");
    return { ok: false, reason: "missing-target" };
  }
  let inboundAttachmentKind: TelegramLiveInboundAttachmentKind | undefined;
  try {
    inboundAttachmentKind =
      env.TELEGRAM_LIVE_INBOUND_ATTACHMENT === "1"
        ? parseTelegramLiveInboundAttachmentKind(env.TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND)
        : undefined;
  } catch (error) {
    errorOutput(redactTelegramSecrets(describeError(error)));
    return { ok: false, reason: "invalid-inbound-attachment-kind" };
  }

  let durationMs: number;
  try {
    durationMs = parseTelegramLiveDurationMs(env.TELEGRAM_LIVE_DURATION_MS);
  } catch (error) {
    errorOutput(redactTelegramSecrets(describeError(error)));
    return { ok: false, reason: "invalid-duration" };
  }

  try {
    const live = await runLive({
      botToken,
      durationMs,
      ...(fileTargetChatId === undefined ? {} : { fileTargetChatId }),
      ...(inboundAttachmentKind === undefined ? {} : { inboundAttachmentKind }),
      sleep,
      output,
    });
    const result = {
      ok: true,
      durationMs,
      started: live.started,
      stopped: live.stopped,
      ...(live.fileSent === true ? { fileSent: true } : {}),
      ...(live.inboundAttachmentReceived === true ? { inboundAttachmentReceived: true } : {}),
      ...(live.inboundAttachmentKind === undefined
        ? {}
        : { inboundAttachmentKind: live.inboundAttachmentKind }),
    } as const;
    output(
      `smoke:telegram-live ok durationMs=${result.durationMs} started=${result.started} stopped=${result.stopped}`,
    );
    return result;
  } catch (error) {
    errorOutput(`smoke:telegram-live failed: ${redactTelegramSecrets(describeError(error))}`);
    return { ok: false, reason: "live-failed" };
  }
}

export function parseTelegramLiveDurationMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_DURATION_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    String(parsed) !== raw ||
    parsed < 0 ||
    parsed > MAX_DURATION_MS
  ) {
    throw new Error(
      `TELEGRAM_LIVE_DURATION_MS must be an integer between 0 and ${MAX_DURATION_MS}`,
    );
  }
  return parsed;
}

export function parseTelegramLiveInboundAttachmentKind(
  raw: string | undefined,
): TelegramLiveInboundAttachmentKind {
  const kind = raw ?? "any";
  if (kind === "any" || kind === "file" || kind === "image") {
    return kind;
  }
  throw new Error("TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND must be any, file, or image");
}

export async function runTelegramLiveSmokeWithAdapter(input: TelegramLiveRunnerInput): Promise<{
  readonly started: boolean;
  readonly stopped: boolean;
  readonly fileSent?: boolean;
  readonly inboundAttachmentReceived?: boolean;
  readonly inboundAttachmentKind?: "file" | "image";
}> {
  if (input.inboundAttachmentKind !== undefined) {
    return runTelegramLiveInboundAttachmentSmokeWithAdapter({
      ...input,
      inboundAttachmentKind: input.inboundAttachmentKind,
    });
  }
  const fileTargetChatId = input.fileTargetChatId;
  if (fileTargetChatId !== undefined) {
    return runTelegramLiveFileSmokeWithAdapter({ ...input, fileTargetChatId });
  }
  const bot = new TelegramLiveSmokeBot({ botToken: input.botToken });
  const adapter = new TelegramChannelAdapter({ bot });
  let started = false;
  let stopped = false;
  try {
    await adapter.start();
    started = true;
    input.output("smoke:telegram-live adapter started; waiting for operator-gated duration");
    await input.sleep(input.durationMs);
  } finally {
    await adapter.stop();
    stopped = true;
  }
  return { started, stopped };
}

async function runTelegramLiveFileSmokeWithAdapter(
  input: TelegramLiveRunnerInput & { readonly fileTargetChatId: string },
): Promise<{ readonly started: boolean; readonly stopped: boolean; readonly fileSent: boolean }> {
  const bot = new TelegramLiveSmokeBot({ botToken: input.botToken });
  const adapter = new TelegramChannelAdapter({ bot });
  let started = false;
  let stopped = false;
  let fileSent = false;
  try {
    await adapter.start();
    started = true;
    await adapter.sendFile(
      { platform: "telegram", chatId: input.fileTargetChatId },
      {
        filename: "codex-im-live-attachment.txt",
        bytes: new TextEncoder().encode(`codex-im telegram attachment ${new Date().toISOString()}`),
        contentType: "text/plain",
      },
    );
    fileSent = true;
    input.output("smoke:telegram-live file send succeeded");
  } finally {
    await adapter.stop();
    stopped = true;
  }
  return { started, stopped, fileSent };
}

async function runTelegramLiveInboundAttachmentSmokeWithAdapter(
  input: TelegramLiveRunnerInput & {
    readonly inboundAttachmentKind: TelegramLiveInboundAttachmentKind;
  },
): Promise<{
  readonly started: boolean;
  readonly stopped: boolean;
  readonly inboundAttachmentReceived: true;
  readonly inboundAttachmentKind: "file" | "image";
}> {
  const bot = new TelegramLiveSmokeBot({ botToken: input.botToken });
  const adapter = new TelegramChannelAdapter({ bot, botToken: input.botToken });
  let started = false;
  let stopped = false;
  let messageEvents = 0;
  let attachmentEvents = 0;
  let received:
    | {
        readonly kind: "file" | "image";
        readonly hasLocalPath: boolean;
        readonly hasSizeBytes: boolean;
        readonly hasFilename: boolean;
      }
    | undefined;
  const unsubscribe = adapter.onMessage((message) => {
    messageEvents++;
    for (const attachment of message.attachments ?? []) {
      if (
        input.inboundAttachmentKind !== "any" &&
        attachment.kind !== input.inboundAttachmentKind
      ) {
        continue;
      }
      attachmentEvents++;
      if (received === undefined) {
        received = {
          kind: attachment.kind,
          hasLocalPath: attachment.localPath.length > 0,
          hasSizeBytes: attachment.sizeBytes !== undefined,
          hasFilename: attachment.filename.length > 0,
        };
      }
    }
  });

  try {
    await adapter.start();
    started = true;
    input.output(
      "smoke:telegram-live INBOUND_ATTACHMENT_WAITING: send one Telegram image/file message to the bot during the smoke window.",
    );
    await waitFor(() => received !== undefined, input.durationMs, input.sleep);
    if (received === undefined) {
      throw new Error(
        `no Telegram inbound image/file attachment arrived before timeout messageEvents=${messageEvents} attachmentEvents=${attachmentEvents}`,
      );
    }
    input.output(
      [
        "smoke:telegram-live INBOUND_ATTACHMENT_RECEIVED",
        `kind=${received.kind}`,
        `localPath=${received.hasLocalPath ? "present" : "missing"}`,
        `sizeBytes=${received.hasSizeBytes ? "present" : "missing"}`,
        `filename=${received.hasFilename ? "present" : "missing"}`,
      ].join(" "),
    );
  } finally {
    unsubscribe();
    await adapter.stop();
    stopped = true;
  }
  if (received === undefined) {
    throw new Error("Telegram inbound attachment state was lost before completion");
  }
  return {
    started,
    stopped,
    inboundAttachmentReceived: true,
    inboundAttachmentKind: received.kind,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
  }
}

export async function run(): Promise<void> {
  const result = await runTelegramLiveSmokeCore({ env: process.env });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function redactTelegramSecrets(value: string): string {
  return value.replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "<redacted:telegram-token>");
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

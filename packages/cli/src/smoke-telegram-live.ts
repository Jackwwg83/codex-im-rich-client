import { TelegramChannelAdapter, TelegramLiveSmokeBot } from "@codex-im/im-telegram";

export type TelegramLiveSmokeFailureReason =
  | "missing-live-flag"
  | "missing-token"
  | "missing-target"
  | "invalid-duration"
  | "live-failed";

export type TelegramLiveSmokeResult =
  | {
      readonly ok: true;
      readonly durationMs: number;
      readonly started: boolean;
      readonly stopped: boolean;
      readonly fileSent?: boolean;
    }
  | { readonly ok: false; readonly reason: TelegramLiveSmokeFailureReason };

export interface TelegramLiveRunnerInput {
  readonly botToken: string;
  readonly durationMs: number;
  readonly fileTargetChatId?: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly output: (line: string) => void;
}

export type TelegramLiveRunner = (
  input: TelegramLiveRunnerInput,
) => Promise<{ readonly started: boolean; readonly stopped: boolean; readonly fileSent?: boolean }>;

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
      sleep,
      output,
    });
    const result = {
      ok: true,
      durationMs,
      started: live.started,
      stopped: live.stopped,
      ...(live.fileSent === true ? { fileSent: true } : {}),
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

export async function runTelegramLiveSmokeWithAdapter(
  input: TelegramLiveRunnerInput,
): Promise<{ readonly started: boolean; readonly stopped: boolean; readonly fileSent?: boolean }> {
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

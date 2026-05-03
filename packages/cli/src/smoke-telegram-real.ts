import { StdioTransport } from "@codex-im/app-server-client";
import pino from "pino";
import { runRuntimeSendCore } from "./runtime-send.js";
import {
  parseTelegramLiveDurationMs,
  runTelegramLiveSmokeWithAdapter,
} from "./smoke-telegram-live.js";

export type TelegramRealSmokeFailureReason =
  | "missing-live-flag"
  | "missing-codex-real-flag"
  | "missing-token"
  | "invalid-duration"
  | "real-failed";

export type TelegramRealSmokeResult =
  | {
      readonly ok: true;
      readonly codexCompleted: boolean;
      readonly telegramDurationMs: number;
      readonly telegramStarted: boolean;
      readonly telegramStopped: boolean;
    }
  | { readonly ok: false; readonly reason: TelegramRealSmokeFailureReason };

export interface TelegramRealRunnerInput {
  readonly botToken: string;
  readonly codexPrompt: string;
  readonly telegramDurationMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly output: (line: string) => void;
}

export type TelegramRealRunner = (input: TelegramRealRunnerInput) => Promise<{
  readonly codexCompleted: boolean;
  readonly telegramStarted: boolean;
  readonly telegramStopped: boolean;
}>;

export interface RunTelegramRealSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly runReal?: TelegramRealRunner;
}

const DEFAULT_CODEX_PROMPT = "Reply exactly: OK";

export async function runTelegramRealSmokeCore(
  options: RunTelegramRealSmokeOptions = {},
): Promise<TelegramRealSmokeResult> {
  const env = options.env ?? process.env;
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const safeOutput = (line: string) => output(redactTelegramSecrets(line));
  const safeError = (line: string) => errorOutput(redactTelegramSecrets(line));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const runReal = options.runReal ?? runTelegramRealSmokeWithLiveServices;

  if (env.TELEGRAM_LIVE !== "1") {
    safeError(
      [
        "smoke:telegram-real is operator-gated for Telegram.",
        "Run with TELEGRAM_LIVE=1 plus CODEX_REAL_SMOKE=1 and IM_TELEGRAM_BOT_TOKEN.",
      ].join("\n"),
    );
    return { ok: false, reason: "missing-live-flag" };
  }

  if (env.CODEX_REAL_SMOKE !== "1") {
    safeError(
      [
        "smoke:telegram-real is operator-gated for real Codex.",
        "Run with CODEX_REAL_SMOKE=1 plus TELEGRAM_LIVE=1 after confirming login and quota.",
      ].join("\n"),
    );
    return { ok: false, reason: "missing-codex-real-flag" };
  }

  const botToken = env.IM_TELEGRAM_BOT_TOKEN;
  if (botToken === undefined || botToken.trim().length === 0) {
    safeError("smoke:telegram-real requires IM_TELEGRAM_BOT_TOKEN in the environment.");
    return { ok: false, reason: "missing-token" };
  }

  let telegramDurationMs: number;
  try {
    telegramDurationMs = parseTelegramLiveDurationMs(env.TELEGRAM_LIVE_DURATION_MS);
  } catch (error) {
    safeError(describeError(error));
    return { ok: false, reason: "invalid-duration" };
  }

  try {
    const real = await runReal({
      botToken,
      codexPrompt: env.CODEX_REAL_SMOKE_PROMPT ?? DEFAULT_CODEX_PROMPT,
      telegramDurationMs,
      sleep,
      output: safeOutput,
    });
    const result = {
      ok: true,
      codexCompleted: real.codexCompleted,
      telegramDurationMs,
      telegramStarted: real.telegramStarted,
      telegramStopped: real.telegramStopped,
    } as const;
    safeOutput(
      `smoke:telegram-real ok telegramStarted=${result.telegramStarted} telegramStopped=${result.telegramStopped} codexCompleted=${result.codexCompleted}`,
    );
    return result;
  } catch (error) {
    safeError(`smoke:telegram-real failed: ${describeError(error)}`);
    return { ok: false, reason: "real-failed" };
  }
}

export async function runTelegramRealSmokeWithLiveServices(
  input: TelegramRealRunnerInput,
): Promise<{
  readonly codexCompleted: boolean;
  readonly telegramStarted: boolean;
  readonly telegramStopped: boolean;
}> {
  const telegram = await runTelegramLiveSmokeWithAdapter({
    botToken: input.botToken,
    durationMs: input.telegramDurationMs,
    sleep: input.sleep,
    output: input.output,
  });

  input.output("smoke:telegram-real starting real Codex harmless turn");
  const log = pino(
    { name: "smoke:telegram-real", level: "info" },
    pino.destination({ fd: 2, sync: true }),
  );
  const transport = new StdioTransport({
    command: "codex",
    args: ["app-server", "--listen", "stdio://"],
    configOverrides: {
      sandbox_mode: "read-only",
      approval_policy: "on-request",
    },
    logger: log,
  });

  await runRuntimeSendCore({
    transport,
    logger: log,
    prompt: input.codexPrompt,
    output: (line) => input.output(`codex-event ${line}`),
  });

  return {
    codexCompleted: true,
    telegramStarted: telegram.started,
    telegramStopped: telegram.stopped,
  };
}

export async function run(): Promise<void> {
  const result = await runTelegramRealSmokeCore({ env: process.env });
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

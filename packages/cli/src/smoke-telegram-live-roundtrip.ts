import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexRichEvent } from "@codex-im/codex-runtime";
import {
  type SecurityPolicySender,
  type SessionBindingInput,
  type SessionRoute,
  SessionRouter,
  type Target,
} from "@codex-im/core";
import {
  Daemon,
  type DaemonActionAck,
  type DaemonAdapter,
  type DaemonMessageRef,
  type DaemonSendCardResult,
} from "@codex-im/daemon";
import {
  type TelegramBotLike,
  TelegramChannelAdapter,
  TelegramLiveSmokeBot,
  TelegramRecordingBot,
} from "@codex-im/im-telegram";
import {
  BindingRepository,
  type DatabaseHandle,
  openDatabase,
  runMigrations,
} from "@codex-im/storage-sqlite";

export type TelegramLiveRoundtripSmokeFailureReason =
  | "missing-live-roundtrip-flag"
  | "missing-token"
  | "invalid-timeout"
  | "live-roundtrip-failed";

export type TelegramLiveRoundtripSmokeResult =
  | {
      readonly ok: true;
      readonly nonce: string;
      readonly promptText: string;
      readonly finalText: string;
      readonly observedChatId: string;
      readonly observedUserId: string;
      readonly turnStarts: number;
      readonly sentMessages: number;
      readonly finalEdits: number;
    }
  | { readonly ok: false; readonly reason: TelegramLiveRoundtripSmokeFailureReason };

export interface TelegramLiveRoundtripRunnerInput {
  readonly botToken: string;
  readonly nonce: string;
  readonly promptText: string;
  readonly finalText: string;
  readonly timeoutMs: number;
  readonly migrationsDir: string;
  readonly allowedChatId?: string;
  readonly allowedUserId?: string;
  readonly output: (line: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly createBot?: (botToken: string) => TelegramBotLike;
}

export type TelegramLiveRoundtripRunner = (
  input: TelegramLiveRoundtripRunnerInput,
) => Promise<Extract<TelegramLiveRoundtripSmokeResult, { ok: true }>>;

export interface RunTelegramLiveRoundtripSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly runLiveRoundtrip?: TelegramLiveRoundtripRunner;
}

interface LiveRoundtripRuntimeTurnStartParams {
  readonly threadId: string;
  readonly input: readonly { readonly text?: string }[];
}

interface LiveRoundtripInboundMessage {
  readonly target: Target;
  readonly sender: SecurityPolicySender;
  readonly text: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const SMOKE_NAME = "smoke:telegram-live-roundtrip";
const DEFAULT_MIGRATIONS_DIR = join(process.cwd(), "packages/storage-sqlite/src/migrations");
const PROJECT_ID = "codex-im";

export async function runTelegramLiveRoundtripSmokeCore(
  options: RunTelegramLiveRoundtripSmokeOptions = {},
): Promise<TelegramLiveRoundtripSmokeResult> {
  const env = options.env ?? process.env;
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const runLiveRoundtrip = options.runLiveRoundtrip ?? runTelegramLiveRoundtripWithDaemon;

  if (env.TELEGRAM_LIVE_ROUNDTRIP !== "1") {
    errorOutput(
      [
        `${SMOKE_NAME} is operator-gated.`,
        "Run with TELEGRAM_LIVE_ROUNDTRIP=1 and IM_TELEGRAM_BOT_TOKEN set in the environment.",
      ].join("\n"),
    );
    return { ok: false, reason: "missing-live-roundtrip-flag" };
  }

  const botToken = env.IM_TELEGRAM_BOT_TOKEN;
  if (botToken === undefined || botToken.trim().length === 0) {
    errorOutput(`${SMOKE_NAME} requires IM_TELEGRAM_BOT_TOKEN in the environment.`);
    return { ok: false, reason: "missing-token" };
  }

  let timeoutMs: number;
  try {
    timeoutMs = parseTelegramRoundtripTimeoutMs(env.TELEGRAM_ROUNDTRIP_TIMEOUT_MS);
  } catch (error) {
    errorOutput(redactTelegramSecrets(describeError(error)));
    return { ok: false, reason: "invalid-timeout" };
  }

  const nonce = env.TELEGRAM_ROUNDTRIP_NONCE ?? randomBytes(6).toString("hex");
  const promptText = `codex-im-live-roundtrip ${nonce}`;
  const finalText = `Codex IM Telegram live roundtrip OK ${nonce}`;

  try {
    const allowedChatId = parseScopedTelegramId(env.TELEGRAM_ROUNDTRIP_ALLOWED_CHAT_ID);
    const allowedUserId = parseScopedTelegramId(env.TELEGRAM_ROUNDTRIP_ALLOWED_USER_ID);
    const result = await runLiveRoundtrip({
      botToken,
      nonce,
      promptText,
      finalText,
      timeoutMs,
      migrationsDir: env.CODEX_IM_SMOKE_MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR,
      ...(allowedChatId === undefined ? {} : { allowedChatId }),
      ...(allowedUserId === undefined ? {} : { allowedUserId }),
      output,
      sleep,
    });
    output(
      [
        `${SMOKE_NAME} ok`,
        `chatId=${result.observedChatId}`,
        `userId=${result.observedUserId}`,
        `turnStarts=${result.turnStarts}`,
        `sentMessages=${result.sentMessages}`,
        `finalEdits=${result.finalEdits}`,
      ].join(" "),
    );
    return result;
  } catch (error) {
    errorOutput(`${SMOKE_NAME} failed: ${redactTelegramSecrets(describeError(error))}`);
    return { ok: false, reason: "live-roundtrip-failed" };
  }
}

export function parseTelegramRoundtripTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    String(parsed) !== raw ||
    parsed < 1_000 ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `TELEGRAM_ROUNDTRIP_TIMEOUT_MS must be an integer between 1000 and ${MAX_TIMEOUT_MS}`,
    );
  }
  return parsed;
}

export async function runTelegramLiveRoundtripWithDaemon(
  input: TelegramLiveRoundtripRunnerInput,
): Promise<Extract<TelegramLiveRoundtripSmokeResult, { ok: true }>> {
  const workspace = mkdtempSync(join(tmpdir(), "codex-im-telegram-live-roundtrip-"));
  const db = openDatabase(join(workspace, "state.db"));
  runMigrations(db, input.migrationsDir);

  const bindings = new BindingRepository(db);
  const sessionRouter = new SessionRouter({ bindings });
  const runtime = new LiveRoundtripRuntime(input.finalText);
  const sourceBot =
    input.createBot?.(input.botToken) ?? new TelegramLiveSmokeBot({ botToken: input.botToken });
  const recordingBot = new TelegramRecordingBot(sourceBot);
  const adapter = new TelegramChannelAdapter({ bot: recordingBot });
  let acceptedMessage: LiveRoundtripInboundMessage | undefined;
  const gatedAdapter = new ExactPromptGateAdapter(adapter, {
    promptText: input.promptText,
    onAccepted: (message) => {
      acceptedMessage = message;
      sessionRouter.bind(message.target, {
        projectId: PROJECT_ID,
        cwd: workspace,
        codexThreadId: `telegram-live-roundtrip-${input.nonce}`,
        defaultModel: "live-roundtrip-smoke",
      });
    },
  });

  const daemon = new Daemon({
    loadConfig: () => ({
      projects: {
        [PROJECT_ID]: {
          cwd: workspace,
          defaultModel: "live-roundtrip-smoke",
        },
      },
    }),
    openStorage: () => runtimeStorage(db),
    createBroker: () => ({
      attach: () => undefined,
      enablePendingMode: () => undefined,
    }),
    createSecurityPolicy: () => ({
      checkUserAndChat: (target: Target, sender: SecurityPolicySender) => {
        if (target.platform !== "telegram") {
          return { kind: "deny" as const, reason: "platform_denied" as const };
        }
        if (input.allowedChatId !== undefined && target.chatId !== input.allowedChatId) {
          return { kind: "deny" as const, reason: "chat_denied" as const };
        }
        if (input.allowedUserId !== undefined && sender.userId !== input.allowedUserId) {
          return { kind: "deny" as const, reason: "user_denied" as const };
        }
        return { kind: "allow" as const };
      },
      checkProjectAccess: () => ({ kind: "allow" as const }),
      checkApprovalDestination: () => ({ kind: "allow" as const }),
      checkCommand: () => ({ kind: "allow" as const }),
    }),
    createSessionRouter: () => sessionRouter,
    createSupervisor: () => ({ currentRuntime: () => runtime }),
    createAdapter: () => gatedAdapter,
    schedulePrune: () => () => undefined,
  });

  try {
    await daemon.start();
    input.output(`${SMOKE_NAME} waiting for real Telegram inbound message`);
    input.output(`Send this exact text to the bot before timeout: ${input.promptText}`);
    input.output(
      "Optional hardening: set TELEGRAM_ROUNDTRIP_ALLOWED_USER_ID and TELEGRAM_ROUNDTRIP_ALLOWED_CHAT_ID to require a known Telegram actor/chat.",
    );
    await waitFor(
      () =>
        runtime.turnStarts > 0 &&
        recordingBot.editedTexts.some((entry) => entry.text.includes(input.finalText)),
      {
        timeoutMs: input.timeoutMs,
        sleep: input.sleep,
      },
    );

    if (acceptedMessage === undefined) {
      throw new Error("roundtrip completed without an accepted inbound message");
    }

    return {
      ok: true,
      nonce: input.nonce,
      promptText: input.promptText,
      finalText: input.finalText,
      observedChatId: acceptedMessage.target.chatId,
      observedUserId: acceptedMessage.sender.userId,
      turnStarts: runtime.turnStarts,
      sentMessages: recordingBot.sentMessages.length,
      finalEdits: recordingBot.editedTexts.filter((entry) => entry.text.includes(input.finalText))
        .length,
    };
  } finally {
    await daemon.stop();
  }
}

export async function run(): Promise<void> {
  const result = await runTelegramLiveRoundtripSmokeCore({ env: process.env });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

class ExactPromptGateAdapter implements DaemonAdapter {
  readonly #delegate: DaemonAdapter;
  readonly #promptText: string;
  readonly #onAccepted: (message: LiveRoundtripInboundMessage) => void;

  constructor(
    delegate: DaemonAdapter,
    options: {
      readonly promptText: string;
      readonly onAccepted: (message: LiveRoundtripInboundMessage) => void;
    },
  ) {
    this.#delegate = delegate;
    this.#promptText = options.promptText;
    this.#onAccepted = options.onAccepted;
  }

  onAction(handler: (action: unknown) => void) {
    return this.#delegate.onAction(handler);
  }

  onMessage(handler: (message: unknown) => void) {
    return this.#delegate.onMessage((message) => {
      const inbound = readInboundMessage(message);
      if (inbound === undefined || inbound.text.trim() !== this.#promptText) {
        return;
      }
      this.#onAccepted(inbound);
      handler(message);
    });
  }

  pauseInbound() {
    return this.#delegate.pauseInbound?.();
  }

  answerAction(callbackHandle: string, ack: DaemonActionAck) {
    return this.#delegate.answerAction?.(callbackHandle, ack);
  }

  sendCard(target: Target, card: Parameters<NonNullable<DaemonAdapter["sendCard"]>>[1]) {
    const sendCard = this.#delegate.sendCard;
    if (sendCard === undefined) {
      throw new Error("ExactPromptGateAdapter requires delegate sendCard");
    }
    return sendCard.call(this.#delegate, target, card) as Promise<DaemonSendCardResult>;
  }

  updateCard(ref: DaemonMessageRef, card: Parameters<NonNullable<DaemonAdapter["updateCard"]>>[1]) {
    return this.#delegate.updateCard?.(ref, card);
  }

  editText(ref: DaemonMessageRef, body: string) {
    return this.#delegate.editText?.(ref, body);
  }

  sendText(target: Target, body: string) {
    const sendText = this.#delegate.sendText;
    if (sendText === undefined) {
      throw new Error("ExactPromptGateAdapter requires delegate sendText");
    }
    return sendText.call(this.#delegate, target, body);
  }

  start() {
    return this.#delegate.start?.();
  }

  stop() {
    return this.#delegate.stop?.();
  }
}

class LiveRoundtripRuntime {
  readonly events: { readonly events: () => EventQueue };
  readonly #queue = new EventQueue();
  readonly #finalText: string;
  turnStarts = 0;

  constructor(finalText: string) {
    this.#finalText = finalText;
    this.events = { events: () => this.#queue };
  }

  threadStart(): { thread: { id: string } } {
    return { thread: { id: "telegram-live-roundtrip-thread" } };
  }

  turnStart(params: LiveRoundtripRuntimeTurnStartParams): { turn: { id: string } } {
    this.turnStarts++;
    const turnId = `telegram-live-roundtrip-turn-${this.turnStarts}`;
    setImmediate(() => {
      this.#queue.push({
        type: "agent_message_delta",
        threadId: params.threadId,
        turnId,
        itemId: "telegram-live-roundtrip-item",
        deltaText: this.#finalText,
        raw: {},
      });
      this.#queue.push({
        type: "turn_completed",
        threadId: params.threadId,
        turnId,
        raw: {},
        terminal: true,
      });
    });
    return { turn: { id: turnId } };
  }

  turnSteer(): Record<string, never> {
    return {};
  }

  turnInterrupt(): Record<string, never> {
    return {};
  }
}

class EventQueue implements AsyncIterableIterator<CodexRichEvent> {
  readonly #queue: CodexRichEvent[] = [];
  readonly #waiters: Array<(value: IteratorResult<CodexRichEvent>) => void> = [];

  push(event: CodexRichEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: event, done: false });
      return;
    }
    this.#queue.push(event);
  }

  next(): Promise<IteratorResult<CodexRichEvent>> {
    const event = this.#queue.shift();
    if (event !== undefined) {
      return Promise.resolve({ value: event, done: false });
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<CodexRichEvent> {
    return this;
  }
}

function runtimeStorage(db: DatabaseHandle): { close(): void } {
  return {
    close: () => db.close(),
  };
}

function readInboundMessage(value: unknown): LiveRoundtripInboundMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const target = readTarget(record.target);
  const sender = readSender(record.sender);
  if (target === undefined || sender === undefined || typeof record.text !== "string") {
    return undefined;
  }
  return { target, sender, text: record.text };
}

function readTarget(value: unknown): Target | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.platform !== "telegram" || typeof record.chatId !== "string") {
    return undefined;
  }
  const topicId = typeof record.topicId === "string" ? record.topicId : undefined;
  return {
    platform: "telegram",
    chatId: record.chatId,
    ...(topicId === undefined ? {} : { topicId }),
  };
}

function readSender(value: unknown): SecurityPolicySender | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.userId !== "string") {
    return undefined;
  }
  const displayName = typeof record.displayName === "string" ? record.displayName : undefined;
  return { userId: record.userId, ...(displayName === undefined ? {} : { displayName }) };
}

function parseScopedTelegramId(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value.startsWith("telegram:") ? value.slice("telegram:".length) : value;
}

async function waitFor(
  predicate: () => boolean,
  options: { readonly timeoutMs: number; readonly sleep: (ms: number) => Promise<void> },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await options.sleep(50);
  }
  throw new Error("timed out waiting for real Telegram roundtrip evidence");
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

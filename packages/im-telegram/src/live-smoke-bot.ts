import { setTimeout as sleep } from "node:timers/promises";
import { Bot } from "grammy";
import type {
  TelegramBotApiLike,
  TelegramBotLike,
  TelegramCallbackQueryHandlerLike,
  TelegramEditMessageReplyMarkupOptions,
  TelegramEditMessageTextOptions,
  TelegramMessageHandlerLike,
  TelegramSendMessageOptions,
} from "./adapter.js";

export interface TelegramLiveSmokeBotOptions {
  readonly botToken: string;
  readonly validateTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly createBot?: (botToken: string) => TelegramLiveSmokeBotLike;
}

export interface TelegramLiveSmokeBotLike {
  readonly api: TelegramLiveSmokeBotApiLike;
  start(options?: { readonly drop_pending_updates?: boolean }): Promise<void>;
  stop(): void | Promise<void>;
  on(
    filter: "message:text" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown;
}

export interface TelegramLiveSmokeBotApiLike extends TelegramBotApiLike {
  getMe(): Promise<unknown>;
}

export interface TelegramRecordedSendMessage {
  readonly chatId: string;
  readonly messageId: string;
  readonly text: string;
}

export interface TelegramRecordedEditText {
  readonly chatId: string;
  readonly messageId: string;
  readonly text: string;
}

const DEFAULT_VALIDATE_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

/**
 * Live-smoke wrapper for grammY's long-polling bot.
 *
 * The production adapter awaits `bot.start()`, but grammY's real
 * long-polling promise resolves only after polling stops. This wrapper keeps
 * the adapter contract (`start()` resolves) by validating the token with
 * Telegram first, then starting polling in the background until `stop()`.
 */
export class TelegramLiveSmokeBot implements TelegramBotLike {
  readonly #bot: TelegramLiveSmokeBotLike;
  readonly #validateTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  #polling: Promise<void> | undefined;
  #pollingError: unknown;

  readonly api: TelegramBotApiLike;

  constructor(options: TelegramLiveSmokeBotOptions) {
    if (options.botToken.trim().length === 0) {
      throw new Error("TelegramLiveSmokeBot requires a bot token");
    }
    this.#bot =
      options.createBot?.(options.botToken) ??
      (new Bot(options.botToken) as unknown as TelegramLiveSmokeBotLike);
    this.#validateTimeoutMs = options.validateTimeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS;
    this.#stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.api = this.#bot.api;
  }

  async start(): Promise<void> {
    if (this.#polling !== undefined) {
      return;
    }

    await withTimeout(
      this.#bot.api.getMe().then(() => undefined),
      this.#validateTimeoutMs,
      "Telegram live smoke token validation timed out",
    );

    this.#polling = this.#bot.start({ drop_pending_updates: true }).catch((error: unknown) => {
      this.#pollingError = error;
    });
    await sleep(0);
    if (this.#pollingError !== undefined) {
      throw describeLiveSmokeError(this.#pollingError);
    }
  }

  async stop(): Promise<void> {
    if (this.#polling === undefined) {
      return;
    }
    await this.#bot.stop();
    await withTimeout(
      this.#polling,
      this.#stopTimeoutMs,
      "Telegram live smoke polling stop timed out",
    );
    const pollingError = this.#pollingError;
    this.#polling = undefined;
    this.#pollingError = undefined;
    if (pollingError !== undefined && !isExpectedPollingStopError(pollingError)) {
      throw describeLiveSmokeError(pollingError);
    }
  }

  on(
    filter: "message:text" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown {
    return this.#bot.on(filter, handler);
  }
}

/**
 * Recording wrapper used by live acceptance smokes.
 *
 * It keeps Telegram API method interception inside im-telegram while exposing
 * only sanitized sent/edited text evidence to CLI smoke orchestration.
 */
export class TelegramRecordingBot implements TelegramBotLike {
  readonly #bot: TelegramBotLike;
  readonly sentMessages: TelegramRecordedSendMessage[] = [];
  readonly editedTexts: TelegramRecordedEditText[] = [];
  readonly api: TelegramBotApiLike;

  constructor(bot: TelegramBotLike) {
    const api = bot.api;
    if (api === undefined) {
      throw new Error("TelegramRecordingBot requires a bot API");
    }
    this.#bot = bot;
    this.api = {
      sendMessage: async (chatId: string, text: string, options: TelegramSendMessageOptions) => {
        const sent = await api.sendMessage(chatId, text, options);
        this.sentMessages.push({ chatId, messageId: String(sent.message_id), text });
        return sent;
      },
      editMessageReplyMarkup: (
        chatId: string,
        messageId: number,
        options: TelegramEditMessageReplyMarkupOptions,
      ) => api.editMessageReplyMarkup(chatId, messageId, options),
      editMessageText: async (
        chatId: string,
        messageId: number,
        text: string,
        options: TelegramEditMessageTextOptions,
      ) => {
        const result = await api.editMessageText(chatId, messageId, text, options);
        this.editedTexts.push({ chatId, messageId: String(messageId), text });
        return result;
      },
      answerCallbackQuery: (callbackQueryId, options) =>
        api.answerCallbackQuery(callbackQueryId, options),
    };
  }

  start(): Promise<void> {
    return this.#bot.start();
  }

  stop(): void | Promise<void> {
    return this.#bot.stop();
  }

  on(
    filter: "message:text" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown {
    return this.#bot.on?.(filter, handler);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function describeLiveSmokeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function isExpectedPollingStopError(error: unknown): boolean {
  return error instanceof Error && error.message === "Aborted delay";
}

import { describe, expect, it, vi } from "vitest";
import { TelegramLiveSmokeBot, TelegramRecordingBot } from "../src/index.js";
import type {
  TelegramCallbackQueryHandlerLike,
  TelegramLiveSmokeBotLike,
  TelegramMessageHandlerLike,
} from "../src/index.js";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("TelegramLiveSmokeBot", () => {
  it("treats grammY polling Aborted delay during stop as normal shutdown", async () => {
    const polling = deferred<void>();
    const fakeBot: TelegramLiveSmokeBotLike = {
      api: {
        getMe: vi.fn(async () => ({ id: 1 })),
        sendMessage: vi.fn(async () => ({ message_id: 1 })),
        editMessageReplyMarkup: vi.fn(async () => undefined),
        editMessageText: vi.fn(async () => undefined),
        answerCallbackQuery: vi.fn(async () => undefined),
      },
      start: vi.fn(() => polling.promise),
      stop: vi.fn(() => {
        polling.reject(new Error("Aborted delay"));
      }),
      on: vi.fn(
        (
          _filter: "message:text" | "callback_query:data",
          _handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
        ) => undefined,
      ),
    };
    const bot = new TelegramLiveSmokeBot({
      botToken: ["1234567890", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd"].join(":"),
      createBot: () => fakeBot,
    });

    await bot.start();
    await expect(bot.stop()).resolves.toBeUndefined();

    expect(fakeBot.stop).toHaveBeenCalledTimes(1);
  });

  it("records sanitized outbound send and edit text evidence", async () => {
    const fakeBot: TelegramLiveSmokeBotLike = {
      api: {
        getMe: vi.fn(async () => ({ id: 1 })),
        sendMessage: vi.fn(async () => ({ message_id: 42 })),
        editMessageReplyMarkup: vi.fn(async () => undefined),
        editMessageText: vi.fn(async () => undefined),
        answerCallbackQuery: vi.fn(async () => undefined),
      },
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      on: vi.fn(
        (
          _filter: "message:text" | "callback_query:data",
          _handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
        ) => undefined,
      ),
    };
    const bot = new TelegramRecordingBot(fakeBot);

    await bot.api.sendMessage("chat-1", "working", {});
    await bot.api.editMessageText("chat-1", 42, "done", {});

    expect(bot.sentMessages).toEqual([{ chatId: "chat-1", messageId: "42", text: "working" }]);
    expect(bot.editedTexts).toEqual([{ chatId: "chat-1", messageId: "42", text: "done" }]);
  });
});

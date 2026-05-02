import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type TelegramBotApiLike,
  type TelegramBotLike,
  type TelegramCallbackQueryContextLike,
  TelegramChannelAdapter,
  encodeTelegramCallbackHandle,
} from "../src/index.js";

const FIXTURE_DIR = "packages/im-telegram/test/fixtures";
const NOW = new Date(1710000500 * 1000);

type RawCallbackUpdate = {
  readonly callback_query: NonNullable<TelegramCallbackQueryContextLike["callbackQuery"]>;
};

function loadFixture(name: string): RawCallbackUpdate {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as RawCallbackUpdate;
}

class FakeTelegramBot implements TelegramBotLike {
  readonly start = vi.fn(async () => undefined);
  readonly stop = vi.fn(() => undefined);
  readonly api: TelegramBotApiLike = {
    sendMessage: vi.fn<TelegramBotApiLike["sendMessage"]>(async () => ({ message_id: 1 })),
    editMessageReplyMarkup: vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>(async () => true),
    editMessageText: vi.fn<TelegramBotApiLike["editMessageText"]>(async () => true),
    answerCallbackQuery: vi.fn<TelegramBotApiLike["answerCallbackQuery"]>(async () => true),
  };

  #callbackHandlers: Array<(ctx: TelegramCallbackQueryContextLike) => void | Promise<void>> = [];

  on(
    filter: "message:text" | "callback_query:data",
    handler:
      | ((ctx: TelegramCallbackQueryContextLike) => void | Promise<void>)
      | ((ctx: never) => void | Promise<void>),
  ) {
    if (filter === "callback_query:data") {
      this.#callbackHandlers.push(handler as (ctx: TelegramCallbackQueryContextLike) => void);
    }
  }

  async injectUpdate(update: RawCallbackUpdate): Promise<void> {
    await Promise.all(
      this.#callbackHandlers.map((handler) => handler({ callbackQuery: update.callback_query })),
    );
  }
}

describe("TelegramChannelAdapter.onAction raw fixtures (T27/T28d-f)", () => {
  it("maps callback_query.message null to an unknown messageRef", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot, now: () => NOW });
    const seen = vi.fn();
    adapter.onAction(seen);
    await adapter.start();

    await bot.injectUpdate(loadFixture("callback-message-null.json"));

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
        callbackNonce: "ABCDEFGHIJKLMNOP",
        callbackHandle: encodeTelegramCallbackHandle("cb-null-message", NOW),
        target: { platform: "telegram", chatId: "<unknown>" },
        sender: { userId: "123456789", displayName: "ada_dev" },
        messageRef: {
          target: { platform: "telegram", chatId: "<unknown>" },
          messageId: "<unknown>",
        },
      }),
    );
    await adapter.stop();
  });

  it.each([
    ["callback-message-deleted.json", "cb-deleted-message", "44", "v1:QRSTUVWXYZ234567"],
    ["callback-message-inaccessible.json", "cb-inaccessible-message", "45", "v1:ABCDEFGH234567AA"],
    ["callback-stale-message.json", "cb-stale-message", "999", "v1:QRSTUVWXABCDEFGH"],
  ])(
    "passes through callback messageRef for %s",
    async (fixture, callbackId, messageId, rawData) => {
      const bot = new FakeTelegramBot();
      const adapter = new TelegramChannelAdapter({ bot, now: () => NOW });
      const seen = vi.fn();
      adapter.onAction(seen);
      await adapter.start();

      await bot.injectUpdate(loadFixture(fixture));

      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({
          rawCallbackData: rawData,
          callbackHandle: encodeTelegramCallbackHandle(callbackId, NOW),
          target: { platform: "telegram", chatId: "-1009876543210" },
          messageRef: {
            target: { platform: "telegram", chatId: "-1009876543210" },
            messageId,
          },
        }),
      );
      await adapter.stop();
    },
  );

  it("emits malformed callback_data verbatim for daemon fail-closed handling", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot, now: () => NOW });
    const seen = vi.fn();
    adapter.onAction(seen);
    await adapter.start();

    await bot.injectUpdate(loadFixture("callback-malformed-data.json"));

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCallbackData: "approval-1|decline|legacy",
        callbackNonce: "",
        target: { platform: "telegram", chatId: "-1009876543210" },
        messageRef: {
          target: { platform: "telegram", chatId: "-1009876543210" },
          messageId: "46",
        },
      }),
    );
    await adapter.stop();
  });
});

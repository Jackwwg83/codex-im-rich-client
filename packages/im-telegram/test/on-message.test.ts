import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  TelegramBotApiLike,
  TelegramBotLike,
  TelegramMessageContextLike,
} from "../src/index.js";
import { TelegramChannelAdapter } from "../src/index.js";

const FIXTURE_DIR = "packages/im-telegram/test/fixtures";

type RawUpdate = {
  readonly message: NonNullable<TelegramMessageContextLike["message"]>;
};

function loadFixture(name: string): RawUpdate {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as RawUpdate;
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

  #messageTextHandlers: Array<(ctx: TelegramMessageContextLike) => void | Promise<void>> = [];

  on(filter: "message:text", handler: (ctx: TelegramMessageContextLike) => void | Promise<void>) {
    expect(filter).toBe("message:text");
    this.#messageTextHandlers.push(handler);
  }

  async injectUpdate(update: RawUpdate): Promise<void> {
    const message = update.message;
    await Promise.all(
      this.#messageTextHandlers.map((handler) =>
        handler({
          message,
          chat: message.chat,
          ...(message.from !== undefined ? { from: message.from } : {}),
        }),
      ),
    );
  }
}

describe("TelegramChannelAdapter.onMessage raw fixtures (T26/T28a-c)", () => {
  it("maps a private message fixture to InboundMessage", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot });
    const seen = vi.fn();
    adapter.onMessage(seen);
    await adapter.start();

    await bot.injectUpdate(loadFixture("private-message.json"));

    expect(seen).toHaveBeenCalledWith({
      target: { platform: "telegram", chatId: "123456789" },
      sender: { userId: "123456789", displayName: "ada_dev" },
      text: "/use codex-im",
      receivedAt: new Date(1710000000 * 1000),
      messageRef: {
        target: { platform: "telegram", chatId: "123456789" },
        messageId: "11",
      },
    });
    await adapter.stop();
  });

  it("maps a group message fixture to InboundMessage", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot });
    const seen = vi.fn();
    adapter.onMessage(seen);
    await adapter.start();

    await bot.injectUpdate(loadFixture("group-message.json"));

    expect(seen).toHaveBeenCalledWith({
      target: { platform: "telegram", chatId: "-1009876543210" },
      sender: { userId: "222333444", displayName: "Grace Hopper" },
      text: "run tests",
      receivedAt: new Date(1710000060 * 1000),
      messageRef: {
        target: { platform: "telegram", chatId: "-1009876543210" },
        messageId: "22",
      },
    });
    await adapter.stop();
  });

  it("maps a forum topic fixture to target.topicId", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot });
    const seen = vi.fn();
    adapter.onMessage(seen);
    await adapter.start();

    await bot.injectUpdate(loadFixture("forum-topic-message.json"));

    expect(seen).toHaveBeenCalledWith({
      target: { platform: "telegram", chatId: "-1009876543210", topicId: "42" },
      sender: { userId: "555666777", displayName: "kj" },
      text: "status",
      receivedAt: new Date(1710000120 * 1000),
      messageRef: {
        target: { platform: "telegram", chatId: "-1009876543210", topicId: "42" },
        messageId: "33",
      },
    });
    await adapter.stop();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  type TelegramBotApiLike,
  type TelegramBotLike,
  TelegramChannelAdapter,
} from "../src/index.js";

const TARGET = { platform: "telegram", chatId: "-100123456" };

type ApprovalCardInput = Parameters<TelegramChannelAdapter["sendCard"]>[1];
type SendMessageMock = ReturnType<typeof vi.fn<TelegramBotApiLike["sendMessage"]>>;

const CARD: ApprovalCardInput = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-1",
  summary: "Run npm test",
  target: { riskLevel: "high" },
  actions: [
    { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
    { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
  ],
  status: "pending",
  createdAt: new Date(0),
};

function makeSendMessage(): SendMessageMock {
  return vi.fn<TelegramBotApiLike["sendMessage"]>(async () => ({ message_id: 42 }));
}

function makeBot(sendMessage: SendMessageMock = makeSendMessage()): TelegramBotLike {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(() => undefined),
    api: {
      sendMessage,
      editMessageReplyMarkup: vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>(async () => true),
      editMessageText: vi.fn<TelegramBotApiLike["editMessageText"]>(async () => true),
      answerCallbackQuery: vi.fn<TelegramBotApiLike["answerCallbackQuery"]>(async () => true),
    },
  };
}

describe("TelegramChannelAdapter.sendCard (T22b/T22c)", () => {
  it("sends an approval card with action.wirePayload used verbatim as callback_data", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    const result = await adapter.sendCard(TARGET, CARD);

    expect(sendMessage).toHaveBeenCalledWith(
      "-100123456",
      expect.stringContaining("Run npm test"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Allow once", callback_data: "v1:ABCDEFGHIJKLMNOP" }],
            [{ text: "Decline", callback_data: "v1:QRSTUVWXYZ234567" }],
          ],
        },
      },
    );
    expect(result.messageRef).toEqual({ target: TARGET, messageId: "42" });
    expect(result.callbackNonce).toMatch(/^[a-f0-9]{32}$/);
    await adapter.stop();
  });

  it("fails locally when a production action has no wirePayload", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    await expect(
      adapter.sendCard(TARGET, { ...CARD, actions: [{ kind: "decline" }] }),
    ).rejects.toThrow(/wirePayload/);
    expect(sendMessage).not.toHaveBeenCalled();
    await adapter.stop();
  });

  it("fails locally when wirePayload is not the v1 opaque callback_data shape", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    await expect(
      adapter.sendCard(TARGET, {
        ...CARD,
        actions: [{ kind: "decline", wirePayload: "approval-1|decline|nonce" }],
      }),
    ).rejects.toThrow(/callback_data/);
    expect(sendMessage).not.toHaveBeenCalled();
    await adapter.stop();
  });

  it("passes numeric Telegram topicId through as message_thread_id", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    await adapter.sendCard({ ...TARGET, topicId: "42" }, CARD);

    expect(sendMessage.mock.calls[0]?.[2]).toEqual({
      message_thread_id: 42,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Allow once", callback_data: "v1:ABCDEFGHIJKLMNOP" }],
          [{ text: "Decline", callback_data: "v1:QRSTUVWXYZ234567" }],
        ],
      },
    });
    await adapter.stop();
  });

  it("fails closed for non-numeric Telegram topicId", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    await expect(adapter.sendCard({ ...TARGET, topicId: "not-a-number" }, CARD)).rejects.toThrow(
      /topicId/,
    );
    expect(sendMessage).not.toHaveBeenCalled();
    await adapter.stop();
  });

  it.each([
    ["network failure", new Error("socket hang up"), /socket hang up/],
    ["401 unauthorized", { error_code: 401, description: "Unauthorized" }, /api 401 Unauthorized/],
    [
      "429 rate limit",
      { error_code: 429, description: "Too Many Requests", parameters: { retry_after: 30 } },
      /api 429 Too Many Requests retry_after=30/,
    ],
  ])(
    "surfaces %s from sendMessage without mutating callback_data",
    async (_name, error, expected) => {
      const sendMessage = vi.fn<TelegramBotApiLike["sendMessage"]>(async () => {
        throw error;
      });
      const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
      await adapter.start();

      await expect(adapter.sendCard(TARGET, CARD)).rejects.toThrow(expected);
      expect(sendMessage.mock.calls[0]?.[2]).toEqual({
        reply_markup: {
          inline_keyboard: [
            [{ text: "Allow once", callback_data: "v1:ABCDEFGHIJKLMNOP" }],
            [{ text: "Decline", callback_data: "v1:QRSTUVWXYZ234567" }],
          ],
        },
      });
      await adapter.stop();
    },
  );
});

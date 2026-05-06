import { describe, expect, it, vi } from "vitest";
import {
  type TelegramBotApiLike,
  type TelegramBotLike,
  TelegramChannelAdapter,
} from "../src/index.js";

const TARGET = { platform: "telegram", chatId: "-100123456" };

type ApprovalCardInput = Parameters<TelegramChannelAdapter["sendCard"]>[1];
type SendMessageMock = ReturnType<typeof vi.fn<TelegramBotApiLike["sendMessage"]>>;
type SendDocumentMock = ReturnType<typeof vi.fn<TelegramBotApiLike["sendDocument"]>>;
type SendPhotoMock = ReturnType<typeof vi.fn<TelegramBotApiLike["sendPhoto"]>>;

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
      sendDocument: vi.fn<TelegramBotApiLike["sendDocument"]>(async () => ({ message_id: 43 })),
      sendPhoto: vi.fn<TelegramBotApiLike["sendPhoto"]>(async () => ({ message_id: 44 })),
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
    expect(result.messageRef).toEqual({
      target: TARGET,
      messageId: "42",
      kind: "approval_card",
      textUpdateMode: "edit",
    });
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

  it("sends daemon turn output as a bot-owned text message without inline buttons", async () => {
    const sendMessage = makeSendMessage();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(sendMessage) });
    await adapter.start();

    const result = await adapter.sendText({ ...TARGET, topicId: "42" }, "Codex is working...");

    expect(sendMessage).toHaveBeenCalledWith("-100123456", "Codex is working...", {
      message_thread_id: 42,
    });
    expect(result).toEqual({
      target: { ...TARGET, topicId: "42" },
      messageId: "42",
      kind: "text",
      textUpdateMode: "edit",
    });
    await adapter.stop();
  });

  it("sends generic file payloads as Telegram documents", async () => {
    const sendDocument: SendDocumentMock = vi.fn(async () => ({ message_id: 45 }));
    const bot = makeBot();
    const api = bot.api;
    if (api === undefined) {
      throw new Error("test bot missing api");
    }
    api.sendDocument = sendDocument;
    const adapter = new TelegramChannelAdapter({ bot });
    await adapter.start();

    const result = await adapter.sendFile(
      { ...TARGET, topicId: "42" },
      {
        filename: "codex-diff.patch",
        bytes: new TextEncoder().encode("diff --git a/file b/file"),
        contentType: "text/x-patch",
      },
    );

    expect(sendDocument).toHaveBeenCalledWith(
      "-100123456",
      expect.objectContaining({ filename: "codex-diff.patch" }),
      { message_thread_id: 42, caption: "codex-diff.patch" },
    );
    expect(result).toEqual({
      target: { ...TARGET, topicId: "42" },
      messageId: "45",
      kind: "file",
    });
    await adapter.stop();
  });

  it("sends image file payloads as Telegram photos", async () => {
    const sendPhoto: SendPhotoMock = vi.fn(async () => ({ message_id: 46 }));
    const bot = makeBot();
    const api = bot.api;
    if (api === undefined) {
      throw new Error("test bot missing api");
    }
    api.sendPhoto = sendPhoto;
    const adapter = new TelegramChannelAdapter({ bot });
    await adapter.start();

    const result = await adapter.sendFile(TARGET, {
      filename: "screenshot.png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
    });

    expect(sendPhoto).toHaveBeenCalledWith(
      "-100123456",
      expect.objectContaining({ filename: "screenshot.png" }),
      { caption: "screenshot.png" },
    );
    expect(result).toEqual({ target: TARGET, messageId: "46", kind: "file" });
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

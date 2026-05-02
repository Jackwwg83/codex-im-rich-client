import { describe, expect, it, vi } from "vitest";
import {
  type TelegramBotApiLike,
  type TelegramBotLike,
  TelegramChannelAdapter,
  encodeTelegramCallbackHandle,
} from "../src/index.js";

const TARGET = { platform: "telegram", chatId: "-100123456" };
const MESSAGE_REF = { target: TARGET, messageId: "42" };

type ApprovalCardInput = Parameters<TelegramChannelAdapter["sendCard"]>[1];

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

type ApiMocks = {
  readonly sendMessage: ReturnType<typeof vi.fn<TelegramBotApiLike["sendMessage"]>>;
  readonly editMessageReplyMarkup: ReturnType<
    typeof vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>
  >;
  readonly editMessageText: ReturnType<typeof vi.fn<TelegramBotApiLike["editMessageText"]>>;
  readonly answerCallbackQuery: ReturnType<typeof vi.fn<TelegramBotApiLike["answerCallbackQuery"]>>;
};

function makeApi(): ApiMocks {
  return {
    sendMessage: vi.fn<TelegramBotApiLike["sendMessage"]>(async () => ({ message_id: 42 })),
    editMessageReplyMarkup: vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>(async () => true),
    editMessageText: vi.fn<TelegramBotApiLike["editMessageText"]>(async () => true),
    answerCallbackQuery: vi.fn<TelegramBotApiLike["answerCallbackQuery"]>(async () => true),
  };
}

function makeBot(api: ApiMocks): TelegramBotLike {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(() => undefined),
    api,
  };
}

describe("TelegramChannelAdapter message/action methods (T23-T25)", () => {
  it("updates an approval card reply markup and text", async () => {
    const api = makeApi();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(api) });
    await adapter.start();

    await adapter.updateCard(MESSAGE_REF, CARD);

    const expectedReplyMarkup = {
      inline_keyboard: [
        [{ text: "Allow once", callback_data: "v1:ABCDEFGHIJKLMNOP" }],
        [{ text: "Decline", callback_data: "v1:QRSTUVWXYZ234567" }],
      ],
    };
    expect(api.editMessageReplyMarkup).toHaveBeenCalledWith("-100123456", 42, {
      reply_markup: expectedReplyMarkup,
    });
    expect(api.editMessageText).toHaveBeenCalledWith(
      "-100123456",
      42,
      expect.stringContaining("Run npm test"),
      { reply_markup: expectedReplyMarkup },
    );
    await adapter.stop();
  });

  it("edits plain text by message reference", async () => {
    const api = makeApi();
    const adapter = new TelegramChannelAdapter({ bot: makeBot(api) });
    await adapter.start();

    await adapter.editText(MESSAGE_REF, "done");

    expect(api.editMessageText).toHaveBeenCalledWith("-100123456", 42, "done", {});
    await adapter.stop();
  });

  it("answers a callback query within the 60s deadline", async () => {
    const api = makeApi();
    const adapter = new TelegramChannelAdapter({
      bot: makeBot(api),
      now: () => new Date(1_000 + 59_000),
    });
    await adapter.start();

    await adapter.answerAction(encodeTelegramCallbackHandle("callback-1", new Date(1_000)), {
      ok: true,
      userMessage: "decision recorded",
    });

    expect(api.answerCallbackQuery).toHaveBeenCalledWith("callback-1", {
      text: "decision recorded",
      show_alert: false,
    });
    await adapter.stop();
  });

  it("rejects answerAction after the 60s callback-query deadline", async () => {
    const api = makeApi();
    const adapter = new TelegramChannelAdapter({
      bot: makeBot(api),
      now: () => new Date(1_000 + 61_000),
    });
    await adapter.start();

    await expect(
      adapter.answerAction(encodeTelegramCallbackHandle("callback-1", new Date(1_000)), {
        ok: false,
        userMessage: "expired",
      }),
    ).rejects.toThrow(/deadline/);
    expect(api.answerCallbackQuery).not.toHaveBeenCalled();
    await adapter.stop();
  });
});

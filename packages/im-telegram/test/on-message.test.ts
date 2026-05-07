import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  TelegramBotApiLike,
  TelegramBotLike,
  TelegramCallbackQueryHandlerLike,
  TelegramMessageContextLike,
  TelegramMessageHandlerLike,
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
    sendDocument: vi.fn<TelegramBotApiLike["sendDocument"]>(async () => ({ message_id: 2 })),
    sendPhoto: vi.fn<TelegramBotApiLike["sendPhoto"]>(async () => ({ message_id: 3 })),
    editMessageReplyMarkup: vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>(async () => true),
    editMessageText: vi.fn<TelegramBotApiLike["editMessageText"]>(async () => true),
    answerCallbackQuery: vi.fn<TelegramBotApiLike["answerCallbackQuery"]>(async () => true),
    getFile: vi.fn<NonNullable<TelegramBotApiLike["getFile"]>>(async () => ({
      file_path: "documents/file.txt",
    })),
  };

  #messageHandlers: Partial<
    Record<"message:text" | "message:photo" | "message:document", TelegramMessageHandlerLike[]>
  > = {};

  on(
    filter: "message:text" | "message:photo" | "message:document" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ) {
    expect(filter).not.toBe("callback_query:data");
    const messageFilter = filter as "message:text" | "message:photo" | "message:document";
    const handlers = this.#messageHandlers[messageFilter] ?? [];
    handlers.push(handler as TelegramMessageHandlerLike);
    this.#messageHandlers[messageFilter] = handlers;
  }

  async injectUpdate(update: RawUpdate): Promise<void> {
    const message = update.message;
    const filters: Array<"message:text" | "message:photo" | "message:document"> = [];
    if (message.text !== undefined) {
      filters.push("message:text");
    }
    if (message.photo !== undefined) {
      filters.push("message:photo");
    }
    if (message.document !== undefined) {
      filters.push("message:document");
    }
    await Promise.all(
      filters.flatMap((filter) =>
        (this.#messageHandlers[filter] ?? []).map((handler) =>
          handler({
            message,
            chat: message.chat,
            ...(message.from !== undefined ? { from: message.from } : {}),
          }),
        ),
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
        kind: "inbound",
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
        kind: "inbound",
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
        kind: "inbound",
      },
    });
    await adapter.stop();
  });

  it("downloads a Telegram photo as an inbound image attachment", async () => {
    const bot = new FakeTelegramBot();
    const downloadFile = vi.fn(async () => ({
      localPath: "/tmp/codex-im-telegram/photo.jpg",
      sizeBytes: 4,
    }));
    const adapter = new TelegramChannelAdapter({ bot, downloadFile });
    const seen = vi.fn();
    adapter.onMessage(seen);
    await adapter.start();

    await bot.injectUpdate({
      message: {
        message_id: 44,
        chat: { id: 123456789, type: "private" },
        from: { id: 123456789, username: "ada_dev" },
        caption: "what is this screenshot?",
        photo: [
          { file_id: "small-photo", width: 64, height: 64, file_size: 512 },
          { file_id: "large-photo", width: 1024, height: 768, file_size: 4096 },
        ],
        date: 1710000180,
      },
    });

    expect(downloadFile).toHaveBeenCalledWith({
      fileId: "large-photo",
      filename: "telegram-photo-44.jpg",
      contentType: "image/jpeg",
      kind: "image",
      messageId: "44",
    });
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "what is this screenshot?",
        attachments: [
          {
            kind: "image",
            filename: "telegram-photo-44.jpg",
            contentType: "image/jpeg",
            localPath: "/tmp/codex-im-telegram/photo.jpg",
            sizeBytes: 4,
          },
        ],
      }),
    );
    await adapter.stop();
  });

  it("downloads a Telegram document as an inbound file attachment", async () => {
    const bot = new FakeTelegramBot();
    const downloadFile = vi.fn(async () => ({
      localPath: "/tmp/codex-im-telegram/diff.patch",
      sizeBytes: 18,
    }));
    const adapter = new TelegramChannelAdapter({ bot, downloadFile });
    const seen = vi.fn();
    adapter.onMessage(seen);
    await adapter.start();

    await bot.injectUpdate({
      message: {
        message_id: 45,
        chat: { id: 123456789, type: "private" },
        from: { id: 123456789, username: "ada_dev" },
        caption: "review this diff",
        document: {
          file_id: "doc-file",
          file_name: "codex diff.patch",
          mime_type: "text/x-patch",
          file_size: 18,
        },
        date: 1710000190,
      },
    });

    expect(downloadFile).toHaveBeenCalledWith({
      fileId: "doc-file",
      filename: "codex diff.patch",
      contentType: "text/x-patch",
      kind: "file",
      messageId: "45",
    });
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "review this diff",
        attachments: [
          {
            kind: "file",
            filename: "codex diff.patch",
            contentType: "text/x-patch",
            localPath: "/tmp/codex-im-telegram/diff.patch",
            sizeBytes: 18,
          },
        ],
      }),
    );
    await adapter.stop();
  });

  it("uses Telegram getFile plus file API fetch when no custom downloader is injected", async () => {
    const attachmentDir = await mkdtemp(join(tmpdir(), "codex-im-telegram-test-"));
    const bot = new FakeTelegramBot();
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      },
    }));
    try {
      const adapter = new TelegramChannelAdapter({
        bot,
        botToken: "unit-test-token",
        attachmentDir,
        fetch,
      });
      const seen = vi.fn();
      adapter.onMessage(seen);
      await adapter.start();

      await bot.injectUpdate({
        message: {
          message_id: 46,
          chat: { id: 123456789, type: "private" },
          from: { id: 123456789, username: "ada_dev" },
          document: {
            file_id: "doc-file",
            file_name: "notes.txt",
            mime_type: "text/plain",
          },
          date: 1710000200,
        },
      });

      const attachment = (
        seen.mock.calls[0]?.[0] as {
          readonly attachments?: readonly [{ readonly localPath: string }];
        }
      ).attachments?.[0];
      expect(fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/file/botunit-test-token/documents/file.txt",
      );
      expect(attachment?.localPath.startsWith(attachmentDir)).toBe(true);
      await expect(readFile(attachment?.localPath ?? "")).resolves.toEqual(Buffer.from([1, 2, 3]));
      await adapter.stop();
    } finally {
      await rm(attachmentDir, { recursive: true, force: true });
    }
  });

  it("drops inbound messages after pauseInbound or stop", async () => {
    const bot = new FakeTelegramBot();
    const adapter = new TelegramChannelAdapter({ bot });
    const seen = vi.fn();
    adapter.onMessage(seen);

    await bot.injectUpdate(loadFixture("private-message.json"));
    expect(seen).not.toHaveBeenCalled();

    await adapter.start();
    await adapter.pauseInbound();
    await bot.injectUpdate(loadFixture("private-message.json"));
    expect(seen).not.toHaveBeenCalled();

    await adapter.stop();
    await bot.injectUpdate(loadFixture("private-message.json"));
    expect(seen).not.toHaveBeenCalled();
  });
});

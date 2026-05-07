import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TelegramChannelAdapter } from "../src/index.js";
import type { TelegramBotLike, TelegramMessageHandlerLike } from "../src/index.js";

const SRC_DIR = "packages/im-telegram/src";

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("TelegramChannelAdapter lifecycle (T21)", () => {
  it("starts grammY long-poll once and stops once", async () => {
    const bot = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
    };
    const createBot = vi.fn(() => bot);
    const adapter = new TelegramChannelAdapter({
      botToken: "unit-test-bot-token",
      createBot,
    });

    await adapter.start();
    await adapter.start();
    await adapter.stop();
    await adapter.stop();

    expect(createBot).toHaveBeenCalledTimes(1);
    expect(createBot).toHaveBeenCalledWith("unit-test-bot-token");
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("does not require a bot token when a fake bot is injected directly", async () => {
    const bot = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
    };
    const adapter = new TelegramChannelAdapter({ bot });

    await adapter.start();
    await adapter.stop();

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("opens inbound handling without waiting for a long-polling start promise to settle", async () => {
    const handlers: TelegramMessageHandlerLike[] = [];
    const bot: TelegramBotLike = {
      start: vi.fn(() => new Promise<void>(() => undefined)),
      stop: vi.fn(() => undefined),
      on: vi.fn((filter, handler) => {
        if (filter === "message:text") {
          handlers.push(handler as TelegramMessageHandlerLike);
        }
      }),
    };
    const adapter = new TelegramChannelAdapter({ bot });
    const seen = vi.fn();

    adapter.onMessage(seen);
    await adapter.start();
    await handlers[0]?.({
      message: {
        message_id: 7,
        date: 1_710_000_000,
        chat: { id: 123 },
        from: { id: 456, username: "operator" },
        text: "/use codex-im",
      },
      chat: { id: 123 },
      from: { id: 456, username: "operator" },
    });
    await adapter.stop();

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { platform: "telegram", chatId: "123" },
        sender: { userId: "456", displayName: "operator" },
        text: "/use codex-im",
      }),
    );
  });

  it("fails closed before startup when neither bot nor token is configured", async () => {
    const adapter = new TelegramChannelAdapter();

    await expect(adapter.start()).rejects.toThrow(/botToken/);
  });

  it("does not introduce webhook or public listener code", () => {
    const source = listTsFiles(SRC_DIR)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/\bcreateServer\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Server\s*\(/);
    expect(source).not.toMatch(/\.listen\s*\(/);
    expect(source).not.toMatch(/\bwebhookCallback\b/);
    expect(source).not.toMatch(/\bstartWebhook\b/);
  });
});

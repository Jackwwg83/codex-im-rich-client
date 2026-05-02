import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TelegramChannelAdapter } from "../src/index.js";

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
      botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      createBot,
    });

    await adapter.start();
    await adapter.start();
    await adapter.stop();
    await adapter.stop();

    expect(createBot).toHaveBeenCalledTimes(1);
    expect(createBot).toHaveBeenCalledWith("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi");
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

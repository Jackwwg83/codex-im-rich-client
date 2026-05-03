import { TelegramFakeSmokeBot } from "@codex-im/im-telegram";
import { describe, expect, it, vi } from "vitest";
import {
  type TelegramLiveRoundtripRunner,
  parseTelegramRoundtripTimeoutMs,
  runTelegramLiveRoundtripSmokeCore,
  runTelegramLiveRoundtripWithDaemon,
} from "../src/smoke-telegram-live-roundtrip.js";

const TOKEN = ["1234567890", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd"].join(":");

describe("smoke:telegram-live-roundtrip", () => {
  it("refuses to run without TELEGRAM_LIVE_ROUNDTRIP=1", async () => {
    const stderr: string[] = [];
    const runLiveRoundtrip = vi.fn<TelegramLiveRoundtripRunner>(async () => {
      throw new Error("should not run");
    });

    const result = await runTelegramLiveRoundtripSmokeCore({
      env: { IM_TELEGRAM_BOT_TOKEN: TOKEN },
      errorOutput: (line) => stderr.push(line),
      runLiveRoundtrip,
    });

    expect(result).toEqual({ ok: false, reason: "missing-live-roundtrip-flag" });
    expect(runLiveRoundtrip).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("TELEGRAM_LIVE_ROUNDTRIP=1");
    expect(stderr.join("\n")).not.toContain(TOKEN);
  });

  it("refuses to run without a bot token after the live roundtrip gate is explicit", async () => {
    const stderr: string[] = [];

    const result = await runTelegramLiveRoundtripSmokeCore({
      env: { TELEGRAM_LIVE_ROUNDTRIP: "1" },
      errorOutput: (line) => stderr.push(line),
    });

    expect(result).toEqual({ ok: false, reason: "missing-token" });
    expect(stderr.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
  });

  it("runs the injected live roundtrip only when gate and token are present", async () => {
    const stdout: string[] = [];
    const runLiveRoundtrip = vi.fn<TelegramLiveRoundtripRunner>(async (input) => {
      expect(input.botToken).toBe(TOKEN);
      expect(input.nonce).toBe("abc123");
      expect(input.promptText).toBe("codex-im-live-roundtrip abc123");
      expect(input.finalText).toBe("Codex IM Telegram live roundtrip OK abc123");
      return {
        ok: true,
        nonce: input.nonce,
        promptText: input.promptText,
        finalText: input.finalText,
        observedChatId: "-1001",
        observedUserId: "42",
        turnStarts: 1,
        sentMessages: 1,
        finalEdits: 1,
      };
    });

    const result = await runTelegramLiveRoundtripSmokeCore({
      env: {
        TELEGRAM_LIVE_ROUNDTRIP: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_ROUNDTRIP_NONCE: "abc123",
        TELEGRAM_ROUNDTRIP_TIMEOUT_MS: "1000",
      },
      output: (line) => stdout.push(line),
      runLiveRoundtrip,
    });

    expect(result).toMatchObject({ ok: true, observedChatId: "-1001", observedUserId: "42" });
    expect(runLiveRoundtrip).toHaveBeenCalledTimes(1);
    expect(stdout.join("\n")).toContain("smoke:telegram-live-roundtrip ok");
    expect(stdout.join("\n")).not.toContain(TOKEN);
  });

  it("redacts token-shaped material from live roundtrip failures", async () => {
    const stderr: string[] = [];

    const result = await runTelegramLiveRoundtripSmokeCore({
      env: {
        TELEGRAM_LIVE_ROUNDTRIP: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runLiveRoundtrip: async () => {
        throw new Error(`Telegram rejected token ${TOKEN}`);
      },
    });

    expect(result).toEqual({ ok: false, reason: "live-roundtrip-failed" });
    expect(stderr.join("\n")).toContain("<redacted:telegram-token>");
    expect(stderr.join("\n")).not.toContain(TOKEN);
  });

  it("bounds live roundtrip timeout parsing", () => {
    expect(parseTelegramRoundtripTimeoutMs(undefined)).toBe(120_000);
    expect(parseTelegramRoundtripTimeoutMs("1000")).toBe(1000);
    expect(parseTelegramRoundtripTimeoutMs("600000")).toBe(600_000);
    expect(() => parseTelegramRoundtripTimeoutMs("999")).toThrow(/timeout/i);
    expect(() => parseTelegramRoundtripTimeoutMs("600001")).toThrow(/timeout/i);
    expect(() => parseTelegramRoundtripTimeoutMs("1.5")).toThrow(/timeout/i);
  });

  it("drives daemon prompt output from a real-adapter-shaped inbound message", async () => {
    const bot = new TelegramFakeSmokeBot();
    const stdout: string[] = [];
    const promise = runTelegramLiveRoundtripWithDaemon({
      botToken: TOKEN,
      nonce: "abc123",
      promptText: "codex-im-live-roundtrip abc123",
      finalText: "Codex IM Telegram live roundtrip OK abc123",
      timeoutMs: 1000,
      migrationsDir: "packages/storage-sqlite/src/migrations",
      output: (line) => stdout.push(line),
      sleep: () => new Promise((resolve) => setImmediate(resolve)),
      createBot: () => bot,
    });

    await waitFor(() => bot.started && stdout.some((line) => line.includes("abc123")));
    await bot.injectTextMessage({
      target: { platform: "telegram", chatId: "-1001" },
      sender: { userId: "42", displayName: "operator" },
      text: "codex-im-live-roundtrip abc123",
      messageId: 1,
      receivedAt: new Date("2026-05-03T15:00:00.000Z"),
    });

    await expect(promise).resolves.toMatchObject({
      ok: true,
      observedChatId: "-1001",
      observedUserId: "42",
      turnStarts: 1,
      sentMessages: 1,
      finalEdits: 1,
    });
    expect(bot.sentMessages.map((message) => message.text)).toContain("Codex is working...");
    expect(bot.editedMessages.map((message) => message.text)).toContain(
      "Codex IM Telegram live roundtrip OK abc123",
    );
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out waiting for live roundtrip test setup");
}

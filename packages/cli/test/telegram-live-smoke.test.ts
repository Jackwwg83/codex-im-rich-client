import { describe, expect, it, vi } from "vitest";
import {
  type TelegramLiveRunner,
  parseTelegramLiveDurationMs,
  runTelegramLiveSmokeCore,
} from "../src/smoke-telegram-live.js";

const TOKEN = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";

describe("smoke:telegram-live (T35)", () => {
  it("refuses to run without TELEGRAM_LIVE=1", async () => {
    const stderr: string[] = [];
    const runLive = vi.fn<TelegramLiveRunner>(async () => ({ started: true, stopped: true }));

    const result = await runTelegramLiveSmokeCore({
      env: { IM_TELEGRAM_BOT_TOKEN: TOKEN },
      errorOutput: (line) => stderr.push(line),
      runLive,
    });

    expect(result).toEqual({ ok: false, reason: "missing-live-flag" });
    expect(runLive).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("TELEGRAM_LIVE=1");
    expect(stderr.join("\n")).not.toContain(TOKEN);
    expect(stderr.join("\n")).not.toContain("1234567890:");
  });

  it("refuses to run without a bot token after the live flag is explicit", async () => {
    const stderr: string[] = [];
    const runLive = vi.fn<TelegramLiveRunner>(async () => ({ started: true, stopped: true }));

    const result = await runTelegramLiveSmokeCore({
      env: { TELEGRAM_LIVE: "1" },
      errorOutput: (line) => stderr.push(line),
      runLive,
    });

    expect(result).toEqual({ ok: false, reason: "missing-token" });
    expect(runLive).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
  });

  it("refuses file mode without an explicit target chat id", async () => {
    const stderr: string[] = [];
    const runLive = vi.fn<TelegramLiveRunner>(async () => ({ started: true, stopped: true }));

    const result = await runTelegramLiveSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        TELEGRAM_LIVE_FILE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runLive,
    });

    expect(result).toEqual({ ok: false, reason: "missing-target" });
    expect(runLive).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("TELEGRAM_LIVE_TARGET_CHAT_ID");
    expect(stderr.join("\n")).not.toContain(TOKEN);
  });

  it("redacts token-shaped material from live runner failures", async () => {
    const stderr: string[] = [];

    const result = await runTelegramLiveSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runLive: async () => {
        throw new Error(`Telegram rejected token ${TOKEN}`);
      },
    });

    expect(result).toEqual({ ok: false, reason: "live-failed" });
    expect(stderr.join("\n")).toContain("<redacted:telegram-token>");
    expect(stderr.join("\n")).not.toContain(TOKEN);
    expect(stderr.join("\n")).not.toContain("1234567890:");
  });

  it("runs the injected live runner only when the gate and token are present", async () => {
    const stdout: string[] = [];
    const runLive = vi.fn<TelegramLiveRunner>(async (input) => {
      expect(input.botToken).toBe(TOKEN);
      expect(input.durationMs).toBe(25);
      await input.sleep(0);
      return { started: true, stopped: true };
    });

    const result = await runTelegramLiveSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_LIVE_DURATION_MS: "25",
      },
      output: (line) => stdout.push(line),
      runLive,
    });

    expect(result).toEqual({ ok: true, durationMs: 25, started: true, stopped: true });
    expect(runLive).toHaveBeenCalledTimes(1);
    expect(stdout.join("\n")).toContain("smoke:telegram-live ok");
    expect(stdout.join("\n")).not.toContain(TOKEN);
  });

  it("passes explicit file mode target to the injected live runner", async () => {
    const runLive = vi.fn<TelegramLiveRunner>(async (input) => {
      expect(input.fileTargetChatId).toBe("12345");
      return { started: true, stopped: true, fileSent: true };
    });

    const result = await runTelegramLiveSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        TELEGRAM_LIVE_FILE: "1",
        TELEGRAM_LIVE_TARGET_CHAT_ID: "12345",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      runLive,
    });

    expect(result).toEqual({
      ok: true,
      durationMs: 5000,
      started: true,
      stopped: true,
      fileSent: true,
    });
    expect(runLive).toHaveBeenCalledTimes(1);
  });

  it("passes explicit inbound attachment gate to the injected live runner", async () => {
    const stdout: string[] = [];
    const runLive = vi.fn<TelegramLiveRunner>(async (input) => {
      expect(input.inboundAttachmentKind).toBe("image");
      return {
        started: true,
        stopped: true,
        inboundAttachmentReceived: true,
        inboundAttachmentKind: "image",
      };
    });

    const result = await runTelegramLiveSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        TELEGRAM_LIVE_INBOUND_ATTACHMENT: "1",
        TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND: "image",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      output: (line) => stdout.push(line),
      runLive,
    });

    expect(result).toEqual({
      ok: true,
      durationMs: 5000,
      started: true,
      stopped: true,
      inboundAttachmentReceived: true,
      inboundAttachmentKind: "image",
    });
    expect(runLive).toHaveBeenCalledTimes(1);
    expect(stdout.join("\n")).toContain("smoke:telegram-live ok");
    expect(stdout.join("\n")).not.toContain(TOKEN);
  });

  it("bounds live smoke duration parsing", () => {
    expect(parseTelegramLiveDurationMs(undefined)).toBe(5000);
    expect(parseTelegramLiveDurationMs("0")).toBe(0);
    expect(parseTelegramLiveDurationMs("60000")).toBe(60000);
    expect(() => parseTelegramLiveDurationMs("-1")).toThrow(/duration/i);
    expect(() => parseTelegramLiveDurationMs("60001")).toThrow(/duration/i);
    expect(() => parseTelegramLiveDurationMs("1.5")).toThrow(/duration/i);
  });
});

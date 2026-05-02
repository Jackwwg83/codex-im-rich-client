import { describe, expect, it, vi } from "vitest";
import { type TelegramRealRunner, runTelegramRealSmokeCore } from "../src/smoke-telegram-real.js";

const TOKEN = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";

describe("smoke:telegram-real (T36)", () => {
  it("refuses to run without TELEGRAM_LIVE=1", async () => {
    const stderr: string[] = [];
    const runReal = vi.fn<TelegramRealRunner>(async () => ({
      codexCompleted: true,
      telegramStarted: true,
      telegramStopped: true,
    }));

    const result = await runTelegramRealSmokeCore({
      env: {
        CODEX_REAL_SMOKE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runReal,
    });

    expect(result).toEqual({ ok: false, reason: "missing-live-flag" });
    expect(runReal).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("TELEGRAM_LIVE=1");
    expect(stderr.join("\n")).not.toContain(TOKEN);
  });

  it("refuses to run without CODEX_REAL_SMOKE=1", async () => {
    const stderr: string[] = [];
    const runReal = vi.fn<TelegramRealRunner>(async () => ({
      codexCompleted: true,
      telegramStarted: true,
      telegramStopped: true,
    }));

    const result = await runTelegramRealSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runReal,
    });

    expect(result).toEqual({ ok: false, reason: "missing-codex-real-flag" });
    expect(runReal).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("CODEX_REAL_SMOKE=1");
    expect(stderr.join("\n")).not.toContain(TOKEN);
  });

  it("refuses to run without a bot token after both real flags are explicit", async () => {
    const stderr: string[] = [];
    const runReal = vi.fn<TelegramRealRunner>(async () => ({
      codexCompleted: true,
      telegramStarted: true,
      telegramStopped: true,
    }));

    const result = await runTelegramRealSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        CODEX_REAL_SMOKE: "1",
      },
      errorOutput: (line) => stderr.push(line),
      runReal,
    });

    expect(result).toEqual({ ok: false, reason: "missing-token" });
    expect(runReal).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
  });

  it("redacts token-shaped material from real runner failures", async () => {
    const stderr: string[] = [];

    const result = await runTelegramRealSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        CODEX_REAL_SMOKE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
      },
      errorOutput: (line) => stderr.push(line),
      runReal: async () => {
        throw new Error(`combined smoke saw ${TOKEN}`);
      },
    });

    expect(result).toEqual({ ok: false, reason: "real-failed" });
    expect(stderr.join("\n")).toContain("<redacted:telegram-token>");
    expect(stderr.join("\n")).not.toContain(TOKEN);
    expect(stderr.join("\n")).not.toContain("1234567890:");
  });

  it("runs the injected real runner only when both gates and token are present", async () => {
    const stdout: string[] = [];
    const runReal = vi.fn<TelegramRealRunner>(async (input) => {
      expect(input.botToken).toBe(TOKEN);
      expect(input.telegramDurationMs).toBe(10);
      expect(input.codexPrompt).toBe("Reply exactly: OK");
      await input.sleep(0);
      input.output(`runner output ${TOKEN}`);
      return {
        codexCompleted: true,
        telegramStarted: true,
        telegramStopped: true,
      };
    });

    const result = await runTelegramRealSmokeCore({
      env: {
        TELEGRAM_LIVE: "1",
        CODEX_REAL_SMOKE: "1",
        IM_TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_LIVE_DURATION_MS: "10",
      },
      output: (line) => stdout.push(line),
      runReal,
    });

    expect(result).toEqual({
      ok: true,
      codexCompleted: true,
      telegramDurationMs: 10,
      telegramStarted: true,
      telegramStopped: true,
    });
    expect(runReal).toHaveBeenCalledTimes(1);
    expect(stdout.join("\n")).toContain("smoke:telegram-real ok");
    expect(stdout.join("\n")).toContain("<redacted:telegram-token>");
    expect(stdout.join("\n")).not.toContain(TOKEN);
  });
});

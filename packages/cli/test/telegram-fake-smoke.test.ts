import { describe, expect, it } from "vitest";
import { runTelegramFakeSmokeCore } from "../src/smoke-telegram-fake.js";

describe("smoke:telegram-fake (T34)", () => {
  it("runs a CI-safe Telegram-to-daemon prompt flow without live env flags", async () => {
    const stdout: string[] = [];
    const result = await runTelegramFakeSmokeCore({
      env: {},
      now: () => new Date("2026-05-02T19:10:00.000Z"),
      output: (line) => stdout.push(line),
    });

    expect(result).toEqual({
      ok: true,
      botStarted: true,
      botStopped: true,
      threadStarts: 1,
      turnStarts: 1,
      turnSteers: 0,
      boundThreadId: "thread-fake-1",
      activeTurnId: "turn-fake-1",
    });
    expect(stdout.join("\n")).toContain("smoke:telegram-fake ok");
    expect(stdout.join("\n")).toContain("threadStarts=1");
    expect(stdout.join("\n")).toContain("turnStarts=1");
  });

  it("does not require or print real Telegram/Codex smoke environment", async () => {
    const stdout: string[] = [];
    await runTelegramFakeSmokeCore({
      env: {
        CODEX_REAL_SMOKE: undefined,
        IM_TELEGRAM_BOT_TOKEN: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
        TELEGRAM_LIVE: undefined,
      },
      output: (line) => stdout.push(line),
    });

    const serialized = stdout.join("\n");
    expect(serialized).not.toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(serialized).not.toContain("1234567890:");
    expect(serialized).not.toContain("TELEGRAM_LIVE=1");
    expect(serialized).not.toContain("CODEX_REAL_SMOKE=1");
  });
});

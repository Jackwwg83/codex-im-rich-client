import { describe, expect, it } from "vitest";
import { runDaemonRoundtripSmokeCore } from "../src/smoke-daemon-roundtrip.js";

describe("smoke:daemon-roundtrip", () => {
  it("runs a CI-safe daemon control and approval round-trip without live services", async () => {
    const stdout: string[] = [];
    const result = await runDaemonRoundtripSmokeCore({
      env: {},
      output: (line) => stdout.push(line),
    });

    expect(result).toMatchObject({
      ok: true,
      botStarted: true,
      threadStarts: 1,
      threadForks: 1,
      threadResumes: 1,
      turnStarts: 1,
      turnInterrupts: 1,
      approvalCards: 1,
      callbackResolves: 1,
      callbackAnswers: 1,
      knownThreads: 2,
    });
    expect(stdout.join("\n")).toContain("smoke:daemon-roundtrip ok");
  });

  it("does not require or print live Telegram or real Codex environment", async () => {
    const stdout: string[] = [];
    await runDaemonRoundtripSmokeCore({
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

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDaemonLogger, planDaemonLogger } from "../src/index.js";

describe("daemon log rotation (T31)", () => {
  it("plans pino-roll daily rotation for production daemon logs", () => {
    const plan = planDaemonLogger({
      env: { NODE_ENV: "production" },
      home: "/Users/operator",
    });

    expect(plan).toEqual({
      mode: "rotating-file",
      loggerOptions: {
        level: "info",
        name: "codex-im-daemon",
      },
      transport: {
        target: "pino-roll",
        options: {
          file: join("/Users/operator", ".codex-im-bridge", "logs", "daemon.log"),
          frequency: "daily",
          mkdir: true,
          limit: { count: 14 },
        },
      },
    });
  });

  it("does not start a pino-roll transport in test or explicit disabled mode", () => {
    expect(planDaemonLogger({ env: { NODE_ENV: "test" }, home: "/Users/operator" })).toEqual({
      mode: "stdout",
      loggerOptions: {
        level: "silent",
        name: "codex-im-daemon",
      },
    });
    expect(
      planDaemonLogger({
        env: { CODEX_IM_LOG_ROTATION: "0", NODE_ENV: "production" },
        home: "/Users/operator",
      }),
    ).toEqual({
      mode: "stdout",
      loggerOptions: {
        level: "info",
        name: "codex-im-daemon",
      },
    });
  });

  it("uses injected factories so tests never create real log files", () => {
    const transport = { kind: "transport" };
    const logger = { kind: "logger" };
    const transportFactory = vi.fn(() => transport);
    const pinoFactory = vi.fn(() => logger);

    expect(
      createDaemonLogger({
        env: { NODE_ENV: "production" },
        home: "/Users/operator",
        pinoFactory,
        transportFactory,
      }),
    ).toBe(logger);

    expect(transportFactory).toHaveBeenCalledWith({
      target: "pino-roll",
      options: {
        file: join("/Users/operator", ".codex-im-bridge", "logs", "daemon.log"),
        frequency: "daily",
        mkdir: true,
        limit: { count: 14 },
      },
    });
    expect(pinoFactory).toHaveBeenCalledWith(
      {
        level: "info",
        name: "codex-im-daemon",
      },
      transport,
    );
  });

  it("keeps test/dev mode on stdout without invoking the transport factory", () => {
    const logger = { kind: "logger" };
    const transportFactory = vi.fn(() => ({ kind: "transport" }));
    const pinoFactory = vi.fn(() => logger);

    expect(
      createDaemonLogger({
        env: { NODE_ENV: "test" },
        home: "/Users/operator",
        pinoFactory,
        transportFactory,
      }),
    ).toBe(logger);

    expect(transportFactory).not.toHaveBeenCalled();
    expect(pinoFactory).toHaveBeenCalledWith({
      level: "silent",
      name: "codex-im-daemon",
    });
  });

  it("does not include token-shaped or secret-bearing values in the plan", () => {
    const plan = planDaemonLogger({
      env: {
        IM_TELEGRAM_BOT_TOKEN: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
        NODE_ENV: "production",
      },
      home: "/Users/operator",
    });
    const serialized = JSON.stringify(plan);

    expect(serialized).not.toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(serialized).not.toContain("bot_token");
    expect(serialized).not.toContain("1234567890:");
  });
});

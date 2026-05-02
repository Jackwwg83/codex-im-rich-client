import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  defaultDaemonStatusPath,
  formatDaemonStatus,
  parseDaemonStatusArgs,
  runDaemonStatusCore,
} from "../src/daemon-status.js";

describe("codex-im daemon status (T32)", () => {
  it("formats a redacted local daemon status snapshot", () => {
    const output = formatDaemonStatus(
      {
        pid: 4242,
        startedAt: "2026-05-02T17:00:00.000Z",
        currentCodexThreadCount: 3,
        pendingApprovalCount: 2,
        lastCodexSpawnAt: "2026-05-02T17:55:00.000Z",
        supervisorFailureCount: 4,
        lastFatal: {
          at: "2026-05-02T17:59:00.000Z",
          message:
            "spawn failed with IM_TELEGRAM_BOT_TOKEN=1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
        },
      },
      new Date("2026-05-02T18:01:01.000Z"),
    );

    expect(output).toContain("pid: 4242");
    expect(output).toContain("uptime: 1h 1m 1s");
    expect(output).toContain("codex_threads: 3");
    expect(output).toContain("pending_approvals: 2");
    expect(output).toContain("last_codex_spawn: 2026-05-02T17:55:00.000Z");
    expect(output).toContain("supervisor_failures: 4");
    expect(output).toContain("last_fatal: 2026-05-02T17:59:00.000Z spawn failed with");
    expect(output).toContain("IM_TELEGRAM_BOT_TOKEN=<redacted>");
    expect(output).not.toContain("1234567890:");
  });

  it("reads the default status file from the operator home directory", () => {
    expect(defaultDaemonStatusPath({ HOME: "/Users/operator" })).toBe(
      join("/Users/operator", ".codex-im-bridge", "daemon-status.json"),
    );
  });

  it("supports an explicit --status-file test hook", () => {
    expect(parseDaemonStatusArgs(["--status-file", "/tmp/status.json"])).toEqual({
      statusPath: "/tmp/status.json",
    });
    expect(() => parseDaemonStatusArgs(["--bogus"])).toThrow(/unknown flag.*--bogus/);
    expect(() => parseDaemonStatusArgs(["--status-file"])).toThrow(/--status-file.*value/i);
  });

  it("prints a status report from a local snapshot without leaking token material", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readFile = vi.fn(() =>
      JSON.stringify({
        pid: 5151,
        startedAt: "2026-05-02T18:00:00.000Z",
        currentCodexThreadCount: 1,
        pendingApprovalCount: 0,
        lastCodexSpawnAt: null,
        supervisorFailureCount: 0,
        lastFatal: {
          at: "2026-05-02T18:00:05.000Z",
          message: "telegram token 9999999999:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
        },
      }),
    );

    const exitCode = runDaemonStatusCore({
      argv: ["--status-file", "/tmp/status.json"],
      env: { HOME: "/Users/operator" },
      now: new Date("2026-05-02T18:00:30.000Z"),
      readFile,
      output: (line) => stdout.push(line),
      errorOutput: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(0);
    expect(readFile).toHaveBeenCalledWith("/tmp/status.json", "utf8");
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("pid: 5151");
    expect(stdout.join("\n")).toContain("last_codex_spawn: none");
    expect(stdout.join("\n")).toContain("<redacted:telegram-token>");
    expect(stdout.join("\n")).not.toContain("9999999999:");
  });

  it("fails closed when the daemon has not written a status snapshot", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    const exitCode = runDaemonStatusCore({
      argv: ["--status-file", "/tmp/missing-status.json"],
      env: { HOME: "/Users/operator" },
      readFile: () => {
        throw error;
      },
      output: (line) => stdout.push(line),
      errorOutput: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("daemon status unavailable");
    expect(stderr.join("\n")).toContain("/tmp/missing-status.json");
    expect(stderr.join("\n")).toContain("not running or has not written a status snapshot");
  });
});

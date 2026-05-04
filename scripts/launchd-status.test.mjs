import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { planLaunchdStatus, runLaunchdStatus } from "../bin/launchd-status.mjs";

describe("launchd-status", () => {
  it("plans the current-user launchd target and local status paths", () => {
    const plan = planLaunchdStatus({ home: "/Users/operator", uid: "501" });

    expect(plan.serviceTarget).toBe("gui/501/io.codex-im-bridge");
    expect(plan.plistPath).toBe(
      join("/Users/operator", "Library", "LaunchAgents", "io.codex-im-bridge.plist"),
    );
    expect(plan.statusPath).toBe(join("/Users/operator", ".codex-im-bridge", "daemon-status.json"));
  });

  it("prints loaded launchd and daemon status evidence without secret material", async () => {
    const stdout = [];
    const exitCode = await runLaunchdStatus({
      home: "/Users/operator",
      uid: "501",
      exists: (path) => path.endsWith(".plist") || path.endsWith("daemon-status.json"),
      readFile: () =>
        JSON.stringify({
          pid: 4242,
          startedAt: "2026-05-03T15:00:00.000Z",
          currentCodexThreadCount: 2,
          pendingApprovalCount: 1,
        }),
      pidAlive: (pid) => pid === 4242,
      launchctl: vi.fn(async () => ({
        exitCode: 0,
        stdout: "state = running\n",
        stderr: "",
      })),
      output: (line) => stdout.push(line),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("launchd target: gui/501/io.codex-im-bridge");
    expect(stdout.join("\n")).toContain("plist: present");
    expect(stdout.join("\n")).toContain("launchctl: loaded exit=0");
    expect(stdout.join("\n")).toContain("daemon status: present pid=4242");
    expect(stdout.join("\n")).not.toContain("1234567890:");
  });

  it("marks a stale daemon status snapshot when the pid is no longer alive", async () => {
    const stdout = [];
    const exitCode = await runLaunchdStatus({
      home: "/Users/operator",
      uid: "501",
      exists: (path) => path.endsWith("daemon-status.json"),
      readFile: () =>
        JSON.stringify({
          pid: 9999,
          startedAt: "2026-05-03T15:00:00.000Z",
          currentCodexThreadCount: 0,
          pendingApprovalCount: 0,
        }),
      pidAlive: () => false,
      launchctl: vi.fn(async () => ({
        exitCode: 113,
        stdout: "",
        stderr: "",
      })),
      output: (line) => stdout.push(line),
    });

    expect(exitCode).toBe(2);
    expect(stdout.join("\n")).toContain("daemon status: stale pid=9999");
  });

  it("uses launchctl pid evidence when process liveness probing is unavailable", async () => {
    const stdout = [];
    const exitCode = await runLaunchdStatus({
      home: "/Users/operator",
      uid: "501",
      exists: (path) => path.endsWith(".plist") || path.endsWith("daemon-status.json"),
      readFile: () =>
        JSON.stringify({
          pid: 70626,
          startedAt: "2026-05-03T15:50:58.198Z",
          currentCodexThreadCount: 0,
          pendingApprovalCount: 0,
        }),
      pidAlive: () => false,
      launchctl: vi.fn(async () => ({
        exitCode: 0,
        stdout: ["state = running", "pid = 70626", "last exit code = (never exited)"].join("\n"),
        stderr: "",
      })),
      output: (line) => stdout.push(line),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("daemon status: present pid=70626");
  });

  it("reports not-loaded without leaking launchctl stderr token-shaped material", async () => {
    const stdout = [];
    const exitCode = await runLaunchdStatus({
      home: "/Users/operator",
      uid: "501",
      exists: () => false,
      readFile: () => {
        throw new Error("should not read");
      },
      launchctl: vi.fn(async () => ({
        exitCode: 113,
        stdout: "",
        stderr: "token 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd not loaded",
      })),
      output: (line) => stdout.push(line),
    });

    expect(exitCode).toBe(2);
    expect(stdout.join("\n")).toContain("plist: missing");
    expect(stdout.join("\n")).toContain("launchctl: not-loaded exit=113");
    expect(stdout.join("\n")).toContain("<redacted:telegram-token>");
    expect(stdout.join("\n")).not.toContain("1234567890:");
  });
});

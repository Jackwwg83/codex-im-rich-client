import { describe, expect, it, vi } from "vitest";
import {
  buildLocalInstallPlan,
  buildLocalStatusPlan,
  buildLocalUninstallPlan,
  runLocalCommandPlan,
} from "./local-lifecycle.mts";

describe("local lifecycle command wrappers", () => {
  it("plans a safe first-use install sequence for one IM platform", () => {
    const plan = buildLocalInstallPlan({
      platform: "telegram",
      configPath: "/Users/operator/.codex-im-bridge/config.toml",
    });

    expect(plan.title).toBe("codex-im local install");
    expect(plan.commands.map((command) => [command.label, command.command, command.args])).toEqual([
      ["node-version", "node", ["--version"]],
      ["pnpm-version", "pnpm", ["--version"]],
      ["codex-version", "pnpm", ["check:codex-version"]],
      [
        "setup-im",
        "pnpm",
        [
          "setup:im",
          "--platform",
          "telegram",
          "--config",
          "/Users/operator/.codex-im-bridge/config.toml",
          "--no-doctor",
        ],
      ],
      [
        "im-doctor",
        "pnpm",
        ["im:doctor", "--config", "/Users/operator/.codex-im-bridge/config.toml"],
      ],
      ["bridge-build", "pnpm", ["bridge:build"]],
      ["bridge-install", "pnpm", ["bridge:install"]],
      ["launchd-install", "pnpm", ["launchd:install"]],
      ["launchd-status", "pnpm", ["launchd:status"]],
    ]);
    expect(plan.completionLines.join("\n")).toContain("/use codex-im");
    expect(plan.completionLines.join("\n")).toContain("Reply exactly: OK");
    expect(plan.completionLines.join("\n")).toContain("Computer Use is disabled unless enabled");
  });

  it("can plan config-only setup without Keychain or launchd side effects", () => {
    const plan = buildLocalInstallPlan({
      platform: "slack",
      noKeychain: true,
      noLaunchd: true,
      skipDoctor: true,
    });

    expect(plan.commands.map((command) => command.label)).toEqual([
      "node-version",
      "pnpm-version",
      "codex-version",
      "setup-im",
      "bridge-build",
      "bridge-install",
    ]);
    expect(plan.commands.find((command) => command.label === "setup-im")?.args).toContain(
      "--no-keychain",
    );
  });

  it("plans status and uninstall wrappers without hiding launchd or doctor", () => {
    expect(buildLocalStatusPlan({}).commands.map((command) => command.label)).toEqual([
      "im-doctor",
      "launchd-status",
    ]);
    expect(buildLocalUninstallPlan({}).commands.map((command) => command.label)).toEqual([
      "launchd-uninstall",
      "bridge-uninstall",
    ]);
    expect(buildLocalUninstallPlan({}).completionLines.join("\n")).toContain(
      "Preserved config, data, logs, and Keychain secrets",
    );
  });

  it("prints dry-run commands without executing them", () => {
    const output: string[] = [];
    const runner = vi.fn(() => ({ status: 0 }));
    const exitCode = runLocalCommandPlan(buildLocalStatusPlan({}), {
      dryRun: true,
      runner,
      output: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(runner).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("dry-run: pnpm im:doctor");
    expect(output.join("\n")).toContain("dry-run complete; no local changes made.");
    expect(output.join("\n")).not.toContain("Status check complete.");
  });

  it("stops at the first failing command", () => {
    const output: string[] = [];
    const runner = vi.fn((command: string, args: readonly string[]) => ({
      status: args.includes("check:codex-version") ? 1 : 0,
    }));
    const exitCode = runLocalCommandPlan(buildLocalInstallPlan({ platform: "telegram" }), {
      runner,
      output: (line) => output.push(line),
    });

    expect(exitCode).toBe(1);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(output.join("\n")).toContain("failed: codex-version exit=1");
  });
});

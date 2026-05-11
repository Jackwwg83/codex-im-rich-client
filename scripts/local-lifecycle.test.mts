import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildInstallPlatformChoiceLines,
  buildLocalInstallPlan,
  buildLocalStatusPlan,
  buildLocalUninstallPlan,
  buildLocalUpgradeApplyDryRunPlan,
  buildLocalUpgradePlan,
  buildUpdateCheckCache,
  clearSensitiveValues,
  detectGitStateFromStatus,
  main,
  parseRemoteTags,
  runLocalCommandPlan,
  shortGitSha,
  writeUpdateCheckCache,
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
    expect(plan.completionLines.join("\n")).toContain("/projects");
    expect(plan.completionLines.join("\n")).toContain("/use 1");
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

  it("offers a platform chooser for the default install path", () => {
    expect(buildInstallPlatformChoiceLines()).toEqual([
      "Choose one platform to configure first:",
      "1. Telegram",
      "2. Feishu/Lark",
      "3. DingTalk",
      "4. Slack",
    ]);
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

  it("keeps upgrade plan local-only and blocks apply on dirty worktrees", () => {
    const plan = buildLocalUpgradePlan({
      homeDir: "/Users/operator",
      repoPath: "/repo/codex-im-rich-client",
      dirtyWorktree: true,
      target: "latest",
      currentGitSha: "abc123",
      currentGitTag: "v0.1.0",
      installedMetadata: {
        schemaVersion: 1,
        packageVersion: "0.1.0-phase7",
        gitSha: "abc123",
        gitTag: "v0.1.0",
        codexVersion: "0.128.0",
        installedAt: "2026-05-09T12:00:00.000Z",
      },
    });

    const rendered = plan.completionLines.join("\n");
    expect(plan.commands).toEqual([]);
    expect(rendered).toContain("mode: plan");
    expect(rendered).toContain("network: not used");
    expect(rendered).toContain("apply: blocked");
    expect(rendered).toContain("dirty worktree");
    expect(rendered).not.toContain("git fetch");
  });

  it("prints an apply dry-run without mutating steps being executable", () => {
    const plan = buildLocalUpgradeApplyDryRunPlan({
      homeDir: "/Users/operator",
      repoPath: "/repo/codex-im-rich-client",
      dirtyWorktree: false,
      target: "v0.1.1",
      currentGitSha: "abc123",
    });

    const rendered = plan.completionLines.join("\n");
    expect(plan.commands).toEqual([]);
    expect(rendered).toContain("mode: apply --dry-run");
    expect(rendered).toContain("would: git fetch --tags");
    expect(rendered).toContain("would: pnpm install --frozen-lockfile");
    expect(rendered).toContain("did not: git fetch");
    expect(rendered).toContain("did not: checkout");
    expect(rendered).toContain("did not: stop launchd");
    expect(rendered).toContain("did not: read/write Keychain");
  });

  it("writes a redacted update-check cache", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "codex-im-upgrade-check-"));
    try {
      const cachePath = writeUpdateCheckCache({
        homeDir,
        cache: {
          schemaVersion: 1,
          checkedAt: "2026-05-09T12:00:00.000Z",
          sourceRemote: "origin",
          currentGitSha: "abc123",
          currentGitTag: "v0.1.0",
          latestGitTag: "v0.1.1",
          latestGitSha: "def456",
          status: "update_available",
          diagnostic: "telegram token tg-secret-value should be redacted",
        },
      });

      expect(cachePath).toBe(join(homeDir, ".codex-im-bridge", "update-check.json"));
      expect(existsSync(cachePath)).toBe(true);
      const written = readFileSync(cachePath, "utf8");
      expect(written).toContain("[REDACTED]");
      expect(written).not.toContain("tg-secret-value");
    } finally {
      rmSync(homeDir, { force: true, recursive: true });
    }
  });

  it("redacts common platform secrets from lifecycle output", () => {
    expect(
      clearSensitiveValues(
        [
          "telegram token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
          "xoxb-1234567890-abcdef",
          "client_secret=ding-secret-value",
          "app_secret=lark-secret-value",
        ].join("\n"),
      ),
    ).toBe(
      [
        "telegram token [REDACTED]",
        "[REDACTED]",
        "client_secret=[REDACTED]",
        "app_secret=[REDACTED]",
      ].join("\n"),
    );
  });

  it("detects dirty worktree state from git status output", () => {
    expect(
      detectGitStateFromStatus({
        statusShort: " M README.md\n?? docs/new.md\n",
        revParseHead: "abc123\n",
        describeTags: "v0.1.0-2-gabc123\n",
      }),
    ).toEqual({
      dirtyWorktree: true,
      currentGitSha: "abc123",
      currentGitTag: "v0.1.0-2-gabc123",
    });
  });

  it("parses latest remote tag from read-only git ls-remote output", () => {
    expect(
      parseRemoteTags(
        [
          "1111111111111111111111111111111111111111\trefs/tags/v0.1.0",
          "2222222222222222222222222222222222222222\trefs/tags/v0.1.10",
          "3333333333333333333333333333333333333333\trefs/tags/v0.1.2",
          "4444444444444444444444444444444444444444\trefs/tags/v0.1.10^{}",
        ].join("\n"),
      ),
    ).toEqual({
      latestGitTag: "v0.1.10",
      latestGitSha: "2222222222222222222222222222222222222222",
    });
  });

  // Regression guard: two distinct commits that share a 7-character prefix
  // must not be treated as the same revision. detectLocalGitState now
  // captures the full 40-char SHA; if anyone reverts that, this test fires.
  it("treats commits with identical 7-char prefix but different full SHA as 'update available'", () => {
    const cache = buildUpdateCheckCache({
      gitState: {
        dirtyWorktree: false,
        currentGitSha: "abc1234deadbeefcafe1111111111111111111111",
        currentGitTag: "v0.1.0-alpha.3",
      },
      remoteTagInfo: {
        latestGitTag: "v0.1.0-alpha.4",
        latestGitSha: "abc1234cafebabe2222222222222222222222222222".slice(0, 40),
      },
    });
    expect(cache.status).toBe("update_available");
    expect(cache.currentGitSha.length).toBeGreaterThanOrEqual(40);
    expect(cache.latestGitSha?.length).toBeGreaterThanOrEqual(40);
  });

  it("recognises an exact full-SHA match as 'current'", () => {
    const sha = "abc1234deadbeefcafe1111111111111111111111";
    const cache = buildUpdateCheckCache({
      gitState: { dirtyWorktree: false, currentGitSha: sha, currentGitTag: "v0.1.0" },
      remoteTagInfo: { latestGitTag: "v0.1.0", latestGitSha: sha },
    });
    expect(cache.status).toBe("current");
  });

  it("truncates SHA only at display time via shortGitSha()", () => {
    expect(shortGitSha("abc1234deadbeefcafe1111111111111111111111")).toBe("abc1234");
    expect(shortGitSha(undefined)).toBe("unknown");
    expect(shortGitSha("")).toBe("unknown");
    expect(shortGitSha("abc")).toBe("abc");
  });

  it("rejects `codex-im:rollback` with an actionable error (rollback is not implemented)", async () => {
    await expect(main(["rollback"])).rejects.toThrow(
      /codex-im:rollback: not yet implemented/,
    );
  });

  it("rejects `codex-im:status --check-updates` and points to the real upgrade check", async () => {
    await expect(main(["status", "--check-updates"])).rejects.toThrow(
      /no-op stub.*pnpm codex-im:upgrade --check/s,
    );
  });

  it("rejects real `codex-im:upgrade --apply` and points at --dry-run only in this alpha", async () => {
    await expect(main(["upgrade", "--apply"])).rejects.toThrow(
      /apply \(planned for a later release/,
    );
  });

  it("rejects `codex-im:upgrade --clear-stale-lock` with a friendly hint", async () => {
    await expect(main(["upgrade", "--clear-stale-lock"])).rejects.toThrow(
      /--clear-stale-lock is not yet implemented/,
    );
  });
});

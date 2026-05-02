import { describe, expect, it, vi } from "vitest";
import {
  assertNoLaunchdSecretMaterial,
  installLaunchd,
  planLaunchdInstall,
} from "../bin/install-launchd.mjs";

const HOME = "/Users/tester";
const USER = "tester";
const NODE_BIN = "/opt/homebrew/bin/node";
const DAEMON_ENTRY = "/Users/tester/.codex-im-bridge/bin/daemon.mjs";
const SECRET_BYTES = "not-a-real-secret-value";

describe("install-launchd (T29)", () => {
  it("renders the launchd plist with deterministic paths and no secret material", async () => {
    const plan = await planLaunchdInstall({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      forbiddenSubstrings: [SECRET_BYTES],
    });

    expect(plan.plistPath).toBe("/Users/tester/Library/LaunchAgents/io.codex-im-bridge.plist");
    expect(plan.launchctlArgs).toEqual(["load", plan.plistPath]);
    expect(plan.renderedPlist).toContain("<string>io.codex-im-bridge</string>");
    expect(plan.renderedPlist).toContain(
      "<string>/Users/tester/.codex-im-bridge/bin/load-and-run.sh</string>",
    );
    expect(plan.renderedPlist).toContain("<key>NODE_BIN</key>");
    expect(plan.renderedPlist).toContain(`<string>${NODE_BIN}</string>`);
    expect(plan.renderedPlist).toContain("<key>DAEMON_ENTRY</key>");
    expect(plan.renderedPlist).toContain(`<string>${DAEMON_ENTRY}</string>`);
    expect(plan.renderedPlist).toContain(
      "<string>/Users/tester/.codex-im-bridge/logs/daemon.log</string>",
    );
    expect(plan.renderedPlist).not.toContain("{{");
    expect(plan.renderedPlist).not.toContain("}}");
    expect(plan.renderedPlist).not.toContain(SECRET_BYTES);
    expect(plan.renderedPlist).not.toMatch(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/);
    expect(plan.renderedPlist.toLowerCase()).not.toContain("bot_token");
  });

  it("dry-run mode does not write files or call launchctl", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);

    const result = await installLaunchd({
      dryRun: true,
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      mkdir,
      writeFile,
      runLaunchctl,
    });

    expect(result.dryRun).toBe(true);
    expect(result.wrotePlist).toBe(false);
    expect(result.loaded).toBe(false);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(runLaunchctl).not.toHaveBeenCalled();
  });

  it("install path writes the plist and calls injectable launchctl without invoking the real system command", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);

    const result = await installLaunchd({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      mkdir,
      writeFile,
      runLaunchctl,
    });

    expect(result.dryRun).toBe(false);
    expect(mkdir).toHaveBeenCalledWith("/Users/tester/Library/LaunchAgents", {
      recursive: true,
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/tester/Library/LaunchAgents/io.codex-im-bridge.plist",
      result.plan.renderedPlist,
      { mode: 0o600 },
    );
    expect(runLaunchctl).toHaveBeenCalledWith([
      "load",
      "/Users/tester/Library/LaunchAgents/io.codex-im-bridge.plist",
    ]);
  });

  it("fails closed if rendered output contains token-shaped or forbidden secret material", () => {
    expect(() =>
      assertNoLaunchdSecretMaterial("plist with 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"),
    ).toThrow(/token-shaped/);
    expect(() =>
      assertNoLaunchdSecretMaterial(`plist with ${SECRET_BYTES}`, [SECRET_BYTES]),
    ).toThrow(/forbidden secret/);
  });
});

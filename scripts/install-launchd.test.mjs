import { describe, expect, it, vi } from "vitest";
import {
  assertNoLaunchdSecretMaterial,
  installLaunchd,
  planLaunchdInstall,
  verifyLaunchdRuntimePaths,
} from "../bin/install-launchd.mjs";

const HOME = "/Users/tester";
const USER = "tester";
const NODE_BIN = "/opt/homebrew/bin/node";
const DAEMON_ENTRY = "/Users/tester/.codex-im-bridge/app/daemon.mjs";
const SECRET_BYTES = "not-a-real-secret-value";

describe("install-launchd (T29)", () => {
  it("renders the launchd plist with deterministic paths and no secret material", async () => {
    const plan = await planLaunchdInstall({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
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
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const stat = vi.fn(async () => ({ isFile: () => true }));

    const result = await installLaunchd({
      dryRun: true,
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      access,
      lstat,
      stat,
      mkdir,
      writeFile,
      runLaunchctl,
    });

    expect(result.dryRun).toBe(true);
    expect(result.wrotePlist).toBe(false);
    expect(result.loaded).toBe(false);
    expect(lstat).toHaveBeenCalledWith("/Users/tester/.codex-im-bridge/bin/load-and-run.sh");
    expect(lstat).toHaveBeenCalledWith(DAEMON_ENTRY);
    expect(stat).toHaveBeenCalledWith("/Users/tester/.codex-im-bridge/bin/load-and-run.sh");
    expect(stat).toHaveBeenCalledWith(NODE_BIN);
    expect(stat).toHaveBeenCalledWith(DAEMON_ENTRY);
    expect(access).toHaveBeenCalledTimes(3);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(runLaunchctl).not.toHaveBeenCalled();
  });

  it("dry-run mode fails closed when runtime paths are missing", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async (path) => {
      if (path.endsWith("load-and-run.sh")) {
        throw new Error("missing wrapper");
      }
      return { isSymbolicLink: () => false };
    });
    const stat = vi.fn(async () => ({ isFile: () => true }));

    await expect(
      installLaunchd({
        dryRun: true,
        home: HOME,
        user: USER,
        nodeBin: NODE_BIN,
        daemonEntry: DAEMON_ENTRY,
        access,
        lstat,
        stat,
        mkdir,
        writeFile,
        runLaunchctl,
      }),
    ).rejects.toThrow(/WRAPPER_ENTRY.*does not exist/);

    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(runLaunchctl).not.toHaveBeenCalled();
  });

  it("install path writes the plist and calls injectable launchctl without invoking the real system command", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const stat = vi.fn(async () => ({ isFile: () => true }));

    const result = await installLaunchd({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      access,
      lstat,
      stat,
      mkdir,
      writeFile,
      runLaunchctl,
    });

    expect(result.dryRun).toBe(false);
    expect(lstat).toHaveBeenCalledWith("/Users/tester/.codex-im-bridge/bin/load-and-run.sh");
    expect(lstat).toHaveBeenCalledWith(DAEMON_ENTRY);
    expect(stat).toHaveBeenCalledWith("/Users/tester/.codex-im-bridge/bin/load-and-run.sh");
    expect(stat).toHaveBeenCalledWith(NODE_BIN);
    expect(stat).toHaveBeenCalledWith(DAEMON_ENTRY);
    expect(access).toHaveBeenCalledTimes(3);
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

  it("prepares a launchd runtime only when explicitly requested", async () => {
    const prepareRuntime = vi.fn(async () => undefined);
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const stat = vi.fn(async () => ({ isFile: () => true }));

    await installLaunchd({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      prepareRuntime,
      access,
      lstat,
      stat,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      runLaunchctl: vi.fn(async () => undefined),
    });

    expect(prepareRuntime).toHaveBeenCalledWith({
      home: HOME,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
      wrapperEntry: "/Users/tester/.codex-im-bridge/bin/load-and-run.sh",
    });
  });

  it("fails closed before writing the plist when live wrapper or daemon paths are missing", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const stat = vi.fn(async (path) => {
      if (path.endsWith("load-and-run.sh")) {
        throw new Error("missing wrapper");
      }
      return { isFile: () => true };
    });

    await expect(
      installLaunchd({
        home: HOME,
        user: USER,
        nodeBin: NODE_BIN,
        daemonEntry: DAEMON_ENTRY,
        prepareRuntime: false,
        access,
        lstat,
        stat,
        mkdir,
        writeFile,
        runLaunchctl,
      }),
    ).rejects.toThrow(/WRAPPER_ENTRY.*does not exist/);

    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(runLaunchctl).not.toHaveBeenCalled();
  });

  it("verifies wrapper and node executability plus daemon readability", async () => {
    const plan = await planLaunchdInstall({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
    });
    const access = vi.fn(async () => undefined);
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const stat = vi.fn(async () => ({ isFile: () => true }));

    await verifyLaunchdRuntimePaths(plan, { access, lstat, stat });

    expect(lstat.mock.calls).toEqual([
      ["/Users/tester/.codex-im-bridge/bin/load-and-run.sh"],
      [DAEMON_ENTRY],
    ]);
    expect(access.mock.calls).toEqual([
      ["/Users/tester/.codex-im-bridge/bin/load-and-run.sh", 1],
      [NODE_BIN, 1],
      [DAEMON_ENTRY, 4],
    ]);
  });

  it("rejects symlinked installed wrapper and daemon targets but allows node symlinks", async () => {
    const plan = await planLaunchdInstall({
      home: HOME,
      user: USER,
      nodeBin: NODE_BIN,
      daemonEntry: DAEMON_ENTRY,
    });
    const access = vi.fn(async () => undefined);
    const stat = vi.fn(async () => ({ isFile: () => true }));
    const lstat = vi.fn(async (path) => {
      if (path.endsWith("load-and-run.sh")) {
        return { isSymbolicLink: () => true };
      }
      if (path === NODE_BIN) {
        throw new Error("node lstat should not be called");
      }
      return { isSymbolicLink: () => false };
    });

    await expect(verifyLaunchdRuntimePaths(plan, { access, lstat, stat })).rejects.toThrow(
      /WRAPPER_ENTRY must not be a symlink/,
    );

    const daemonSymlinkLstat = vi.fn(async (path) => {
      if (path === DAEMON_ENTRY) {
        return { isSymbolicLink: () => true };
      }
      if (path === NODE_BIN) {
        throw new Error("node lstat should not be called");
      }
      return { isSymbolicLink: () => false };
    });
    await expect(
      verifyLaunchdRuntimePaths(plan, { access, lstat: daemonSymlinkLstat, stat }),
    ).rejects.toThrow(/DAEMON_ENTRY must not be a symlink/);

    const nodeSymlinkCompatibleLstat = vi.fn(async (path) => {
      if (path === NODE_BIN) {
        throw new Error("node lstat should not be called");
      }
      return { isSymbolicLink: () => false };
    });
    await expect(
      verifyLaunchdRuntimePaths(plan, { access, lstat: nodeSymlinkCompatibleLstat, stat }),
    ).resolves.toBeUndefined();
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

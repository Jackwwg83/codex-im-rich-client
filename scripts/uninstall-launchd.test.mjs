import { describe, expect, it, vi } from "vitest";
import { planLaunchdUninstall, uninstallLaunchd } from "../bin/uninstall-launchd.mjs";

const HOME = "/Users/tester";
const PLIST = "/Users/tester/Library/LaunchAgents/io.codex-im-bridge.plist";

describe("uninstall-launchd (T30)", () => {
  it("dry-run reports exact plist path and launchctl command without side effects", async () => {
    const unlink = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);

    const result = await uninstallLaunchd({
      dryRun: true,
      home: HOME,
      unlink,
      runLaunchctl,
    });

    expect(result).toEqual({
      dryRun: true,
      plan: {
        label: "io.codex-im-bridge",
        home: HOME,
        plistPath: PLIST,
        launchctlArgs: ["unload", PLIST],
      },
      unloaded: false,
      removed: false,
    });
    expect(unlink).not.toHaveBeenCalled();
    expect(runLaunchctl).not.toHaveBeenCalled();
  });

  it("unloads and removes only the LaunchAgents plist path through injected functions", async () => {
    const unlink = vi.fn(async () => undefined);
    const runLaunchctl = vi.fn(async () => undefined);

    const result = await uninstallLaunchd({
      home: HOME,
      unlink,
      runLaunchctl,
    });

    expect(result.unloaded).toBe(true);
    expect(result.removed).toBe(true);
    expect(runLaunchctl).toHaveBeenCalledWith(["unload", PLIST]);
    expect(unlink).toHaveBeenCalledWith(PLIST);
  });

  it("preserves Keychain by never planning security commands", () => {
    const plan = planLaunchdUninstall({ home: HOME });
    const commandText = plan.launchctlArgs.join(" ");

    expect(commandText).not.toContain("security");
    expect(commandText).not.toContain("delete-generic-password");
    expect(commandText).not.toContain("IM_TELEGRAM_BOT_TOKEN");
  });

  it("refuses to delete arbitrary paths outside the LaunchAgents plist", () => {
    expect(() =>
      planLaunchdUninstall({
        home: HOME,
        plistPath: "/Users/tester/.ssh/id_rsa",
      }),
    ).toThrow(/outside LaunchAgents/);
    expect(() =>
      planLaunchdUninstall({
        home: HOME,
        plistPath: "relative.plist",
      }),
    ).toThrow(/absolute/);
  });

  it("treats an already-removed plist as a clean local removal", async () => {
    const unlink = vi.fn(async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    });
    const runLaunchctl = vi.fn(async () => undefined);

    const result = await uninstallLaunchd({
      home: HOME,
      unlink,
      runLaunchctl,
    });

    expect(result.removed).toBe(false);
    expect(runLaunchctl).toHaveBeenCalledWith(["unload", PLIST]);
  });
});

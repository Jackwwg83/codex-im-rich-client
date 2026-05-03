import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { uninstallBridge } from "../bin/uninstall-bridge.mjs";

describe("uninstall-bridge", () => {
  it("removes installed app/bin artifacts while preserving config, data, logs, and Keychain", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-bridge-uninstall-"));
    const bridgeDir = join(home, ".codex-im-bridge");
    const appDir = join(bridgeDir, "app");
    const binDir = join(bridgeDir, "bin");
    const dataDir = join(bridgeDir, "data");
    const logsDir = join(bridgeDir, "logs");
    await mkdir(appDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(appDir, "daemon.mjs"), "daemon\n");
    await writeFile(join(binDir, "load-and-run.sh"), "wrapper\n");
    await writeFile(join(bridgeDir, "config.toml"), "config\n");
    await writeFile(join(dataDir, "state.db"), "db\n");
    await writeFile(join(logsDir, "daemon.log"), "log\n");

    const result = await uninstallBridge({ home });

    expect(result.removedApp).toBe(true);
    expect(result.removedWrapper).toBe(true);
    await expect(stat(appDir)).rejects.toThrow();
    await expect(stat(join(binDir, "load-and-run.sh"))).rejects.toThrow();
    expect(await readFile(join(bridgeDir, "config.toml"), "utf8")).toBe("config\n");
    expect(await readFile(join(dataDir, "state.db"), "utf8")).toBe("db\n");
    expect(await readFile(join(logsDir, "daemon.log"), "utf8")).toBe("log\n");
  });

  it("dry-run writes nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-bridge-uninstall-dry-"));
    const bridgeDir = join(home, ".codex-im-bridge");
    const appDir = join(bridgeDir, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "daemon.mjs"), "daemon\n");

    const result = await uninstallBridge({ dryRun: true, home });

    expect(result.dryRun).toBe(true);
    expect(await readFile(join(appDir, "daemon.mjs"), "utf8")).toBe("daemon\n");
  });

  it("refuses symlink artifact targets", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-bridge-uninstall-link-"));
    const bridgeDir = join(home, ".codex-im-bridge");
    await mkdir(bridgeDir, { recursive: true });
    await symlink(tmpdir(), join(bridgeDir, "app"));

    await expect(uninstallBridge({ home })).rejects.toThrow(/refusing symlink app dir/);
  });
});

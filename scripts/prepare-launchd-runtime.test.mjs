import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoRuntimeSecretMaterial,
  prepareLaunchdRuntime,
  renderDaemonEntry,
} from "../bin/prepare-launchd-runtime.mjs";

describe("prepare-launchd-runtime", () => {
  it("renders a node-runnable daemon entry without token material", () => {
    const source = renderDaemonEntry({
      repoRoot: "/repo/codex-im",
      pnpmBin: "/opt/homebrew/bin/pnpm",
      configPath: "/Users/tester/.codex-im-bridge/config.toml",
      migrationsDir: "/repo/codex-im/packages/storage-sqlite/src/migrations",
    });

    expect(source).toContain("#!/usr/bin/env node");
    expect(source).toContain('"exec", "tsx"');
    expect(source).toContain('"daemon", "run"');
    expect(source).not.toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(source).not.toMatch(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/);
  });

  it("copies the Keychain wrapper and writes daemon.mjs into the runtime directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-runtime-home-"));
    const result = await prepareLaunchdRuntime({
      home,
      pnpmBin: "/opt/homebrew/bin/pnpm",
      nodeBin: process.execPath,
    });

    expect(result.dryRun).toBe(false);
    expect(result.wroteWrapper).toBe(true);
    expect(result.wroteDaemon).toBe(true);

    const wrapper = await readFile(result.plan.wrapperEntry, "utf8");
    const daemon = await readFile(result.plan.daemonEntry, "utf8");
    const wrapperStat = await stat(result.plan.wrapperEntry);
    const daemonStat = await stat(result.plan.daemonEntry);

    expect(wrapper).toContain("security find-generic-password");
    expect(daemon).toContain('"daemon", "run"');
    expect(wrapperStat.mode & 0o777).toBe(0o700);
    expect(daemonStat.mode & 0o777).toBe(0o700);
  });

  it("dry-run plans paths without writing runtime files", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-runtime-dry-run-"));
    const result = await prepareLaunchdRuntime({
      dryRun: true,
      home,
      pnpmBin: "/opt/homebrew/bin/pnpm",
      nodeBin: process.execPath,
    });

    expect(result.dryRun).toBe(true);
    await expect(stat(result.plan.wrapperEntry)).rejects.toThrow();
    await expect(stat(result.plan.daemonEntry)).rejects.toThrow();
  });

  it("fails closed if generated text contains token-shaped or forbidden secret material", () => {
    expect(() =>
      assertNoRuntimeSecretMaterial("daemon 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"),
    ).toThrow(/token-shaped/);
    expect(() => assertNoRuntimeSecretMaterial("daemon SECRET", ["SECRET"])).toThrow(
      /forbidden secret/,
    );
  });
});

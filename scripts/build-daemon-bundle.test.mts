import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAEMON_BUNDLE_BANNER,
  DAEMON_BUNDLE_ENTRY,
  DAEMON_BUNDLE_EXTERNAL,
  DAEMON_BUNDLE_OUTFILE,
  assertNoDaemonBundleSecretMaterial,
  buildDaemonBundle,
  createDaemonBundleBuildOptions,
} from "./build-daemon-bundle.mts";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("build-daemon-bundle", () => {
  it("pins the bundle entry, output contract, and native external list", () => {
    const options = createDaemonBundleBuildOptions({ repoRoot: REPO_ROOT });

    expect(DAEMON_BUNDLE_ENTRY).toBe("packages/cli/src/daemon-run-bundle-entry.ts");
    expect(DAEMON_BUNDLE_OUTFILE).toBe("dist/codex-im-daemon.mjs");
    expect(DAEMON_BUNDLE_EXTERNAL).toEqual([
      "@larksuiteoapi/node-sdk",
      "better-sqlite3",
      "dingtalk-stream",
      "pino",
    ]);
    expect(options.entryPoints).toEqual([join(REPO_ROOT, DAEMON_BUNDLE_ENTRY)]);
    expect(options.outfile).toBe(join(REPO_ROOT, DAEMON_BUNDLE_OUTFILE));
    expect(options.bundle).toBe(true);
    expect(options.platform).toBe("node");
    expect(options.format).toBe("esm");
    expect(options.target).toBe("node24");
    expect(options.banner).toEqual({ js: DAEMON_BUNDLE_BANNER });
    expect(options.external).toEqual([
      "@larksuiteoapi/node-sdk",
      "better-sqlite3",
      "dingtalk-stream",
      "pino",
    ]);
  });

  it("keeps the bundle entry a thin argv passthrough to daemon-run", async () => {
    const source = await readFile(join(REPO_ROOT, DAEMON_BUNDLE_ENTRY), "utf8");

    expect(source).toContain('import { run } from "./daemon-run.js";');
    expect(source).toContain("run(process.argv.slice(2))");
    expect(source).not.toContain("telegram");
    expect(source).not.toContain("app-server");
  });

  it("builds an executable mjs bundle with a node shebang and no secret-like material", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-im-daemon-bundle-"));
    const outfile = join(tempDir, "codex-im-daemon.mjs");

    const result = await buildDaemonBundle({ repoRoot: REPO_ROOT, outfile });
    const bytes = await readFile(result.outfile, "utf8");
    const fileStats = await stat(result.outfile);

    expect(result.entryPoint).toBe(join(REPO_ROOT, DAEMON_BUNDLE_ENTRY));
    expect(result.outfile).toBe(outfile);
    expect(bytes.startsWith(`${DAEMON_BUNDLE_BANNER}\n`)).toBe(true);
    expect(bytes.split("\n").filter((line) => line === "#!/usr/bin/env node")).toHaveLength(1);
    expect(bytes).toContain("__codexImCreateRequire");
    expect(bytes).toContain('from "@larksuiteoapi/node-sdk"');
    expect(bytes).toContain('from "better-sqlite3"');
    expect(bytes).toContain('from "dingtalk-stream"');
    expect(bytes).toContain('from "pino"');
    expect(fileStats.mode & 0o111).not.toBe(0);
    expect(() => assertNoDaemonBundleSecretMaterial(bytes)).not.toThrow();
  });

  it("rejects token-shaped bundle output during post-build scan", () => {
    expect(() =>
      assertNoDaemonBundleSecretMaterial("accidental token 123456:abcdefghijklmnopqrstuvwxyz"),
    ).toThrow(/token-shaped material/);
    expect(() =>
      assertNoDaemonBundleSecretMaterial(
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      ),
    ).toThrow(/token-shaped material/);
    expect(() =>
      assertNoDaemonBundleSecretMaterial("Authorization: Bearer ${PLACEHOLDERS.bearer}"),
    ).not.toThrow();
  });
});

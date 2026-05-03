#!/usr/bin/env -S pnpm exec tsx

import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BuildOptions } from "esbuild";
import { build } from "esbuild";

export const DAEMON_BUNDLE_ENTRY = "packages/cli/src/daemon-run-bundle-entry.ts";
export const DAEMON_BUNDLE_OUTFILE = "dist/codex-im-daemon.mjs";
export const DAEMON_BUNDLE_EXTERNAL = ["better-sqlite3"] as const;
export const DAEMON_BUNDLE_BANNER = "#!/usr/bin/env node";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const GENERIC_SECRET_RE =
  /\b(?:ghp_[A-Za-z0-9_]{20,}|xox[abdprs]-[A-Za-z0-9-]{10,}|sk-(?!ip\b)[A-Za-z0-9_-]{20,})/i;
const AUTHORIZATION_BEARER_RE = /\bAuthorization:\s*Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{20,}/i;

export interface DaemonBundleOptions {
  readonly repoRoot?: string;
  readonly outfile?: string;
}

export interface DaemonBundleResult {
  readonly entryPoint: string;
  readonly outfile: string;
}

export function createDaemonBundleBuildOptions(options: DaemonBundleOptions = {}): BuildOptions {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const outfile = resolve(repoRoot, options.outfile ?? DAEMON_BUNDLE_OUTFILE);
  return {
    entryPoints: [resolve(repoRoot, DAEMON_BUNDLE_ENTRY)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: { js: DAEMON_BUNDLE_BANNER },
    external: [...DAEMON_BUNDLE_EXTERNAL],
    logLevel: "silent",
    sourcemap: false,
  };
}

export async function buildDaemonBundle(
  options: DaemonBundleOptions = {},
): Promise<DaemonBundleResult> {
  const buildOptions = createDaemonBundleBuildOptions(options);
  if (typeof buildOptions.outfile !== "string") {
    throw new Error("build-daemon-bundle: outfile is required");
  }
  await mkdir(dirname(buildOptions.outfile), { recursive: true });
  await build(buildOptions);
  await chmod(buildOptions.outfile, 0o755);
  const bundleBytes = await readFile(buildOptions.outfile, "utf8");
  assertNoDaemonBundleSecretMaterial(bundleBytes);
  return {
    entryPoint: String(buildOptions.entryPoints?.[0]),
    outfile: buildOptions.outfile,
  };
}

export function assertNoDaemonBundleSecretMaterial(bundleBytes: string): void {
  if (
    TOKEN_SHAPED_RE.test(bundleBytes) ||
    GENERIC_SECRET_RE.test(bundleBytes) ||
    AUTHORIZATION_BEARER_RE.test(bundleBytes)
  ) {
    throw new Error("build-daemon-bundle: output contains token-shaped material");
  }
}

async function main(): Promise<void> {
  const result = await buildDaemonBundle();
  process.stdout.write(`daemon bundle: ${result.outfile}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

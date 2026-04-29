#!/usr/bin/env node
/**
 * Codex version gate (Phase 0 Task 1.5, Codex outside-voice finding #2).
 *
 * Three-way version comparison:
 *   1. CODEX_VERSION file at repo root      (the immutable pin)
 *   2. package.json#codexIm.codexVersion    (the same pin, mirrored for tools)
 *   3. `codex --version` output             (the runtime CLI on PATH)
 *
 * Exits 1 if any pair disagrees, with a message explaining how to acknowledge
 * an intentional upgrade. The intent is that any codex CLI version drift forces
 * a manual review of generated artifacts (`pnpm protocol:generate`) and wire
 * fixtures (`packages/testkit/fixtures/codex-X.Y.Z/`).
 *
 * This script is run by `pnpm check:codex-version` and indirectly by
 * `pnpm protocol:generate` (Task 2.2).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Anchored semver: MAJOR.MINOR.PATCH with optional -prerelease and +build.
// Per https://semver.org. Anchored at start AND end so "0.125.0junk" is rejected.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// Capture form for parsing a semver out of the codex --version line, anchored
// by the first whitespace boundary so build metadata is included.
const SEMVER_CAPTURE_RE =
  /(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:$|\s)/;

function fail(msg) {
  console.error(`[check:codex-version] ${msg}`);
  process.exit(1);
}

// 1. Read CODEX_VERSION file
let fileVersion;
try {
  fileVersion = readFileSync(join(root, "CODEX_VERSION"), "utf8").trim();
} catch (err) {
  fail(`could not read CODEX_VERSION at repo root: ${err.message}`);
}
if (!SEMVER_RE.test(fileVersion)) {
  fail(`CODEX_VERSION is not a valid anchored semver: "${fileVersion}"`);
}

// 2. Read package.json#codexIm.codexVersion
let pkgVersion;
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkgVersion = pkg?.codexIm?.codexVersion;
} catch (err) {
  fail(`could not parse package.json: ${err.message}`);
}
if (!pkgVersion) {
  fail("package.json#codexIm.codexVersion is missing");
}
if (!SEMVER_RE.test(pkgVersion)) {
  fail(`package.json#codexIm.codexVersion is not a valid anchored semver: "${pkgVersion}"`);
}

// 3. Read `codex --version` from the CLI on PATH.
// execFile (not execSync via shell) so missing binary surfaces as ENOENT,
// not shell exit 127.
let cliVersion;
try {
  const raw = execFileSync("codex", ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const match = raw.match(SEMVER_CAPTURE_RE);
  if (!match) {
    fail(`could not parse codex version from output: "${raw}"`);
  }
  cliVersion = match[1];
} catch (err) {
  if (err.code === "ENOENT") {
    fail("codex CLI not found on PATH. Install it (https://github.com/openai/codex) and re-run.");
  }
  if (err.code === "ETIMEDOUT") {
    fail("`codex --version` timed out (5s).");
  }
  fail(`\`codex --version\` failed: ${err.message}`);
}

// Compare all three
if (fileVersion !== pkgVersion || fileVersion !== cliVersion) {
  fail(
    [
      "version mismatch:",
      `  CODEX_VERSION file:                     ${fileVersion}`,
      `  package.json#codexIm.codexVersion:      ${pkgVersion}`,
      `  codex --version (runtime CLI):          ${cliVersion}`,
      "",
      "If you intentionally upgraded codex, follow this sequence:",
      "  1. Update CODEX_VERSION to the new version.",
      "  2. Update package.json#codexIm.codexVersion to match.",
      "  3. Run `pnpm protocol:generate` and review the diff carefully.",
      "  4. Run `pnpm test:contract` to replay the previous version's wire",
      "     fixtures against the new types. If any fixture diverges, capture",
      "     fresh fixtures into packages/testkit/fixtures/codex-<new>/.",
      "  5. Commit all of the above as a single 'codex upgrade' commit.",
    ].join("\n"),
  );
}

console.log(`[check:codex-version] OK: ${fileVersion}`);

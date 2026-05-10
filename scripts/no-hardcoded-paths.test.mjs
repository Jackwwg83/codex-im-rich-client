import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Files allowed to contain the forbidden path literal. Each entry has a one-line
// reason. Anything outside this list (and outside docs/internal/, see below) is
// treated as a regression.
const ALLOWLIST = new Set([
  // Intentional redact() probe: the test asserts that user-home paths are
  // collapsed to a placeholder before reaching the renderer.
  "packages/render/test/project-approval.test.ts",
  // Same reason: web /status redaction snapshot test feeds a user-home string
  // and asserts it is never echoed back.
  "packages/daemon/test/web-status.test.ts",
  // Pre-existing fixture cwd metadata. Out of scope for the Slice 1 path-leak
  // fix (which targeted packages/daemon/test/daemon.test.ts only). May be
  // converted to tmpdir-based fixtures in a later slice.
  "packages/storage-sqlite/test/thread-sessions.test.ts",
  "packages/storage-sqlite/test/bindings.test.ts",
  // Same: pre-existing fixture cwd metadata, out of Slice 1 scope.
  "scripts/dingtalk-readiness.test.mts",
]);

// The forbidden literal is assembled at runtime so that *this* test file does
// not itself match a static grep for the string we are trying to ban.
const NEEDLE = `/Users/${"jackwu"}`;

describe("no /Users/jackwu hardcodes outside the allowlist", () => {
  it("blocks reintroduction in packages/, scripts/, and active docs", () => {
    const result = spawnSync(
      "grep",
      [
        "-rln",
        NEEDLE,
        "packages/",
        "scripts/",
        "docs/",
        "--include=*.ts",
        "--include=*.mts",
        "--include=*.md",
      ],
      { encoding: "utf8" },
    );

    // grep exit code: 0 = at least one match, 1 = no matches, >1 = error.
    if (result.status === 1) {
      // No matches anywhere — the strictest possible state.
      return;
    }
    if (result.status !== 0) {
      throw new Error(`grep failed unexpectedly: status=${result.status} stderr=${result.stderr}`);
    }

    const hits = result.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      // Frozen historical evidence: the docs/internal/ tree was reorganised on
      // 2026-05-10 and its contents predate the path-leak rule.
      .filter((path) => !path.startsWith("docs/internal/"));

    const unexpected = hits.filter((path) => !ALLOWLIST.has(path));

    expect(
      unexpected,
      `Unexpected ${NEEDLE} hardcodes (not in allowlist):\n${unexpected.join("\n")}`,
    ).toEqual([]);
  });
});

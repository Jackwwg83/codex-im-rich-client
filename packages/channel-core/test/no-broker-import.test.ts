// T18 (Phase 2) — boundary test: channel-core does NOT runtime-depend
// on @codex-im/core or @codex-im/codex-runtime.
//
// Plan: §3 module boundaries (F13: channel-core has zero runtime
// knowledge of broker / protocol).
//
// Mechanism: filesystem walk over `packages/channel-core/src/`,
// scanning every .ts file for runtime imports of disallowed packages.
// Type-only imports (`import type {...}`) are allowed since they're
// stripped by the TypeScript transformer at build time and never
// reach the JS bundle. Filesystem walk (rather than `git grep`) so
// untracked / staged files are also covered before commit.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/channel-core/src";

const FORBIDDEN_RUNTIME = ["@codex-im/core", "@codex-im/codex-runtime"];

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function findRuntimeImports(needle: string): string[] {
  const matches: string[] = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      // Only flag lines that:
      //   1. start with `import` (not inside a comment / string), AND
      //   2. reference the forbidden package, AND
      //   3. are NOT type-only (`import type {...}`).
      if (!/^\s*import\b/.test(line)) continue;
      if (!line.includes(needle)) continue;
      if (/^\s*import\s+type\b/.test(line)) continue;
      matches.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  return matches;
}

describe("channel-core boundary: no runtime broker / runtime imports (T18 / F13)", () => {
  for (const needle of FORBIDDEN_RUNTIME) {
    it(`channel-core src has no runtime import from ${needle}`, () => {
      const matches = findRuntimeImports(needle);
      expect(matches).toEqual([]);
    });
  }
});

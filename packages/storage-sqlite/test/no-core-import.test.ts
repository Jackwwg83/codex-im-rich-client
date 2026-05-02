// T1.1 (Phase 3) — boundary test: storage-sqlite has NO runtime
// imports from upper-layer packages.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T1.1
//       + §7 D27 (storage-sqlite is below core; no upward deps)
//
// Mirrors `packages/channel-core/test/no-broker-import.test.ts`
// pattern. Filesystem walk over `packages/storage-sqlite/src/`,
// scanning every .ts file for runtime imports of disallowed packages.
// Type-only imports (`import type {...}`) are allowed since they're
// stripped by the TypeScript transformer at build time and never
// reach the JS bundle.
//
// Forbidden runtime imports — every package above storage-sqlite in
// the Phase 3 layer cake:
//   @codex-im/core               broker / redact / audit
//   @codex-im/codex-runtime      runtime / EventNormalizer
//   @codex-im/channel-core       adapter contract (Phase 2 closed)
//   @codex-im/render             rich-block rendering
//   @codex-im/daemon             top-level orchestration
//   @codex-im/im-telegram        Phase 3 platform adapter (when added)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/storage-sqlite/src";

const FORBIDDEN_RUNTIME = [
  "@codex-im/core",
  "@codex-im/codex-runtime",
  "@codex-im/channel-core",
  "@codex-im/render",
  "@codex-im/daemon",
  "@codex-im/im-telegram",
];

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

describe("storage-sqlite boundary: no runtime imports from upper layers (T1.1 / D27)", () => {
  for (const needle of FORBIDDEN_RUNTIME) {
    it(`storage-sqlite src has no runtime import from ${needle}`, () => {
      const matches = findRuntimeImports(needle);
      expect(matches).toEqual([]);
    });
  }
});

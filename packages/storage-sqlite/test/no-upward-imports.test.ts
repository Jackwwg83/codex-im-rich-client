// T1.1 (Phase 3) — boundary test: storage-sqlite has NO imports
// (runtime OR type-only) from any upper-layer or protocol-layer
// package.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T1.1
//       + §7 D27 (storage-sqlite is the LOWEST layer; no upward deps)
//
// Replaces the earlier `no-core-import.test.ts` + `no-protocol-import.test.ts`
// pair. Codex outside-voice review (impl-t1-t2c) flagged P1: the
// channel-core-style tests carved out `import type` and only matched
// lines starting with `import`, so `import type {…} from "@codex-im/core"`,
// `export … from "@codex-im/core"`, and multi-line imports could all
// slip past. Storage's D27 boundary is STRICTER than channel-core's
// F13 (no type-only carve-out, period) — this consolidated test
// enforces the strict version against the full forbidden list.
//
// Forbidden (runtime AND type-only) — every package above or beside
// storage-sqlite in the Phase 3 layer cake:
//   @codex-im/core               broker / redact / audit
//   @codex-im/codex-runtime      runtime / EventNormalizer
//   @codex-im/app-server-client  transport / client
//   @codex-im/channel-core       adapter contract (Phase 2 closed)
//   @codex-im/protocol           generated codex protocol types
//   @codex-im/render             rich-block rendering
//   @codex-im/daemon             top-level orchestration
//   @codex-im/im-telegram        Phase 3 platform adapter (when added)
//
// Storage stores OPAQUE strings — every column is a primitive (TEXT /
// INTEGER / BLOB) that the writer redacts before insert and the
// reader hands back as-is. The schema is the source of truth, not
// any TypeScript shape from core.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/storage-sqlite/src";

const FORBIDDEN_ALL = [
  "@codex-im/core",
  "@codex-im/codex-runtime",
  "@codex-im/app-server-client",
  "@codex-im/channel-core",
  "@codex-im/protocol",
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Find every import / export declaration in `content` that references
 * `needle` (the package name) or any subpath under it.
 *
 * Two regexes, both anchored to a line start with `m` flag:
 *   1. `from`-clause: matches `import …`, `import type …`, `export …`,
 *      `export type …`, `export *` — AND multi-line wrapped imports
 *      because `[^;]*?` spans newlines lazily up to the `from` keyword.
 *   2. bare side-effect import: `import "pkg"` (no `from`).
 *
 * Type-only is NOT carved out — D27 forbids it.
 *
 * Comment-stripping isn't perfect; a line-comment containing
 * `// import { X } from "@codex-im/core"` would NOT match because the
 * `^\s*` anchor + `(?:import|export)` keyword requirement skips the
 * `//` prefix. A block comment opening on a previous line that
 * contains `import` would be a false positive — but no production
 * source in this repo uses that pattern.
 */
function findUpwardImports(file: string, content: string, needle: string): string[] {
  const escaped = escapeRegex(needle);
  const fromRe = new RegExp(
    `^\\s*(?:import|export)\\b[^;]*?\\bfrom\\s+["']${escaped}(?:/[^"']*)?["']`,
    "gm",
  );
  const bareRe = new RegExp(`^\\s*import\\s+["']${escaped}(?:/[^"']*)?["']`, "gm");

  const matches: string[] = [];
  for (const re of [fromRe, bareRe]) {
    for (const m of content.matchAll(re)) {
      const idx = m.index ?? 0;
      const lineNo = content.slice(0, idx).split("\n").length;
      const trimmed = m[0].split("\n").join(" ").trim();
      matches.push(`${file}:${lineNo}: ${trimmed}`);
    }
  }
  return matches;
}

describe("storage-sqlite boundary: no upward imports of any kind (T1.1 / D27)", () => {
  for (const needle of FORBIDDEN_ALL) {
    it(`storage-sqlite src has no import/export referencing ${needle}`, () => {
      const matches: string[] = [];
      for (const file of listTsFiles(SRC_DIR)) {
        const content = readFileSync(file, "utf-8");
        matches.push(...findUpwardImports(file, content, needle));
      }
      expect(matches).toEqual([]);
    });
  }
});

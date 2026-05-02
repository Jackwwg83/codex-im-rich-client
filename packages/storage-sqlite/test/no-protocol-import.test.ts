// T1.1 (Phase 3) — boundary test: storage-sqlite has NO imports
// (runtime OR type-only) from protocol-side packages.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T1.1
//       + §7 D27 (storage stores opaque strings, never protocol types)
//
// Mirrors `packages/channel-core/test/no-protocol-import.test.ts`
// pattern. Storage's surface should never reference JsonRpcRequest,
// ServerRequest, ApprovalUiAction, or any other protocol/core type:
//   - The action column stores `'allow_once' | 'allow_session' |
//     'decline' | 'abort'` as plain TEXT (D34 schema CHECK), not the
//     ApprovalUiAction discriminated-union type from core.
//   - The target columns store {platform, chatId, threadKey?, topicId?}
//     as 4 explicit TEXT columns (D34 hydration contract from v2.4),
//     not the Target type from core.
//
// Type-only imports are FORBIDDEN here (unlike no-core-import) because
// even the type leak would couple storage to core's API surface and
// invite implementers to share types instead of keeping storage's
// schema as the source of truth.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/storage-sqlite/src";

const FORBIDDEN_ALL = ["@codex-im/app-server-client", "@codex-im/protocol"];

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

function findAnyImports(needle: string): string[] {
  const matches: string[] = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!/^\s*import\b/.test(line)) continue;
      if (!line.includes(needle)) continue;
      matches.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  return matches;
}

describe("storage-sqlite boundary: no protocol imports anywhere (T1.1 / D27)", () => {
  for (const needle of FORBIDDEN_ALL) {
    it(`storage-sqlite src has no import (runtime or type-only) from ${needle}`, () => {
      const matches = findAnyImports(needle);
      expect(matches).toEqual([]);
    });
  }
});

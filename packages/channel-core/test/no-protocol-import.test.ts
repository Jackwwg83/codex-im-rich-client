// T18 (Phase 2) — boundary test: channel-core does NOT import from
// @codex-im/app-server-client or @codex-im/protocol (neither runtime
// nor type-only — channel-core's surface should never reference
// JsonRpcRequest, ServerRequest, or any protocol-side type).
//
// Plan: §3 module boundaries (F13: channel-core consumes ApprovalAction
// type-only via @codex-im/render; nothing protocol-side).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/channel-core/src";

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

describe("channel-core boundary: no protocol imports anywhere (T18 / F13)", () => {
  for (const needle of FORBIDDEN_ALL) {
    it(`channel-core src has no import (runtime or type-only) from ${needle}`, () => {
      const matches = findAnyImports(needle);
      expect(matches).toEqual([]);
    });
  }
});

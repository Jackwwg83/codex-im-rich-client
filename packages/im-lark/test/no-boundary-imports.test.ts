import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = "packages/im-lark/src";

const FORBIDDEN_CODEX_IMPORTS = [
  "@codex-im/core",
  "@codex-im/codex-runtime",
  "@codex-im/app-server-client",
  "@codex-im/protocol",
  "@codex-im/render",
  "@codex-im/storage-sqlite",
  "@codex-im/daemon",
  "@codex-im/config",
  "@codex-im/im-telegram",
] as const;

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

function findImports(file: string, content: string, needle: string): string[] {
  const escaped = escapeRegex(needle);
  const fromRe = new RegExp(
    `^\\s*(?:import|export)\\b[^;]*?\\bfrom\\s+["']${escaped}(?:/[^"']*)?["']`,
    "gm",
  );
  const bareRe = new RegExp(`^\\s*import\\s+["']${escaped}(?:/[^"']*)?["']`, "gm");

  const matches: string[] = [];
  for (const re of [fromRe, bareRe]) {
    for (const m of content.matchAll(re)) {
      const lineNo = content.slice(0, m.index ?? 0).split("\n").length;
      matches.push(`${file}:${lineNo}: ${m[0].split("\n").join(" ").trim()}`);
    }
  }
  return matches;
}

describe("im-lark boundary (JAC-149)", () => {
  for (const needle of FORBIDDEN_CODEX_IMPORTS) {
    it(`src has no import/export referencing ${needle}`, () => {
      const matches: string[] = [];
      for (const file of listTsFiles(SRC_DIR)) {
        matches.push(...findImports(file, readFileSync(file, "utf8"), needle));
      }
      expect(matches).toEqual([]);
    });
  }

  it("production source imports only the channel-core Codex package", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/@codex-im\/[a-z0-9-]+/g)) {
        if (match[0] !== "@codex-im/channel-core") {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

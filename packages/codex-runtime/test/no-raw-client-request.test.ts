// Phase 1 tag-gate fix (2026-05-01) + T20 (Phase 2): build-time grep
// guard for raw client.request method literals.
//
// CLAUDE.md "Method literal policy" + plan §"Tag gate" require
// ClientRequest method-name literals (e.g. "thread/start", "turn/start")
// to appear ONLY in `packages/codex-runtime/src/runtime.ts`'s
// REQUEST_METHODS const table — i.e. exactly one place owns the
// method-string literals, and downstream callers go through typed
// wrappers like `runtime.threadStart(...)`.
//
// PHASE 2 T20 SCOPE EXTENSION:
//   - Adds packages/render/src + packages/channel-core/src to the
//     scanned-directories set. Phase 2 packages must also obey the
//     ClientRequest boundary (in practice they don't even import
//     AppServerClient, but we assert the absence anyway).
//   - Switches from `git grep` to filesystem walk to mirror the
//     ServerRequest guard's mechanism (consistent failure messages,
//     no untracked-file blind spot).
//
// Pairs with the ServerRequest-side guard at
// `packages/core/test/no-method-literals.test.ts` — together they
// enforce both directions of the JSON-RPC method-name boundary in
// production code.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Search scope: production src trees that should NOT contain raw
// `client.request("...")` calls.
//
// EXCLUDED (deliberately):
//   - packages/codex-runtime/src/ — the approved home (REQUEST_METHODS
//     table; CodexRuntime's internal calls go through that table).
//   - packages/core/src/ — broker dispatches ServerRequests, not
//     ClientRequests; doesn't call client.request at all in production.
//     Excluded for symmetry with the ServerRequest guard's scope.
//   - packages/codex-protocol/, packages/testkit/ — protocol generation
//     and test infrastructure.
//   - All test directories — tests may construct AppServerClient and
//     call request directly for unit-testing AppServerClient itself.
const SCANNED_DIRS = [
  "packages/app-server-client/src",
  "packages/daemon/src",
  "packages/cli/src",
  // Phase 2 additions:
  "packages/render/src",
  "packages/channel-core/src",
] as const;

// Match `client.request("` where the next character is the start of a
// string literal. Generic `client.request<T>(` calls in codex-runtime's
// REQUEST_METHODS-based wrappers don't match because their first arg is
// a `REQUEST_METHODS.foo` const reference, not a `"..."` literal.
const RAW_REQUEST_PATTERN = /client\s*\.\s*request(<[^>]*>)?\s*\(\s*"/;

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out; // nonexistent dir — skip
  }
  for (const name of entries) {
    const full = join(root, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("T20: no raw client.request method literals outside codex-runtime (Phase 1 tag-gate fix + Phase 2 extension)", () => {
  it("no production src outside codex-runtime calls client.request with a string literal", () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of listTsFiles(dir)) {
        const lines = readFileSync(file, "utf-8").split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? "";
          if (RAW_REQUEST_PATTERN.test(line)) {
            offenders.push({ file, line: i + 1, text: line.trim() });
          }
        }
      }
    }
    expect(
      offenders,
      `Found raw client.request("...") calls in ${offenders.length} location(s) outside packages/codex-runtime/. ClientRequest method literals belong in packages/codex-runtime/src/runtime.ts's REQUEST_METHODS table only; downstream callers must use CodexRuntime wrappers (runtime.threadStart, runtime.turnStart, etc.). See CLAUDE.md "Method literal policy".\nLocations:\n  ${offenders.map((o) => `${o.file}:${o.line}: ${o.text}`).join("\n  ")}`,
    ).toEqual([]);
  });
});

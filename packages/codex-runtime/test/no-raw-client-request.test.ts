// Phase 1 tag-gate fix (2026-05-01): build-time grep guard for raw
// client.request method literals.
//
// CLAUDE.md "Method literal policy" + plan §"Tag gate" require
// ClientRequest method-name literals (e.g. "thread/start", "turn/start")
// to appear ONLY in `packages/codex-runtime/src/runtime.ts`'s
// REQUEST_METHODS const table — i.e. exactly one place owns the
// method-string literals, and downstream callers go through typed
// wrappers like `runtime.threadStart(...)`.
//
// This test enforces the boundary: it greps for any
// `client.request("` pattern in production src outside codex-runtime.
// If any production callsite (smoke, daemon, CLI, future IM adapters)
// reverts to raw `client.request("...")`, this test fails.
//
// Pairs with the ServerRequest-side guard at
// `packages/core/test/no-method-literals.test.ts` (T9b Step 9b.6) —
// together they enforce both directions of the JSON-RPC method-name
// boundary in production code.

import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Search scope: production src trees that should NOT contain raw
// `client.request("...")` calls.
//
// EXCLUDED:
//   - packages/codex-runtime/src/ — the approved home (REQUEST_METHODS
//     table; CodexRuntime's internal calls go through that table).
//   - packages/core/src/ — broker dispatches ServerRequests, not
//     ClientRequests; doesn't call client.request at all in production.
//     Excluded for symmetry with the ServerRequest guard's scope.
//   - all test directories — tests may construct AppServerClient and
//     call request directly for unit-testing AppServerClient itself.
//   - packages/codex-protocol/, packages/testkit/ — protocol generation
//     and test infrastructure.
const SCOPE_PATHSPECS = [
  "packages/app-server-client/src/",
  "packages/daemon/src/",
  "packages/cli/src/",
];

describe("no raw client.request method literals outside codex-runtime (Phase 1 tag-gate fix)", () => {
  it("no production src outside codex-runtime calls client.request with a string literal", () => {
    // Match `client.request("` where the next character is the start
    // of a string literal. Generic `client.request<T>(` calls in
    // codex-runtime's REQUEST_METHODS-based wrappers don't match because
    // their first arg is a `REQUEST_METHODS.foo` const reference, not
    // a `"..."` literal.
    //
    // git grep -E pattern (-E = extended regex). The pattern catches:
    //   client.request("thread/start", ...)
    //   client.request<{...}>("thread/start", ...)
    //   client . request ( "thread/start" ...)   (rare; whitespace tolerated)
    const pattern = String.raw`client\s*\.\s*request(<[^>]*>)?\s*\(\s*"`;

    let stdout = "";
    try {
      stdout = execSync(
        `git grep -E -l '${pattern}' -- ${SCOPE_PATHSPECS.map((p) => `'${p}'`).join(" ")}`,
        {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        },
      );
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 1) return; // no match = pass
      throw err;
    }
    const matches = stdout
      .trim()
      .split("\n")
      .filter((s) => s.length > 0);
    expect(
      matches,
      `Found raw client.request("...") calls in ${matches.length} file(s) outside packages/codex-runtime/. ClientRequest method literals belong in packages/codex-runtime/src/runtime.ts's REQUEST_METHODS table only; downstream callers must use CodexRuntime wrappers (runtime.threadStart, runtime.turnStart, etc.). See CLAUDE.md "Method literal policy".\nFiles:\n  ${matches.join("\n  ")}`,
    ).toEqual([]);
  });
});

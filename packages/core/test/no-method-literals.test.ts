// T9b Step 9b.6: build-time grep guard for approval method-name literals.
//
// D7's "single broker owns dispatch" invariant + the CLAUDE.md redline
// "no hardcoded approval method names outside packages/core/" together
// require a build-time check: any of the 9 generated ServerRequest
// method literals appearing as a string in
//   packages/{app-server-client,codex-runtime,daemon,cli}/src/**
// is a violation. This test runs `git grep -F -l` for each method
// against that scope and fails if any hit is found.
//
// Why this is more than a linter rule:
// The ApprovalBroker is the single dispatch point for ServerRequest
// methods. If another package in the runtime stack hardcodes one of
// these literals, it's signaling intent to bypass the broker — either
// by talking to AppServerClient.setServerRequestHandler directly or by
// matching incoming method names ad hoc. Either route silently breaks
// the single-handler invariant and the audit trail. T9b's guard makes
// that impossible to land without removing the literal first.
//
// Scope decisions:
//
// - INCLUDED: packages/{app-server-client,codex-runtime,daemon,cli}/src/**
//   These are the runtime modules that talk to AppServerClient. Any
//   ServerRequest method literal here is suspicious.
//
// - EXCLUDED: packages/core/** — the broker itself OWNS the literals.
// - EXCLUDED: packages/codex-protocol/** — generated from ts-rs; the
//   literals appear as discriminator strings in the generated
//   ClientRequest/ServerRequest unions, which is correct.
// - EXCLUDED: packages/testkit/** — fixtures + replay helpers may
//   reference real wire shapes for tests.
// - EXCLUDED: docs/, scripts/, and all test directories.
//
// Why git grep specifically:
// `git grep` honors .gitignore (skips dist/, node_modules/, etc.)
// without us having to enumerate exclusions. -F matches literally so
// the slashes in method names don't get interpreted as regex. -l
// returns file paths, one per match. Exit code 1 means "no match" —
// which is what we want; the test PASSES when git grep returns 1.

import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The 9 generated ServerRequest method names as of codex 0.125.0. If a
// future codex bump adds a 10th, dispatch-coverage.test.ts's runtime
// assertion fires first; that test (and this one) get extended in the
// same PR.
const FORBIDDEN_METHOD_LITERALS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "mcpServer/elicitation/request",
  "applyPatchApproval",
  "execCommandApproval",
  "account/chatgptAuthTokens/refresh",
] as const;

// Path-spec arguments for git grep. Trailing slash limits to files
// under each directory. The daemon package doesn't exist yet (T11
// creates it); git grep silently skips nonexistent paths.
const SCOPE_PATHSPECS = [
  "packages/app-server-client/src/",
  "packages/codex-runtime/src/",
  "packages/daemon/src/",
  "packages/cli/src/",
];

describe("T9b Step 9b.6: no approval method-name literals outside packages/core/", () => {
  for (const method of FORBIDDEN_METHOD_LITERALS) {
    it(`literal '${method}' does not appear in any runtime src/`, () => {
      // -F: fixed-string match (slashes are literal, not regex)
      // -l: list filenames only (cheaper than full-line output)
      // The pathspec list scopes the search to runtime stack src/ trees.
      const args = ["grep", "-F", "-l", method, "--", ...SCOPE_PATHSPECS];
      let stdout = "";
      try {
        stdout = execSync(`git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        });
      } catch (err) {
        // git grep exits 1 when there are no matches. That's the success
        // case — re-throw only if exit code is something else (like 128
        // for "not a git repo" or 2 for "argument error").
        const e = err as { status?: number };
        if (e.status === 1) return;
        throw err;
      }
      // Got here: stdout has at least one matching file path. Surface
      // the actual paths in the failure message so the developer can
      // jump straight to the offending line.
      const matches = stdout
        .trim()
        .split("\n")
        .filter((s) => s.length > 0);
      expect(
        matches,
        `Found '${method}' in ${matches.length} file(s) outside packages/core/. Move the literal into packages/core/src/approval-broker.ts (the only authorized home), or import the dispatch via ApprovalBroker.registerHandler() instead of hardcoding.\nFiles:\n  ${matches.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});

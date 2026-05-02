// T9b Step 9b.6 (Phase 1) + T20 (Phase 2) — build-time grep guard for
// approval method-name literals.
//
// D7's "single broker owns dispatch" invariant + the CLAUDE.md redline
// "no hardcoded approval method names outside packages/core/" together
// require a build-time check: any of the 9 generated ServerRequest
// method literals appearing as a string in production src outside the
// approved homes is a violation.
//
// PHASE 2 T20 SCOPE EXTENSION:
//   - Adds packages/render/src + packages/channel-core/src to the
//     scanned-directories set (Phase 2 packages must also obey F1).
//   - Replaces the prior `git grep -F` pipeline with a filesystem
//     walk. Reasons: (a) the new boundary tests in channel-core
//     showed git-grep exits 1 on no-match (treated as failure unless
//     wrapped) AND won't see uncommitted files; filesystem walk is
//     cleaner. (b) Explicit ALLOWED_FILES allowlist makes the single
//     authorized Phase 2 home (`approval-request-kind.ts`) explicit
//     rather than implicit-by-omission.
//   - decision-mapper.ts is NOT in the allowlist — Codex round-2 C1.
//     The mapper switches on `ApprovalRequestKind`, not raw method
//     strings. T20.3 has its own explicit assertion below.
//
// AUTHORIZED HOMES (only these may contain ServerRequest method literals):
//   - packages/core/src/approval-broker.ts (Phase 1 DispatchTable)
//   - packages/core/src/approval-request-kind.ts (Phase 2 classifier
//     METHOD_TO_KIND table)
//
// EVERY OTHER PRODUCTION FILE in the scanned dirs must be clean.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

// Directories scanned for forbidden literals. Each entry is a
// path relative to the repo root. Nonexistent dirs are silently
// skipped (e.g. packages/im-telegram/src is added when D17
// flips to Option B).
const SCANNED_DIRS = [
  "packages/app-server-client/src",
  "packages/codex-runtime/src",
  "packages/daemon/src",
  "packages/cli/src",
  // Phase 2 additions:
  "packages/render/src",
  "packages/channel-core/src",
  // packages/im-telegram/src — added when D17 Option B is approved.
  // Phase 2 default is Option A (NOT shipped), so the dir is absent.
  // Plus the broker's own package — to assert ONLY the two authorized
  // files contain literals.
  "packages/core/src",
] as const;

// The two files where ServerRequest method literals are allowed to
// appear. Both are in @codex-im/core; both are the canonical "method
// → something" lookup tables that the plan deliberately concentrates
// the literals into so future codex bumps require exactly one file
// to update.
const ALLOWED_FILES = new Set<string>([
  "packages/core/src/approval-broker.ts",
  "packages/core/src/approval-request-kind.ts",
]);

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // Nonexistent dir (e.g. im-telegram before Option B) — skip silently.
    return out;
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

function gatherProductionFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCANNED_DIRS) {
    out.push(...listTsFiles(dir));
  }
  return out.sort();
}

describe("T20: ServerRequest method literals are confined to the two authorized homes", () => {
  const PRODUCTION_FILES = gatherProductionFiles();

  for (const method of FORBIDDEN_METHOD_LITERALS) {
    it(`literal '${method}' appears only in approval-broker.ts + approval-request-kind.ts`, () => {
      const offenders: string[] = [];
      for (const file of PRODUCTION_FILES) {
        if (ALLOWED_FILES.has(file)) continue;
        const content = readFileSync(file, "utf-8");
        if (content.includes(method)) {
          offenders.push(file);
        }
      }
      expect(
        offenders,
        `Found '${method}' in ${offenders.length} file(s) outside the authorized homes (approval-broker.ts + approval-request-kind.ts).\nIf a renderer / adapter / wire-up needs to react to this method, switch on \`ApprovalRequestKind\` from \`classifyApprovalRequest()\` instead of the raw method string.\nFiles:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});

describe("T20.3: decision-mapper.ts contains zero ServerRequest method literals (Codex round-2 C1)", () => {
  const MAPPER_PATH = "packages/core/src/decision-mapper.ts";
  it("decision-mapper.ts switches on ApprovalRequestKind, never on raw method strings", () => {
    const content = readFileSync(MAPPER_PATH, "utf-8");
    const found: string[] = [];
    for (const method of FORBIDDEN_METHOD_LITERALS) {
      if (content.includes(method)) {
        found.push(method);
      }
    }
    expect(
      found,
      `decision-mapper.ts MUST switch on ApprovalRequestKind (D11 corrected). Found these protocol method literals embedded directly:\n  ${found.join("\n  ")}`,
    ).toEqual([]);
  });
});

#!/usr/bin/env -S pnpm exec tsx
// T4.5 (Phase 1, Codex outside-voice B1): fixture acceptance gate.
//
// Hard-blocks T7/T9 if T4 did not produce a usable server-request
// capture. Replaces the original plan's inline `node -e` snippet, which
// could not actually execute (TypeScript `import type` is erased at
// runtime; `node -e` cannot resolve workspace packages anyway).
//
// What the gate checks:
//   1. The fixture file is non-empty.
//   2. Every line parses as JSON.
//   3. Every frame has a string `method` AND an `id` field — these are
//      server-INITIATED requests, not notifications, not responses.
//   4. Every method is a member of the generated ServerRequest["method"]
//      union from @codex-im/protocol.
//   5. At least ONE frame's method is in the approval-capable subset:
//        v2:     item/commandExecution/requestApproval
//                item/fileChange/requestApproval
//                item/permissions/requestApproval
//                item/tool/requestUserInput
//        legacy: applyPatchApproval
//                execCommandApproval
//
// Methods like `item/tool/call`, `mcpServer/elicitation/request`, and
// `account/chatgptAuthTokens/refresh` are recognized server-initiated
// requests but NOT approvals — counting them would let T4 ship without
// the wire shape T9a's contract tests need.
//
// Type-level invariant (Codex outside-voice B5/B6 spirit): the
// `APPROVAL_CAPABLE` Record below is typed as
// `Record<ServerRequest["method"], boolean>`. If codex 0.125 → next
// version adds a generated arm, TypeScript fails to compile this file
// until the operator decides whether the new method is approval-capable
// or not. No silent fall-through.
//
// Usage:
//   pnpm exec tsx scripts/verify-phase1-fixtures.mts                  # default path
//   pnpm exec tsx scripts/verify-phase1-fixtures.mts <fixture.jsonl>  # explicit path

import { readFileSync } from "node:fs";
import type { ServerRequest } from "@codex-im/protocol";

// Exhaustive runtime table over generated ServerRequest["method"] union.
// `true` means the method is in the approval-capable subset that T4
// requires; `false` means it's a generated server-request method but
// not what T4.5 is gating on (e.g. auth refresh, dynamic tool call).
//
// Adding a generated arm without updating this table is a TypeScript
// compile error (missing key on the Record). Renaming an existing arm
// out from under us is a TypeScript compile error (extra key on the
// Record). Either case forces a deliberate decision.
const APPROVAL_CAPABLE: Record<ServerRequest["method"], boolean> = {
  // v2 approvals — what T4 primarily wants
  "item/commandExecution/requestApproval": true,
  "item/fileChange/requestApproval": true,
  "item/permissions/requestApproval": true,
  // v2 user-input — also approval-capable in our sense (the user is
  // asked to confirm something before the tool proceeds)
  "item/tool/requestUserInput": true,
  // legacy (pre-v2) — still approval-capable for compat with older
  // codex versions that might be tested against the same fixture set
  applyPatchApproval: true,
  execCommandApproval: true,
  // tool / elicitation / auth — server-initiated but NOT approval-style
  "item/tool/call": false,
  "mcpServer/elicitation/request": false,
  "account/chatgptAuthTokens/refresh": false,
};

const ALL_METHODS = new Set<string>(Object.keys(APPROVAL_CAPABLE));
const APPROVAL_METHODS = new Set<string>(
  Object.entries(APPROVAL_CAPABLE)
    .filter(([, v]) => v)
    .map(([k]) => k),
);

interface JsonRpcFrame {
  method?: unknown;
  id?: unknown;
  params?: unknown;
}

export interface VerifyResult {
  ok: boolean;
  totalFrames: number;
  approvalCapableFrames: number;
  unknownMethods: string[];
  errors: string[];
}

export function verify(jsonlText: string): VerifyResult {
  const lines = jsonlText.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      ok: false,
      totalFrames: 0,
      approvalCapableFrames: 0,
      unknownMethods: [],
      errors: ["empty fixture file"],
    };
  }

  const errors: string[] = [];
  const unknownMethods = new Set<string>();
  let totalFrames = 0;
  let approvalCapableFrames = 0;

  for (const [i, line] of lines.entries()) {
    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(line) as JsonRpcFrame;
    } catch (e) {
      errors.push(`line ${i + 1}: not valid JSON: ${(e as Error).message}`);
      continue;
    }

    if (typeof frame.method !== "string") {
      errors.push(`line ${i + 1}: missing string method`);
      continue;
    }
    if (!("id" in frame) || frame.id === null || frame.id === undefined) {
      errors.push(
        `line ${i + 1}: missing id — this fixture must contain server-initiated REQUESTS, not notifications`,
      );
      continue;
    }

    totalFrames++;
    const m = frame.method;
    if (!ALL_METHODS.has(m)) {
      unknownMethods.add(m);
      errors.push(`line ${i + 1}: method "${m}" not in generated ServerRequest["method"] union`);
      continue;
    }
    if (APPROVAL_METHODS.has(m)) approvalCapableFrames++;
  }

  if (approvalCapableFrames === 0 && totalFrames > 0) {
    errors.push(
      `gate failed: 0 approval-capable frames; need ≥1 of ${[...APPROVAL_METHODS].join(", ")}`,
    );
  }

  return {
    ok: errors.length === 0,
    totalFrames,
    approvalCapableFrames,
    unknownMethods: [...unknownMethods],
    errors,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

const DEFAULT_PATH =
  "packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl";

function main(): void {
  const path = process.argv[2] ?? DEFAULT_PATH;
  const text = readFileSync(path, "utf8");
  const r = verify(text);
  if (!r.ok) {
    console.error(`GATE FAIL: ${path}`);
    for (const e of r.errors) console.error("  -", e);
    process.exit(1);
  }
  console.log(
    `GATE PASS: ${r.totalFrames} server-request frames, ${r.approvalCapableFrames} approval-capable`,
  );
  if (r.unknownMethods.length > 0) {
    console.warn(`  warning: unknown methods seen: ${r.unknownMethods.join(", ")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

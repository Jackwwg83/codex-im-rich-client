// T9a Steps 9a.4 + 9a.5: dispatch-coverage assertions.
//
// Two layers, both load-bearing:
//
// 1. **Type-only block (Step 9a.4 — Codex required-test).**
//    Annotates each Phase-1 default-reject value with its corresponding
//    generated `*Response` type. Compiles iff the broker's default-reject
//    shapes are valid for the actual generated types — proving the broker
//    does NOT assume the legacy `{decision: ReviewDecision}` shape applies
//    to v2 methods. If a future codex bump tightens / widens any of these
//    response types, this block raises a TS error before the test even
//    runs (typecheck:tests gate catches it; see scripts/ci-check.sh).
//
// 2. **Runtime coverage test (Step 9a.5).**
//    `broker.dispatchMethods()` must return exactly the 9 string keys of
//    `ServerRequest["method"]` from `@codex-im/protocol`'s generated
//    union (codex 0.125). This complements the type-level
//    `_ExhaustiveDispatch` guard inside approval-broker.ts: the type
//    guard catches "table missing a generated arm at compile time", and
//    this runtime test catches "constructor population doesn't actually
//    fill every key" (which the type guard cannot enforce on its own,
//    since `Record` only requires structural matching).
//
// Plan §1747-1752. Method-name string literals here are dispatch-table
// keys, allowed inside packages/core/ per T9b's grep guard whitelist.

import { AppServerClient } from "@codex-im/app-server-client";
import type {
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalResponse,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalResponse,
  ToolRequestUserInputResponse,
} from "@codex-im/protocol";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";

// ─── Step 9a.4: type-only response-shape assertions ────────────────────
//
// These declarations are deleted by `tsc --noEmit` after typecheck — they
// don't run; their job is to fail compilation if the default-reject
// shapes drift from the generated types. The tsconfig.test.json typecheck
// (ci-check step 3/8) runs over packages/*/test/**/*.ts and catches any
// breakage here. `void` references suppress the unused-variable lint.

const _v2_command: CommandExecutionRequestApprovalResponse = { decision: "decline" };
void _v2_command;

const _v2_filechange: FileChangeRequestApprovalResponse = { decision: "decline" };
void _v2_filechange;

// PermissionsRequestApprovalResponse is the v2 response that does NOT
// follow the legacy `{decision}` shape. The broker's default-reject
// returns `{permissions: {}, scope: "turn"}` — annotating it here
// proves the type accepts that exact value.
const _v2_perm: PermissionsRequestApprovalResponse = { permissions: {}, scope: "turn" };
void _v2_perm;

const _v2_userinput: ToolRequestUserInputResponse = { answers: {} };
void _v2_userinput;

const _v2_elicitation: McpServerElicitationRequestResponse = {
  action: "cancel",
  content: null,
  _meta: null,
};
void _v2_elicitation;

// ─── Step 9a.5: runtime coverage ───────────────────────────────────────

describe("ApprovalBroker dispatch coverage (T9a Step 9a.5)", () => {
  // The expected set is the 9 generated ServerRequest method arms as of
  // codex 0.125.0. If a future codex bump adds a 10th arm, the type-level
  // _ExhaustiveDispatch guard in approval-broker.ts fails to compile and
  // this list must be updated alongside the dispatch table.
  const EXPECTED_METHODS = [
    "account/chatgptAuthTokens/refresh",
    "applyPatchApproval",
    "execCommandApproval",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/call",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
  ] as const;

  it("dispatchMethods() returns exactly the 9 generated ServerRequest arms", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    expect(broker.dispatchMethods().slice().sort()).toEqual([...EXPECTED_METHODS].sort());
    await client.stop();
    await fake.stop();
  });

  it("dispatchMethods() returns 9 entries (no duplicates, no extras)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    const methods = broker.dispatchMethods();
    expect(methods.length).toBe(9);
    expect(new Set(methods).size).toBe(9); // no duplicates
    await client.stop();
    await fake.stop();
  });
});

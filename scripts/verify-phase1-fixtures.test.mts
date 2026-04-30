// T4.5 (Phase 1, Codex outside-voice B1): fixture acceptance gate tests.
//
// Codex required-test "Fixture gate negative tests": empty file, client
// request mistaken as server request, unknown method, only non-approval
// request. Plus the two positive cases the gate must accept (v2
// approval; legacy approval).
//
// Runs in the default `pnpm test` unit gate (vitest discovers .mts via
// vite-node).

import { describe, expect, it } from "vitest";
import { verify } from "./verify-phase1-fixtures.mts";

const frame = (obj: Record<string, unknown>) => JSON.stringify(obj);

describe("verify-phase1-fixtures.verify (negative cases)", () => {
  it("rejects empty file", () => {
    const r = verify("");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /empty/i.test(e))).toBe(true);
  });

  it("rejects a notification mistakenly placed in the requests fixture (no id)", () => {
    const r = verify(frame({ method: "turn/started", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /missing id/i.test(e))).toBe(true);
  });

  it("rejects a fixture containing only non-approval server-requests", () => {
    // account/chatgptAuthTokens/refresh is in ServerRequest["method"] but
    // not approval-capable.
    const r = verify(frame({ id: 1, method: "account/chatgptAuthTokens/refresh", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /0 approval-capable/.test(e))).toBe(true);
  });

  it("rejects unknown methods (not in generated ServerRequest union)", () => {
    const r = verify(frame({ id: 1, method: "future/unseen/approval", params: {} }));
    expect(r.ok).toBe(false);
    expect(r.unknownMethods).toContain("future/unseen/approval");
    expect(r.errors.some((e) => /not in generated/i.test(e))).toBe(true);
  });

  it("rejects a frame missing a string method", () => {
    const r = verify(frame({ id: 1, params: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /missing string method/i.test(e))).toBe(true);
  });

  it("rejects a response masquerading as a request (id + method + result) — codex review #4", () => {
    const r = verify(
      frame({ id: 1, method: "applyPatchApproval", result: { decision: "denied" } }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /response shape/i.test(e))).toBe(true);
  });

  it("rejects a frame with id + method + error (also a response shape)", () => {
    const r = verify(frame({ id: 1, method: "x", error: { code: -32603, message: "y" } }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /response shape/i.test(e))).toBe(true);
  });

  it("rejects a frame whose JSON is malformed", () => {
    const r = verify("{ this is not json");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /not valid JSON/i.test(e))).toBe(true);
  });
});

describe("verify-phase1-fixtures.verify (positive cases)", () => {
  it("accepts a fixture with ≥1 approval-capable v2 method", () => {
    const r = verify(frame({ id: 1, method: "item/commandExecution/requestApproval", params: {} }));
    expect(r.ok).toBe(true);
    expect(r.approvalCapableFrames).toBe(1);
    expect(r.totalFrames).toBe(1);
  });

  it("accepts every v2 approval method (commandExecution, fileChange, permissions, tool requestUserInput)", () => {
    const lines = [
      frame({ id: 1, method: "item/commandExecution/requestApproval", params: {} }),
      frame({ id: 2, method: "item/fileChange/requestApproval", params: {} }),
      frame({ id: 3, method: "item/permissions/requestApproval", params: {} }),
      frame({ id: 4, method: "item/tool/requestUserInput", params: {} }),
    ].join("\n");
    const r = verify(lines);
    expect(r.ok).toBe(true);
    expect(r.approvalCapableFrames).toBe(4);
  });

  it("accepts legacy approval methods (applyPatchApproval, execCommandApproval)", () => {
    const lines = [
      frame({ id: 1, method: "applyPatchApproval", params: {} }),
      frame({ id: 2, method: "execCommandApproval", params: {} }),
    ].join("\n");
    const r = verify(lines);
    expect(r.ok).toBe(true);
    expect(r.approvalCapableFrames).toBe(2);
  });

  it("accepts a mixed fixture with approval + non-approval frames as long as ≥1 approval", () => {
    const lines = [
      frame({ id: 1, method: "item/fileChange/requestApproval", params: {} }),
      frame({ id: 2, method: "account/chatgptAuthTokens/refresh", params: {} }),
      frame({ id: 3, method: "item/tool/call", params: {} }),
    ].join("\n");
    const r = verify(lines);
    expect(r.ok).toBe(true);
    expect(r.totalFrames).toBe(3);
    expect(r.approvalCapableFrames).toBe(1);
  });
});

describe("verify-phase1-fixtures.verify (real captured fixture from T4)", () => {
  // The actual file shipped in T4 commit 619ec6b. If the file content
  // ever drifts (e.g. re-capture after codex upgrade), this test
  // surfaces the change in the gate output.
  it("gates the committed phase1 server-request fixture", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(
      "packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl",
      "utf8",
    );
    const r = verify(text);
    expect(r.ok).toBe(true);
    expect(r.totalFrames).toBeGreaterThanOrEqual(1);
    expect(r.approvalCapableFrames).toBeGreaterThanOrEqual(1);
  });
});

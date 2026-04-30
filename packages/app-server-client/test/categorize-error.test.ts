// T1 (Phase 1): categorizeJsonRpcError helper (P1.5)
//
// Source of truth for category branches:
//   - 05-CODEX-APP-SERVER-PROTOCOL.md §1.1 (codex 0.125 reuses -32600
//     for both unknown-method and invalid-params; client must do
//     keyword matching on error.message to distinguish)
//   - docs/phase-0/host-environment.md "Wire spike results" cases 3+4+5
//
// Defensive cases (P2 from plan-eng-review) cover empty / undefined-ish
// messages — `.includes("...")` would crash if the helper ever sees a
// non-string, so the helper coerces explicitly.
import { describe, expect, it } from "vitest";
import { type ErrorCategory, JsonRpcResponseError, categorizeJsonRpcError } from "../src/index.js";

const err = (code: number, message: string): JsonRpcResponseError =>
  new JsonRpcResponseError({ code, message });

describe("categorizeJsonRpcError", () => {
  it("classifies -32600 with 'unknown variant' as method-not-found", () => {
    const got = categorizeJsonRpcError(err(-32600, "unknown variant `foo`"));
    expect(got).toEqual<ErrorCategory>({
      category: "method-not-found",
      code: -32600,
      message: "unknown variant `foo`",
    });
  });

  it("classifies -32600 with 'missing field' as invalid-params", () => {
    const got = categorizeJsonRpcError(err(-32600, "missing field `threadId` at line 1 column 12"));
    expect(got.category).toBe("invalid-params");
    expect(got.code).toBe(-32600);
  });

  it("classifies -32600 with 'invalid type' as invalid-params", () => {
    const got = categorizeJsonRpcError(err(-32600, "invalid type: string, expected u64"));
    expect(got.category).toBe("invalid-params");
  });

  it("classifies -32600 with 'unknown field' as invalid-params", () => {
    const got = categorizeJsonRpcError(err(-32600, "unknown field `bogus`, expected one of"));
    expect(got.category).toBe("invalid-params");
  });

  it("classifies -32600 with no recognized keyword as invalid-request", () => {
    const got = categorizeJsonRpcError(err(-32600, "request was cancelled"));
    expect(got.category).toBe("invalid-request");
    expect(got.code).toBe(-32600);
    expect(got.message).toBe("request was cancelled");
  });

  it("classifies -32603 as internal-error regardless of message", () => {
    const got = categorizeJsonRpcError(err(-32603, "transport handler failed"));
    expect(got.category).toBe("internal-error");
    expect(got.code).toBe(-32603);
  });

  it("classifies any other code as unknown", () => {
    expect(categorizeJsonRpcError(err(-32700, "parse error")).category).toBe("unknown");
    expect(categorizeJsonRpcError(err(0, "")).category).toBe("unknown");
    expect(categorizeJsonRpcError(err(42, "anything")).category).toBe("unknown");
  });

  it("does not crash on empty message", () => {
    const got = categorizeJsonRpcError(err(-32600, ""));
    // Empty message has no recognized keyword → invalid-request fallback.
    expect(got.category).toBe("invalid-request");
    expect(got.message).toBe("");
  });

  it("preserves the exact message string in the category result", () => {
    const m = "unknown variant `applyPatchApproval`, expected one of `item/...";
    const got = categorizeJsonRpcError(err(-32600, m));
    expect(got.message).toBe(m);
  });

  it("category result is a discriminated union — TS narrowing works", () => {
    const got = categorizeJsonRpcError(err(-32603, "internal"));
    if (got.category === "internal-error") {
      // Compile-time check: we can read code without union-narrowing complaints
      const _code: number = got.code;
      expect(_code).toBe(-32603);
    } else {
      throw new Error("expected internal-error category");
    }
  });
});

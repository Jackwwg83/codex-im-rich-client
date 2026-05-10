import { JsonRpcResponseError } from "@codex-im/app-server-client";
import { describe, expect, it } from "vitest";
import { CodexCapabilities, isMethodNotFoundError } from "../src/capabilities.js";

describe("CodexCapabilities", () => {
  it("isLikelySupported defaults to true (optimistic) for unknown methods", () => {
    const c = new CodexCapabilities();
    expect(c.isLikelySupported("thread/setName")).toBe(true);
    expect(c.isLikelySupported("anything/at/all")).toBe(true);
  });

  it("recordUnsupported flips isLikelySupported to false", () => {
    const c = new CodexCapabilities();
    c.recordUnsupported("thread/setName");
    expect(c.isLikelySupported("thread/setName")).toBe(false);
  });

  it("recordSupported (re-)affirms the optimistic answer", () => {
    const c = new CodexCapabilities();
    c.recordSupported("thread/archive");
    expect(c.isLikelySupported("thread/archive")).toBe(true);
  });

  it("snapshot returns a copy that does not mutate when the source is updated", () => {
    const c = new CodexCapabilities();
    c.recordSupported("thread/archive");
    const snap = c.snapshot();
    expect(snap.get("thread/archive")).toBe(true);
    c.recordUnsupported("thread/archive");
    expect(snap.get("thread/archive")).toBe(true);
    expect(c.snapshot().get("thread/archive")).toBe(false);
  });

  it("tryCall returns the result and records supported on success", async () => {
    const c = new CodexCapabilities();
    const result = await c.tryCall("thread/setName", async () => 42);
    expect(result).toBe(42);
    expect(c.snapshot().get("thread/setName")).toBe(true);
  });

  it("tryCall returns undefined and records unsupported on -32601", async () => {
    const c = new CodexCapabilities();
    const result = await c.tryCall("thread/setName", async () => {
      throw new JsonRpcResponseError({ code: -32601, message: "method not found" });
    });
    expect(result).toBeUndefined();
    expect(c.snapshot().get("thread/setName")).toBe(false);
    expect(c.isLikelySupported("thread/setName")).toBe(false);
  });

  it("tryCall rethrows non-32601 errors and does not update the cache", async () => {
    const c = new CodexCapabilities();
    await expect(
      c.tryCall("thread/setName", async () => {
        throw new JsonRpcResponseError({ code: -32000, message: "thread not found" });
      }),
    ).rejects.toBeInstanceOf(JsonRpcResponseError);
    expect(c.snapshot().has("thread/setName")).toBe(false);
  });

  it("tryCall rethrows generic errors that are not JSON-RPC at all", async () => {
    const c = new CodexCapabilities();
    await expect(
      c.tryCall("thread/setName", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(c.snapshot().has("thread/setName")).toBe(false);
  });

  it("once unsupported, tryCall does not call fn() again -- it is the caller's job to skip", async () => {
    // The class is intentionally minimal: it records, it does not
    // short-circuit. Callers who want short-circuit should consult
    // isLikelySupported() before invoking tryCall(). This test
    // documents that contract so future maintainers do not "fix"
    // tryCall to skip unsupported methods.
    const c = new CodexCapabilities();
    c.recordUnsupported("thread/setName");
    let called = 0;
    const result = await c.tryCall("thread/setName", async () => {
      called += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(called).toBe(1);
    // The successful call re-flipped the cache, which is correct: the
    // method clearly works now even if a previous call returned -32601.
    expect(c.isLikelySupported("thread/setName")).toBe(true);
  });
});

describe("isMethodNotFoundError", () => {
  it("matches a JsonRpcResponseError with code -32601", () => {
    const err = new JsonRpcResponseError({ code: -32601, message: "method not found" });
    expect(isMethodNotFoundError(err)).toBe(true);
  });

  it("does not match other JsonRpcResponseError codes", () => {
    expect(
      isMethodNotFoundError(new JsonRpcResponseError({ code: -32600, message: "invalid request" })),
    ).toBe(false);
    expect(
      isMethodNotFoundError(new JsonRpcResponseError({ code: -32603, message: "internal error" })),
    ).toBe(false);
  });

  it("matches a flattened object literal with code -32601", () => {
    expect(isMethodNotFoundError({ code: -32601, message: "method not found" })).toBe(true);
  });

  it("does not match a flattened object with a different code", () => {
    expect(isMethodNotFoundError({ code: -32000, message: "x" })).toBe(false);
  });

  it("does not match generic Error / string / null", () => {
    expect(isMethodNotFoundError(new Error("boom"))).toBe(false);
    expect(isMethodNotFoundError("boom")).toBe(false);
    expect(isMethodNotFoundError(null)).toBe(false);
    expect(isMethodNotFoundError(undefined)).toBe(false);
  });
});

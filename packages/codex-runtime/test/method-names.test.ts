// T6 (Phase 1, Codex outside-voice B5): isServerNotificationMethod
// derived from METHOD_CLASS.
//
// Runtime narrowing tests. Type-level exhaustiveness lives in
// method-class-exhaustive.test-d.ts and runs under
// `pnpm typecheck:tests` (the gate added in T5 codex-review fix).

import { describe, expect, it } from "vitest";
import { METHOD_CLASS } from "../src/event-class.js";
import { KNOWN_NOTIFICATION_METHODS, isServerNotificationMethod } from "../src/method-names.js";

describe("isServerNotificationMethod", () => {
  it("returns true for a known method", () => {
    expect(isServerNotificationMethod("turn/started")).toBe(true);
    expect(isServerNotificationMethod("turn/completed")).toBe(true);
    expect(isServerNotificationMethod("item/agentMessage/delta")).toBe(true);
  });

  it("returns false for an unknown method", () => {
    expect(isServerNotificationMethod("future/never/seen")).toBe(false);
    expect(isServerNotificationMethod("")).toBe(false);
    expect(isServerNotificationMethod("turn/started/extra")).toBe(false);
  });

  it("narrows the type for downstream consumers", () => {
    const m: string = "turn/completed";
    if (isServerNotificationMethod(m)) {
      // Type-level: m is now ServerNotificationMethod inside this branch.
      // Looking it up in METHOD_CLASS must be safe (no widening).
      const cls = METHOD_CLASS[m];
      expect(cls === "lifecycle" || cls === "delta").toBe(true);
    } else {
      throw new Error("expected turn/completed to be recognized");
    }
  });

  it("KNOWN_NOTIFICATION_METHODS is the same set as METHOD_CLASS keys", () => {
    const fromTable = new Set(Object.keys(METHOD_CLASS));
    const fromConst = new Set(KNOWN_NOTIFICATION_METHODS);
    expect(fromConst.size).toBe(fromTable.size);
    for (const m of fromConst) expect(fromTable.has(m)).toBe(true);
  });

  it("is not fooled by prototype-chain keys (Object.hasOwn vs `in`)", () => {
    // `in` would return true for "constructor" / "toString" because those
    // exist on Object.prototype; Object.hasOwn returns false. Codex
    // outside-voice B5 spirit — narrowing must not silently accept
    // inherited keys.
    expect(isServerNotificationMethod("constructor")).toBe(false);
    expect(isServerNotificationMethod("toString")).toBe(false);
    expect(isServerNotificationMethod("hasOwnProperty")).toBe(false);
    expect(isServerNotificationMethod("__proto__")).toBe(false);
  });
});

describe("METHOD_CLASS coverage", () => {
  it("classifies every method as exactly one of lifecycle | delta", () => {
    for (const [, cls] of Object.entries(METHOD_CLASS)) {
      expect(cls === "lifecycle" || cls === "delta").toBe(true);
    }
  });

  it("contains the delta-class methods D5 final calls out", () => {
    // D5 final says delta = */delta, */outputDelta, */textDelta,
    // */patchUpdated. Verify the canonical samples are classified delta.
    const deltaSamples = [
      "item/agentMessage/delta",
      "item/commandExecution/outputDelta",
      "item/fileChange/outputDelta",
      "item/fileChange/patchUpdated",
      "item/reasoning/textDelta",
      "item/plan/delta",
    ];
    for (const m of deltaSamples) {
      expect(METHOD_CLASS[m as keyof typeof METHOD_CLASS]).toBe("delta");
    }
  });

  it("contains the lifecycle methods D5 final calls out", () => {
    const lifecycleSamples = [
      "turn/started",
      "turn/completed",
      "thread/started",
      "thread/closed",
      "item/started",
      "item/completed",
      "warning",
      "error",
      "guardianWarning",
      "thread/tokenUsage/updated",
      "model/rerouted",
      "turn/diff/updated",
      "turn/plan/updated",
    ];
    for (const m of lifecycleSamples) {
      expect(METHOD_CLASS[m as keyof typeof METHOD_CLASS]).toBe("lifecycle");
    }
  });

  it("recognizes every method seen in the captured T4 fixture (cross-check)", async () => {
    // If T4's captured fixture contains a method we haven't classified,
    // T7a's normalizer would treat it as `unknown` instead of doing the
    // intended classification — surface that drift here.
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(
      "packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl",
      "utf8",
    );
    const methods = new Set<string>();
    for (const line of text.split("\n").filter((l) => l.length > 0)) {
      const frame = JSON.parse(line) as { method?: unknown };
      if (typeof frame.method === "string") methods.add(frame.method);
    }
    for (const m of methods) {
      expect(isServerNotificationMethod(m), `T4 fixture method ${m} not in METHOD_CLASS`).toBe(
        true,
      );
    }
  });
});

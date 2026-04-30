// T3 (Phase 1): @codex-im/codex-runtime skeleton.
//
// This file ONLY validates that the package compiles, exports its facade
// types, and is importable from the workspace. Logic-bearing tests for
// EventNormalizer / CodexRuntime / event-class table land in T6, T7a, T7b,
// and T8 respectively.

import { describe, expect, it } from "vitest";
import type { CodexRichEvent, EventClass, MethodClassification } from "../src/index.js";

describe("@codex-im/codex-runtime skeleton (T3)", () => {
  it("CodexRichEvent is a discriminated union narrowable on `type`", () => {
    // Compile-time narrowing test: each arm exposes the right tags.
    const ev: CodexRichEvent = {
      type: "turn_started",
      threadId: "t1",
      turnId: "u1",
      raw: {},
    };

    if (ev.type === "turn_started") {
      const _t: string = ev.threadId;
      const _u: string = ev.turnId;
      expect(_t).toBe("t1");
      expect(_u).toBe("u1");
    } else {
      throw new Error("expected turn_started");
    }
  });

  it("normalizer_overflow synthetic carries droppedCount + class", () => {
    const ev: CodexRichEvent = {
      type: "normalizer_overflow",
      droppedCount: 1,
      class: "delta",
    };
    if (ev.type === "normalizer_overflow") {
      expect(ev.droppedCount).toBe(1);
      expect(ev.class).toBe("delta");
    } else {
      throw new Error("expected normalizer_overflow");
    }
  });

  it("normalizer_overflow synthetic supports both classes (D5 final)", () => {
    // D5 documents `class: "lifecycle"` as a fatal-class indicator emitted
    // only when the hard cap is breached (lifecycle saturation — should be
    // impossible in practice). The type must allow both classes so T7b's
    // walk-and-drop logic and the catastrophic fallback path both compile.
    const fatal: CodexRichEvent = {
      type: "normalizer_overflow",
      droppedCount: 1,
      class: "lifecycle",
    };
    expect(fatal.type).toBe("normalizer_overflow");
  });

  it("unknown event arm preserves method + params verbatim", () => {
    const ev: CodexRichEvent = {
      type: "unknown",
      method: "future/never/seen",
      params: { x: 1 },
    };
    if (ev.type === "unknown") {
      expect(ev.method).toBe("future/never/seen");
      expect(ev.params).toEqual({ x: 1 });
    } else {
      throw new Error("expected unknown");
    }
  });

  it("EventClass is the two-arm union from D5 final", () => {
    const a: EventClass = "lifecycle";
    const b: EventClass = "delta";
    expect([a, b]).toEqual(["lifecycle", "delta"]);
  });

  it("MethodClassification is a readonly record keyed by method name", () => {
    const table: MethodClassification = {
      "turn/started": "lifecycle",
      "item/agentMessage/delta": "delta",
    };
    expect(table["turn/started"]).toBe("lifecycle");
    expect(table["item/agentMessage/delta"]).toBe("delta");
  });
});

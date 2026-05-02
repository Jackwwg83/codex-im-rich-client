import { describe, expect, it } from "vitest";
import { formatTurnFailed } from "../src/turn-failed.js";

describe("formatTurnFailed (Phase 3 T19d)", () => {
  it("renders transport_lost turn_failed with thread and turn ids", () => {
    const out = formatTurnFailed({
      type: "turn_failed",
      threadId: "thread-7",
      turnId: "turn-9",
      cause: "transport_lost",
    });

    expect(out).toContain("Turn failed");
    expect(out).toContain("transport was lost");
    expect(out).toContain("thread-7");
    expect(out).toContain("turn-9");
  });
});

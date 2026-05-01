// T15 (Phase 2) — truncate utility tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T15
//
// Pure byte-bounded string truncation with a marker. Used by T16
// `project-approval.ts` to keep ApprovalCard text fields under IM
// platform limits (Telegram 4096 chars per message, Lark interactive
// cards have per-element budgets, DingTalk has per-action-card char
// limits). Phase 2 contract:
//
//   truncate(input, limit)                              → marker "…[truncated]"
//   truncate(input, limit, { marker })                  → custom marker
//
// Limit is in BYTES (UTF-8). UTF-8 multi-byte chars must not be
// split mid-sequence — output remains valid UTF-8. Marker counts
// against the limit (so output.length ≤ limit when truncation fires).
// `limit ≤ 0` and `marker.byteLength > limit` are programmer errors.

import { describe, expect, it } from "vitest";
import { truncate } from "../src/truncate.js";

describe("truncate (T15)", () => {
  it("returns input unchanged when within byte limit", () => {
    expect(truncate("hello", 1024)).toBe("hello");
    expect(truncate("", 1024)).toBe("");
  });

  it("returns input unchanged at exact byte limit", () => {
    const s = "a".repeat(64);
    expect(truncate(s, 64)).toBe(s);
  });

  it("appends marker when input exceeds limit", () => {
    const s = "a".repeat(200);
    const result = truncate(s, 64);
    expect(result.endsWith("…[truncated]")).toBe(true);
    expect(byteLength(result)).toBeLessThanOrEqual(64);
  });

  it("uses custom marker when provided", () => {
    const s = "a".repeat(200);
    const result = truncate(s, 64, { marker: "…" });
    expect(result.endsWith("…")).toBe(true);
    expect(byteLength(result)).toBeLessThanOrEqual(64);
  });

  it("does not split multi-byte UTF-8 characters", () => {
    // 你 = E4 BD A0 (3 bytes). 50 copies = 150 bytes.
    const s = "你".repeat(50);
    const limit = 32;
    const result = truncate(s, limit);
    // Result must be valid UTF-8 — no unmatched continuation bytes.
    expect(() => new TextEncoder().encode(result)).not.toThrow();
    // And within limit.
    expect(byteLength(result)).toBeLessThanOrEqual(limit);
    // And ends with marker.
    expect(result.endsWith("…[truncated]")).toBe(true);
  });

  it("works with surrogate-pair emojis", () => {
    // 😀 = F0 9F 98 80 (4 bytes; surrogate pair in UTF-16)
    const s = "😀".repeat(20);
    const result = truncate(s, 24);
    expect(byteLength(result)).toBeLessThanOrEqual(24);
    // No lone surrogates — re-decoding should round-trip.
    const bytes = new TextEncoder().encode(result);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(result);
  });

  it("throws when limit is non-positive", () => {
    expect(() => truncate("abc", 0)).toThrow(/positive/);
    expect(() => truncate("abc", -1)).toThrow(/positive/);
  });

  it("throws when marker is too large for limit (only when truncation actually fires)", () => {
    // Input exceeds limit so marker validation kicks in.
    expect(() => truncate("a".repeat(100), 4, { marker: "longermarker" })).toThrow(/marker/);
    // Input within limit short-circuits before marker validation; that's intentional.
    expect(truncate("abc", 4, { marker: "longermarker" })).toBe("abc");
  });
});

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

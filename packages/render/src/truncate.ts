// T15 (Phase 2) — pure byte-bounded truncation utility.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T15
//
// Used by T16 `project-approval.ts` to keep ApprovalCard text fields
// under IM platform per-message limits. Always returns valid UTF-8
// (never splits mid-multibyte-sequence). Marker counts against the
// limit so output.byteLength ≤ limit when truncation fires.
//
// Limit + marker validity are caller's responsibility — callers should
// pick `limit` and `marker` such that `marker.byteLength < limit`. We
// throw on invalid input rather than silently producing garbage so
// renderer wire-up bugs surface in tests.

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER_FATAL = new TextDecoder("utf-8", { fatal: true });
const DEFAULT_MARKER = "…[truncated]";

export type TruncateOptions = {
  marker?: string;
};

export function truncate(input: string, limit: number, opts: TruncateOptions = {}): string {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`truncate: limit must be a positive finite number (got ${limit})`);
  }
  const marker = opts.marker ?? DEFAULT_MARKER;
  const inputBytes = TEXT_ENCODER.encode(input);
  if (inputBytes.byteLength <= limit) return input;

  const markerBytes = TEXT_ENCODER.encode(marker);
  if (markerBytes.byteLength >= limit) {
    throw new Error(
      `truncate: marker (${markerBytes.byteLength}B) must be smaller than limit (${limit}B)`,
    );
  }
  const headBudget = limit - markerBytes.byteLength;

  // Trim from the right until the byte slice decodes cleanly under
  // strict UTF-8 — at most 3 bytes of trim for any valid input
  // (UTF-8 max 4-byte sequence; trailing partial sequence is at most
  // 3 bytes). Using fatal decoder turns mid-codepoint splits into
  // RangeError so the loop terminates on the first valid prefix.
  for (let take = headBudget; take >= 0; take -= 1) {
    try {
      const head = TEXT_DECODER_FATAL.decode(inputBytes.subarray(0, take));
      return head + marker;
    } catch {
      // partial codepoint at boundary — try one fewer byte
    }
  }
  // Theoretically unreachable for valid UTF-8 input given headBudget > 0.
  // Falls back to marker-only output if reached.
  return marker;
}

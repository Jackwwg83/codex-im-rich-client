// Phase 1 codex-runtime — D5 final classification table.
//
// Per plan §1 D5 final, the EventNormalizer treats two classes of
// notifications differently for backpressure (NOT for ordering — the
// queue is a single FIFO; class only affects eviction):
//
//   lifecycle  unbounded — never dropped. State-machine transitions
//              (turn/started, item/started, server-request frames,
//              warnings, errors) live here. Their cardinality is O(N)
//              per turn, not per token, so unbounded memory is fine.
//
//   delta      bounded with drop-oldest + synthetic normalizer_overflow
//              event inserted at the spliced position. The high-frequency
//              byproduct streams: `*/delta`, `*/outputDelta`,
//              `*/textDelta`, `*/patchUpdated`, `*/progress`, audio
//              chunks. May burst to thousands per second under heavy
//              tool output.
//
// Codex outside-voice B5/B6 spirit: the const below uses
// `satisfies Record<ServerNotification["method"], EventClass>` so:
//
//   - Any new generated arm without a classification entry FAILS to
//     compile. The maintainer must decide lifecycle vs delta before
//     the upgrade can land.
//   - Any stale entry whose method was renamed/removed in a codex
//     upgrade also FAILS to compile.
//
// The `as const` preserves literal-string keys (so `keyof typeof
// METHOD_CLASS` equals `ServerNotification["method"]`) and literal
// EventClass values for downstream use in T7a's exhaustive switch.

import type { ServerNotification } from "@codex-im/protocol";
import type { EventClass } from "./types.js";

export const METHOD_CLASS = {
  // ─── Account ────────────────────────────────────────────────────
  "account/login/completed": "lifecycle",
  "account/rateLimits/updated": "lifecycle",
  "account/updated": "lifecycle",

  // ─── App ────────────────────────────────────────────────────────
  "app/list/updated": "lifecycle",

  // ─── Command exec (legacy v1 + v2) ──────────────────────────────
  "command/exec/outputDelta": "delta",

  // ─── Config / deprecation / errors / warnings ───────────────────
  configWarning: "lifecycle",
  deprecationNotice: "lifecycle",
  error: "lifecycle",
  guardianWarning: "lifecycle",
  warning: "lifecycle",

  // ─── External agent + filesystem ────────────────────────────────
  "externalAgentConfig/import/completed": "lifecycle",
  "fs/changed": "lifecycle",

  // ─── Fuzzy file search (experimental, not in Phase 1 scope but
  // generated regardless — must classify or compile fails) ────────
  "fuzzyFileSearch/sessionCompleted": "lifecycle",
  "fuzzyFileSearch/sessionUpdated": "lifecycle",

  // ─── Hooks ──────────────────────────────────────────────────────
  "hook/completed": "lifecycle",
  "hook/started": "lifecycle",

  // ─── Item lifecycle (the workhorse arms) ────────────────────────
  "item/agentMessage/delta": "delta",
  "item/autoApprovalReview/completed": "lifecycle",
  "item/autoApprovalReview/started": "lifecycle",
  "item/commandExecution/outputDelta": "delta",
  "item/commandExecution/terminalInteraction": "delta",
  "item/completed": "lifecycle",
  "item/fileChange/outputDelta": "delta",
  "item/fileChange/patchUpdated": "delta",
  "item/mcpToolCall/progress": "delta",
  "item/plan/delta": "delta",
  "item/reasoning/summaryPartAdded": "lifecycle",
  "item/reasoning/summaryTextDelta": "delta",
  "item/reasoning/textDelta": "delta",
  "item/started": "lifecycle",

  // ─── MCP server lifecycle ───────────────────────────────────────
  "mcpServer/oauthLogin/completed": "lifecycle",
  "mcpServer/startupStatus/updated": "lifecycle",

  // ─── Model events ───────────────────────────────────────────────
  "model/rerouted": "lifecycle",
  "model/verification": "lifecycle",

  // ─── Raw response item ──────────────────────────────────────────
  "rawResponseItem/completed": "lifecycle",

  // ─── Server-initiated request resolution ────────────────────────
  "serverRequest/resolved": "lifecycle",

  // ─── Skills ─────────────────────────────────────────────────────
  "skills/changed": "lifecycle",

  // ─── Thread lifecycle ───────────────────────────────────────────
  "thread/archived": "lifecycle",
  "thread/closed": "lifecycle",
  "thread/compacted": "lifecycle",
  "thread/name/updated": "lifecycle",
  "thread/started": "lifecycle",
  "thread/status/changed": "lifecycle",
  "thread/tokenUsage/updated": "lifecycle",
  "thread/unarchived": "lifecycle",

  // ─── Thread realtime (voice; out of Phase 1 scope, classify anyway) ──
  "thread/realtime/closed": "lifecycle",
  "thread/realtime/error": "lifecycle",
  "thread/realtime/itemAdded": "lifecycle",
  "thread/realtime/outputAudio/delta": "delta",
  "thread/realtime/sdp": "lifecycle",
  "thread/realtime/started": "lifecycle",
  "thread/realtime/transcript/delta": "delta",
  "thread/realtime/transcript/done": "lifecycle",

  // ─── Turn lifecycle (terminal events drive iterator close in T7b) ────
  "turn/completed": "lifecycle",
  "turn/diff/updated": "lifecycle",
  "turn/plan/updated": "lifecycle",
  "turn/started": "lifecycle",

  // ─── Windows-specific ───────────────────────────────────────────
  "windows/worldWritableWarning": "lifecycle",
  "windowsSandbox/setupCompleted": "lifecycle",
} as const satisfies Record<ServerNotification["method"], EventClass>;

/**
 * Classify a ServerNotification method as lifecycle or delta.
 *
 * Caller must have already narrowed `m` to `ServerNotification["method"]`
 * (typically via `isServerNotificationMethod`); passing an unknown
 * string is a TypeScript compile error.
 */
export function classifyMethod(m: ServerNotification["method"]): EventClass {
  return METHOD_CLASS[m];
}

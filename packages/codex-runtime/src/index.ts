// @codex-im/codex-runtime — public surface (T3 skeleton + T6 method-names).
//
// Phase 1 fills this in incrementally:
//   - T6   adds `isServerNotificationMethod` derived from METHOD_CLASS,
//          plus the METHOD_CLASS table itself (originally planned for
//          T7a; brought forward into T6 because the narrowing helper
//          depends on it). DONE.
//   - T7a  adds `EventNormalizer` (single FIFO + walk-and-drop overflow)
//          consuming METHOD_CLASS.
//   - T7b  widens `CodexRichEvent` for turn.status mapping (turn_failed /
//          turn_interrupted) and exposes the AsyncIterable contract.
//   - T8   adds `CodexRuntime` typed wrappers + ONE-SHOT lifecycle JSDoc.
//
// Each new export here is a deliberate code-review checkpoint, mirroring
// the facade rule from @codex-im/protocol.

export type { CodexRichEvent, EventClass, MethodClassification } from "./types.js";
export { METHOD_CLASS, classifyMethod } from "./event-class.js";
export { KNOWN_NOTIFICATION_METHODS, isServerNotificationMethod } from "./method-names.js";
export type { ServerNotificationMethod } from "./method-names.js";
export { EventNormalizer } from "./event-normalizer.js";
export type { NormalizerOptions } from "./event-normalizer.js";

// @codex-im/codex-runtime — public surface (T3 skeleton).
//
// Phase 1 will fill this in incrementally:
//   - T6   adds `isServerNotificationMethod` (derived from METHOD_CLASS).
//   - T7a  adds `EventNormalizer` + `event-class.ts` (METHOD_CLASS table).
//   - T7b  widens `CodexRichEvent` for turn.status mapping (turn_failed /
//          turn_interrupted) and exposes the AsyncIterable contract.
//   - T8   adds `CodexRuntime` typed wrappers + ONE-SHOT lifecycle JSDoc.
//
// Each new export here is a deliberate code-review checkpoint, mirroring
// the facade rule from @codex-im/protocol.

export type {
  CodexRichEvent,
  EventClass,
  MethodClassification,
} from "./types.js";

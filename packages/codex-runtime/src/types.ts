// Phase 1 codex-runtime — public type surface.
//
// T3 ships the skeleton types that downstream Phase 1 work consumes:
//   - T6  (method-name narrowing helpers) imports `EventClass` and
//         `MethodClassification`.
//   - T7a (EventNormalizer skeleton) imports `CodexRichEvent`.
//   - T7b (EventNormalizer edges) widens the union to add `turn_failed`
//         and `turn_interrupted` for the `turn.status` mapping in the
//         exhaustive ServerNotification switch.
//   - T8  (CodexRuntime typed wrappers) imports `CodexRichEvent` for the
//         `runtime.events()` AsyncIterable result type.
//
// Per plan §1 D5 final, the `normalizer_overflow` synthetic event carries
// a `class` discriminant so downstream consumers can distinguish:
//   - `class: "delta"`     — normal-load eviction (delta soft cap exceeded;
//                            walk-and-drop emits this synthetic IN PLACE
//                            of the dropped delta to preserve ordering).
//   - `class: "lifecycle"` — fatal-class indicator (total hard cap
//                            breached; lifecycle saturation, expected
//                            impossible under codex 0.125 — surfacing it
//                            indicates a real bug, not normal load).

/**
 * Normalized rich event emitted by the EventNormalizer's AsyncIterable.
 *
 * Each arm corresponds to either a generated `ServerNotification` method
 * (mapped explicitly in T7b's exhaustive switch) or a synthetic emitted
 * by the normalizer itself (`normalizer_overflow`, `unknown`).
 *
 * Terminal events (`turn_completed`, `thread_closed`) carry `terminal: true`
 * so consumers can pattern-match the closing frame without re-checking the
 * `type` tag against a list.
 */
export type CodexRichEvent =
  | { type: "thread_started"; threadId: string; raw: unknown }
  | { type: "thread_closed"; threadId: string; raw: unknown; terminal: true }
  | { type: "turn_started"; threadId: string; turnId: string; raw: unknown }
  | {
      type: "turn_completed";
      threadId: string;
      turnId: string;
      raw: unknown;
      terminal: true;
    }
  | {
      type: "item_started";
      threadId: string;
      turnId: string;
      itemId: string;
      raw: unknown;
    }
  | {
      type: "item_completed";
      threadId: string;
      turnId: string;
      itemId: string;
      raw: unknown;
    }
  | {
      type: "agent_message_delta";
      threadId: string;
      turnId: string;
      itemId: string;
      deltaText: string;
      raw: unknown;
    }
  | { type: "warning"; raw: unknown }
  | { type: "error"; raw: unknown }
  | {
      type: "normalizer_overflow";
      droppedCount: number;
      class: "delta" | "lifecycle";
    }
  | { type: "unknown"; method: string; params: unknown };

/**
 * Two-class backpressure model from D5 final.
 *
 * lifecycle events MUST be delivered in order. They carry state-machine
 * transitions (turn/started, item-star/requestApproval, etc.) that the
 * runtime correctness depends on. Under overflow they are NEVER dropped;
 * the normalizer instead walks the queue and evicts the oldest delta.
 *
 * delta events are the high-frequency byproduct streams (agentMessage,
 * reasoning text, command output, file change patches). They are bounded
 * with drop-oldest plus a synthetic normalizer_overflow event inserted
 * at the spliced position to preserve global ordering.
 */
export type EventClass = "lifecycle" | "delta";

/**
 * Classification table contract.
 *
 * The domain MUST equal the ServerNotification method union from
 * @codex-im/protocol. T6 + T7a co-own this: T7a authors the runtime
 * constant in event-class.ts typed as a Readonly Record over the
 * generated method union. T6 isServerNotificationMethod uses
 * Object.hasOwn(METHOD_CLASS, m) as the runtime narrowing check, so a
 * generated union arm without a classification entry causes a compile
 * error (Codex outside-voice B5 fix).
 *
 * MethodClassification keeps the Record-shaped contract available on
 * the codex-runtime public facade so future external consumers (e.g.
 * Phase 2 ChannelAdapter classification by event class for render
 * scheduling) can re-derive it.
 */
export type MethodClassification = Readonly<Record<string, EventClass>>;

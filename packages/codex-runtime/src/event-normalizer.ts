// Phase 1 codex-runtime — EventNormalizer (T7a skeleton + happy path).
//
// D5 final + Codex outside-voice B4 invariant: ONE FIFO queue. Order is
// preserved globally across both lifecycle and delta classes. Backpressure
// (T7b) is per-class via walk-and-drop, NOT via drain priority — a
// scheduler that drained lifecycle before delta would silently reorder
// retained deltas around lifecycle events, breaking the ordered-iterator
// contract.
//
// Iterator contract (codex T7a review #1 + #4 — single-consumer):
//
//   `events()` returns the SAME AsyncIterableIterator on every call.
//   The first invocation builds and caches the iterator; subsequent
//   calls return the cached instance. Two callers sharing it see
//   work-queue semantics (each event goes to whichever .next() arrives
//   first), NOT broadcast. T7b's per-thread / per-turn filtered
//   sub-iterators will be derived OVER this single stream, not as
//   parallel consumers — keeping the producer side single-output.
//
// Mapping discipline (codex T7a review #2):
//
//   Each typed case validates required fields BEFORE constructing the
//   typed event. If a load-bearing field (threadId, turnId, itemId) is
//   missing or wrong-type on the wire, the case falls through to
//   {type:"unknown", method, params, raw} rather than emitting a typed
//   event with empty-string IDs. Fail-open means "do not crash"; it
//   does NOT mean "emit corrupted typed state that downstream code
//   would treat as real."
//
// Close discipline (codex T7a review #3):
//
//   T7a implements the caller-cancellation path only — iterator.return()
//   unsubscribes from client.onNotification, drops the buffered queue,
//   and resolves any pending waiter as done. T7b will add a separate
//   source-ended path (transport.onClose) that DRAINS the queue first
//   before signaling done, so already-buffered notifications aren't
//   lost when codex exits cleanly. The two paths intentionally remain
//   separate methods.

import type {
  AppServerClient,
  JsonRpcNotification,
  Unsubscribe,
} from "@codex-im/app-server-client";
import type { CodexRichEvent } from "./types.js";

/**
 * Future-compatibility surface. T7a doesn't store these caps yet — the
 * walk-and-drop overflow logic lives in T7b. The keys are accepted on
 * construction so callers can pass them today and T7b becomes a
 * non-breaking add.
 */
export type NormalizerOptions = {
  /** T7b: when delta-class queue size exceeds this, walk and drop oldest delta. */
  deltaSoftCap?: number;
  /** T7b: total queue hard cap as a last-resort backstop. */
  totalHardCap?: number;
};

type Resolver = (ev: IteratorResult<CodexRichEvent>) => void;

export class EventNormalizer {
  // Single FIFO queue (D5 final invariant).
  #queue: CodexRichEvent[] = [];
  #waiters: Resolver[] = [];
  #closed = false;
  #unsub: Unsubscribe;
  #iterator: AsyncIterableIterator<CodexRichEvent> | null = null;

  constructor(client: AppServerClient, _opts: NormalizerOptions = {}) {
    this.#unsub = client.onNotification((msg) => this.#onNotification(msg));
  }

  /**
   * Returns the single shared AsyncIterableIterator. Calling events()
   * twice returns the SAME instance — multiple callers share one queue,
   * one waiter list, one close. Single-consumer by design (codex T7a
   * review #1 + #4).
   */
  events(): AsyncIterableIterator<CodexRichEvent> {
    if (this.#iterator !== null) return this.#iterator;
    this.#iterator = this.#asyncIterator();
    return this.#iterator;
  }

  // ─── Internals ───────────────────────────────────────────────────

  #onNotification(msg: JsonRpcNotification): void {
    if (this.#closed) return; // Caller signaled return(); ignore further events.
    const ev = this.#mapNotification(msg);
    this.#queue.push(ev);
    this.#drain();
  }

  /**
   * T7a minimal mapping. Every case validates required fields and falls
   * through to `unknownEvent(msg)` if validation fails — typed events
   * are always well-formed. T7b widens the typed surface; the
   * validation pattern stays the same.
   */
  #mapNotification(msg: JsonRpcNotification): CodexRichEvent {
    switch (msg.method) {
      case "turn/started": {
        const p = msg.params as { threadId?: unknown; turn?: { id?: unknown } };
        if (typeof p?.threadId !== "string" || typeof p?.turn?.id !== "string") {
          return unknownEvent(msg);
        }
        return { type: "turn_started", threadId: p.threadId, turnId: p.turn.id, raw: msg };
      }
      case "turn/completed": {
        const p = msg.params as { threadId?: unknown; turn?: { id?: unknown } };
        if (typeof p?.threadId !== "string" || typeof p?.turn?.id !== "string") {
          return unknownEvent(msg);
        }
        return {
          type: "turn_completed",
          threadId: p.threadId,
          turnId: p.turn.id,
          raw: msg,
          terminal: true,
        };
      }
      case "thread/started": {
        const p = msg.params as { threadId?: unknown };
        if (typeof p?.threadId !== "string") return unknownEvent(msg);
        return { type: "thread_started", threadId: p.threadId, raw: msg };
      }
      case "thread/closed": {
        const p = msg.params as { threadId?: unknown };
        if (typeof p?.threadId !== "string") return unknownEvent(msg);
        return { type: "thread_closed", threadId: p.threadId, raw: msg, terminal: true };
      }
      case "item/started": {
        const p = msg.params as {
          threadId?: unknown;
          turnId?: unknown;
          item?: { id?: unknown };
        };
        if (
          typeof p?.threadId !== "string" ||
          typeof p?.turnId !== "string" ||
          typeof p?.item?.id !== "string"
        ) {
          return unknownEvent(msg);
        }
        return {
          type: "item_started",
          threadId: p.threadId,
          turnId: p.turnId,
          itemId: p.item.id,
          raw: msg,
        };
      }
      case "item/completed": {
        const p = msg.params as {
          threadId?: unknown;
          turnId?: unknown;
          item?: { id?: unknown };
        };
        if (
          typeof p?.threadId !== "string" ||
          typeof p?.turnId !== "string" ||
          typeof p?.item?.id !== "string"
        ) {
          return unknownEvent(msg);
        }
        return {
          type: "item_completed",
          threadId: p.threadId,
          turnId: p.turnId,
          itemId: p.item.id,
          raw: msg,
        };
      }
      case "item/agentMessage/delta": {
        const p = msg.params as {
          threadId?: unknown;
          turnId?: unknown;
          itemId?: unknown;
          delta?: unknown;
        };
        if (
          typeof p?.threadId !== "string" ||
          typeof p?.turnId !== "string" ||
          typeof p?.itemId !== "string" ||
          typeof p?.delta !== "string"
        ) {
          return unknownEvent(msg);
        }
        return {
          type: "agent_message_delta",
          threadId: p.threadId,
          turnId: p.turnId,
          itemId: p.itemId,
          deltaText: p.delta,
          raw: msg,
        };
      }
      case "warning":
        return { type: "warning", raw: msg };
      case "error":
        return { type: "error", raw: msg };
      default:
        return unknownEvent(msg);
    }
  }

  #asyncIterator(): AsyncIterableIterator<CodexRichEvent> {
    const self = this;
    const it: AsyncIterableIterator<CodexRichEvent> = {
      [Symbol.asyncIterator](): AsyncIterableIterator<CodexRichEvent> {
        return it;
      },
      next(): Promise<IteratorResult<CodexRichEvent>> {
        return new Promise<IteratorResult<CodexRichEvent>>((resolve) => {
          if (self.#queue.length > 0) {
            const ev = self.#queue.shift() as CodexRichEvent;
            resolve({ value: ev, done: false });
            return;
          }
          if (self.#closed) {
            resolve({ value: undefined, done: true });
            return;
          }
          self.#waiters.push(resolve);
        });
      },
      return(): Promise<IteratorResult<CodexRichEvent>> {
        return new Promise<IteratorResult<CodexRichEvent>>((resolve) => {
          self.#cancelConsumer();
          resolve({ value: undefined, done: true });
        });
      },
    };
    return it;
  }

  #drain(): void {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      const w = this.#waiters.shift() as Resolver;
      const ev = this.#queue.shift() as CodexRichEvent;
      w({ value: ev, done: false });
    }
  }

  /**
   * Caller-cancellation path (iterator.return()). Drops the buffered
   * queue immediately. T7b will add a separate `endOfStream()` path for
   * transport.onClose that drains the queue before signaling done —
   * the two intents are split so source-ended doesn't lose buffered
   * frames.
   */
  #cancelConsumer(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsub();
    this.#queue.length = 0;
    for (const w of this.#waiters.splice(0)) {
      w({ value: undefined, done: true });
    }
  }
}

function unknownEvent(msg: JsonRpcNotification): CodexRichEvent {
  return { type: "unknown", method: msg.method, params: msg.params };
}

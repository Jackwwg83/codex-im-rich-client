// Phase 1 codex-runtime — EventNormalizer (T7a skeleton + happy path).
//
// D5 final + Codex outside-voice B4 invariant: ONE FIFO queue. Order is
// preserved globally across both lifecycle and delta classes. Backpressure
// is per-class via walk-and-drop (T7b lands the eviction logic), NOT via
// drain priority — a scheduler that drained lifecycle before delta would
// silently reorder retained deltas around lifecycle events, breaking the
// ordered-iterator contract.
//
// What T7a covers:
//   - bare construction subscribes to client.onNotification
//   - happy-path mapping for the load-bearing arms (turn/{started,
//     completed}, item/{started,completed}, item/agentMessage/delta,
//     warning, error, thread/{started,closed})
//   - global FIFO order
//   - late-subscriber buffering
//   - {type:"unknown"} fall-through for unhandled-but-known methods AND
//     methods missing from METHOD_CLASS — the typed default branch keeps
//     the runtime robust before T7b widens
//   - clean iterator.return()  — unsubscribes from client.onNotification,
//     drops queued events, and resolves any pending waiter as done
//
// What T7b will land on top of this skeleton:
//   - exhaustive ServerNotification union switch (with the mapping
//     covering the remaining 50+ methods, including the
//     turn.status -> turn_completed | turn_failed | turn_interrupted
//     mapping)
//   - delta-class soft cap with walk-and-drop overflow
//   - lifecycle hard-cap synthetic (catastrophic indicator)
//   - terminal-state semantics (currently the iterator stays open
//     across turn/completed; T7b decides whether the global stream
//     closes on transport.onClose only, with per-turn filtered
//     sub-iterators closing at terminal events)
//   - fixture replay tests over phase1-richer-turn-event-stream.jsonl

import type {
  AppServerClient,
  JsonRpcNotification,
  Unsubscribe,
} from "@codex-im/app-server-client";
import type { CodexRichEvent } from "./types.js";

export type NormalizerOptions = {
  /**
   * T7b: when the bounded delta queue exceeds this, walk and drop the
   * oldest delta. T7a happy-path tests do not exercise overflow yet,
   * so the cap is unused here.
   */
  deltaSoftCap?: number;
  /**
   * T7b: total queue hard cap as a last-resort backstop. Lifecycle
   * saturation should be impossible under codex 0.125; if it happens,
   * a fatal-class normalizer_overflow synthetic is emitted.
   */
  totalHardCap?: number;
};

const DEFAULT_DELTA_SOFT_CAP = 4096;
const DEFAULT_TOTAL_HARD_CAP = 16384;

type Resolver = (ev: IteratorResult<CodexRichEvent>) => void;

export class EventNormalizer {
  // Single FIFO queue (D5 final invariant). T7a appends here and never
  // reorders; T7b adds class-aware walk-and-drop that splices in place
  // so non-evicted events keep their relative order.
  #queue: CodexRichEvent[] = [];
  #waiters: Resolver[] = [];
  #closed = false;
  #unsub: Unsubscribe;
  // T7b uses these fields:
  readonly #deltaSoftCap: number;
  readonly #totalHardCap: number;

  constructor(client: AppServerClient, opts: NormalizerOptions = {}) {
    this.#deltaSoftCap = opts.deltaSoftCap ?? DEFAULT_DELTA_SOFT_CAP;
    this.#totalHardCap = opts.totalHardCap ?? DEFAULT_TOTAL_HARD_CAP;
    void this.#deltaSoftCap;
    void this.#totalHardCap;
    this.#unsub = client.onNotification((msg) => this.#onNotification(msg));
  }

  /**
   * AsyncIterable surface. The iterator stays open across notifications
   * until either the caller invokes return() / breaks out of the
   * for-await loop, or T7b lands the transport.onClose-driven close
   * (currently a no-op — the iterator just keeps yielding).
   */
  events(): AsyncIterable<CodexRichEvent> {
    return { [Symbol.asyncIterator]: () => this.#asyncIterator() };
  }

  // ─── Internals ───────────────────────────────────────────────────

  #onNotification(msg: JsonRpcNotification): void {
    if (this.#closed) return; // Caller signaled return(); ignore further events.
    const ev = this.#mapNotification(msg);
    this.#queue.push(ev);
    this.#drain();
  }

  /**
   * T7a minimal mapping. Covers the load-bearing arms used by the
   * happy-path tests + the captured T4 fixture. Everything else falls
   * through to {type:"unknown", method, params} — T7b widens.
   */
  #mapNotification(msg: JsonRpcNotification): CodexRichEvent {
    switch (msg.method) {
      case "turn/started": {
        const p = msg.params as { threadId?: unknown; turn?: { id?: unknown } };
        return {
          type: "turn_started",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          turnId: typeof p?.turn?.id === "string" ? p.turn.id : "",
          raw: msg,
        };
      }
      case "turn/completed": {
        const p = msg.params as { threadId?: unknown; turn?: { id?: unknown } };
        return {
          type: "turn_completed",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          turnId: typeof p?.turn?.id === "string" ? p.turn.id : "",
          raw: msg,
          terminal: true,
        };
      }
      case "thread/started": {
        const p = msg.params as { threadId?: unknown };
        return {
          type: "thread_started",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          raw: msg,
        };
      }
      case "thread/closed": {
        const p = msg.params as { threadId?: unknown };
        return {
          type: "thread_closed",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          raw: msg,
          terminal: true,
        };
      }
      case "item/started": {
        const p = msg.params as {
          threadId?: unknown;
          turnId?: unknown;
          item?: { id?: unknown };
        };
        return {
          type: "item_started",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          turnId: typeof p?.turnId === "string" ? p.turnId : "",
          itemId: typeof p?.item?.id === "string" ? p.item.id : "",
          raw: msg,
        };
      }
      case "item/completed": {
        const p = msg.params as {
          threadId?: unknown;
          turnId?: unknown;
          item?: { id?: unknown };
        };
        return {
          type: "item_completed",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          turnId: typeof p?.turnId === "string" ? p.turnId : "",
          itemId: typeof p?.item?.id === "string" ? p.item.id : "",
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
        return {
          type: "agent_message_delta",
          threadId: typeof p?.threadId === "string" ? p.threadId : "",
          turnId: typeof p?.turnId === "string" ? p.turnId : "",
          itemId: typeof p?.itemId === "string" ? p.itemId : "",
          deltaText: typeof p?.delta === "string" ? p.delta : "",
          raw: msg,
        };
      }
      case "warning":
        return { type: "warning", raw: msg };
      case "error":
        return { type: "error", raw: msg };
      default:
        return { type: "unknown", method: msg.method, params: msg.params };
    }
  }

  #asyncIterator(): AsyncIterator<CodexRichEvent> {
    return {
      next: () =>
        new Promise<IteratorResult<CodexRichEvent>>((resolve) => {
          if (this.#queue.length > 0) {
            const ev = this.#queue.shift() as CodexRichEvent;
            resolve({ value: ev, done: false });
            return;
          }
          if (this.#closed) {
            resolve({ value: undefined, done: true });
            return;
          }
          this.#waiters.push(resolve);
        }),
      return: () =>
        new Promise<IteratorResult<CodexRichEvent>>((resolve) => {
          this.#close();
          resolve({ value: undefined, done: true });
        }),
    };
  }

  #drain(): void {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      const w = this.#waiters.shift() as Resolver;
      const ev = this.#queue.shift() as CodexRichEvent;
      w({ value: ev, done: false });
    }
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsub();
    this.#queue.length = 0;
    for (const w of this.#waiters.splice(0)) {
      w({ value: undefined, done: true });
    }
  }
}

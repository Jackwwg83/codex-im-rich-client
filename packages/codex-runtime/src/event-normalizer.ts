// Phase 1 codex-runtime — EventNormalizer (T7a + T7b-1 + T7b-2).
//
// D5 final + Codex outside-voice B4 invariant: ONE FIFO queue. Order is
// preserved globally across both lifecycle and delta classes. Backpressure
// is per-class via walk-and-drop, NOT via drain priority — a scheduler
// that drained lifecycle before delta would silently reorder retained
// deltas around lifecycle events, breaking the ordered-iterator contract.
//
// Iterator contract (codex T7a review #1 + #4 — single-consumer):
//
//   `events()` returns the SAME AsyncIterableIterator on every call.
//   The first invocation builds and caches the iterator; subsequent
//   calls return the cached instance. Two callers sharing it see
//   work-queue semantics (each event goes to whichever .next() arrives
//   first), NOT broadcast.
//
// Mapping discipline (codex T7a review #2):
//
//   Each typed case validates required fields BEFORE constructing the
//   typed event. If a load-bearing field (threadId, turnId, itemId) is
//   missing or wrong-type on the wire, the case falls through to
//   `unknownEvent(msg)`. Fail-open means "do not crash"; it does NOT
//   mean "emit corrupted typed state".
//
// Close discipline (codex T7a review #3 — split caller-cancel from
// source-ended):
//
//   `iterator.return()`  →  `#cancelConsumer()` — drops the buffered
//                            queue immediately. Consumer cancelled.
//   `endOfStream()`      →  source ended cleanly (T11b's transport.onClose
//                            path). Stops new events but DRAINS the queue
//                            naturally — pending consumers see every
//                            already-buffered event before {done:true}.
//
// Exhaustive switch (T7b-1):
//
//   The mapping switch covers EVERY method in the generated
//   ServerNotification union. Methods without a typed CodexRichEvent
//   arm fall through to `unknownEvent(msg)` via case-fall-through
//   grouping; the `default` branch's `const _exhaustive: never = method`
//   guards against silent fall-through if codex adds a new arm.
//
// Backpressure (T7b-2 — walk-and-drop):
//
//   Each queue entry is wrapped as { ev, cls } so walk-and-drop can
//   identify delta-class entries without re-classifying. On enqueue:
//
//     1. If new event is delta-class AND #deltaCount >= deltaSoftCap:
//        scan from queue head for the OLDEST delta-class entry, splice
//        it out, and insert a `{type:"normalizer_overflow", class:"delta"}`
//        synthetic AT THE SAME POSITION. This preserves global FIFO order
//        — consumers see the gap exactly where the dropped event was.
//        The synthetic itself is class:"lifecycle" (it's not droppable).
//
//     2. Push the new event at the tail.
//
//     3. If queue length still exceeds totalHardCap (lifecycle
//        saturation — should be impossible in practice under codex
//        0.125), drop the oldest entry regardless of class and replace
//        with a fatal-class `{type:"normalizer_overflow", class:"lifecycle"}`
//        synthetic. This branch indicates a runtime bug, not normal load.
//
//   Lifecycle-class events are NEVER dropped via walk-and-drop. The
//   D5 invariant: lifecycle events are state-machine transitions; the
//   runtime correctness depends on observing them.

import type {
  AppServerClient,
  JsonRpcNotification,
  Unsubscribe,
} from "@codex-im/app-server-client";
import { classifyMethod } from "./event-class.js";
import { type ServerNotificationMethod, isServerNotificationMethod } from "./method-names.js";
import type { CodexRichEvent, EventClass } from "./types.js";

export type NormalizerOptions = {
  /**
   * Delta-class queue soft cap. When a new delta arrives and the count
   * of delta-class entries already in the queue is ≥ this cap, the
   * normalizer walks the queue, splices out the OLDEST delta, and
   * inserts a `normalizer_overflow` synthetic at the same position.
   * Default 4096.
   */
  deltaSoftCap?: number;
  /**
   * Total queue hard cap as a last-resort backstop. If queue length
   * exceeds this after walk-and-drop has run, the normalizer drops
   * the oldest entry regardless of class and emits a fatal-class
   * synthetic. Should be impossible in practice; if it fires, a
   * runtime bug is responsible. Default 16384.
   */
  totalHardCap?: number;
};

const DEFAULT_DELTA_SOFT_CAP = 4096;
const DEFAULT_TOTAL_HARD_CAP = 16384;

/**
 * Sanitize a public cap option (codex T7b review #2). Rejects NaN,
 * Infinity, non-integer, and < 1 — all of which break the comparison
 * semantics or leave the queue effectively unbounded. Falls back to
 * the default on bad input rather than throwing, since these caps are
 * non-load-bearing operational tuning.
 */
function sanitizeCap(v: number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v)) return fallback;
  if (v < 1) return fallback;
  if (v > Number.MAX_SAFE_INTEGER) return fallback;
  return v;
}

type Resolver = (ev: IteratorResult<CodexRichEvent>) => void;
type QueueEntry = { ev: CodexRichEvent; cls: EventClass };

export class EventNormalizer {
  // Single FIFO queue (D5 final invariant). Each entry wraps the rich
  // event with its backpressure class so walk-and-drop can identify
  // delta entries without re-classifying.
  #queue: QueueEntry[] = [];
  #waiters: Resolver[] = [];
  #cancelled = false;
  #endOfStream = false;
  #unsub: Unsubscribe;
  #iterator: AsyncIterableIterator<CodexRichEvent> | null = null;

  // Backpressure accounting (T7b-2).
  readonly #deltaSoftCap: number;
  readonly #totalHardCap: number;
  #deltaCount = 0;
  #droppedDeltaCount = 0;
  #droppedLifecycleCount = 0;

  constructor(client: AppServerClient, opts: NormalizerOptions = {}) {
    this.#deltaSoftCap = sanitizeCap(opts.deltaSoftCap, DEFAULT_DELTA_SOFT_CAP);
    this.#totalHardCap = sanitizeCap(opts.totalHardCap, DEFAULT_TOTAL_HARD_CAP);
    this.#unsub = client.onNotification((msg) => this.#onNotification(msg));
  }

  /**
   * Returns the single shared AsyncIterableIterator. Calling events()
   * twice returns the SAME instance — multiple callers share one queue,
   * one waiter list, one close.
   */
  events(): AsyncIterableIterator<CodexRichEvent> {
    if (this.#iterator !== null) return this.#iterator;
    this.#iterator = this.#asyncIterator();
    return this.#iterator;
  }

  /**
   * Source-ended path. Called by T11b's supervisor on transport.onClose.
   * Stops new events but does NOT drop the queue — pending consumers
   * see every already-buffered event before getting {done:true}. If
   * called when the queue is empty, any parked .next() resolves done
   * immediately.
   *
   * Idempotent. No-op if `iterator.return()` already cancelled the
   * consumer (cancellation wins; no point delivering buffered events
   * to a consumer that explicitly stopped pulling).
   */
  endOfStream(): void {
    if (this.#cancelled || this.#endOfStream) return;
    this.#endOfStream = true;
    this.#unsub();
    if (this.#queue.length === 0) {
      for (const w of this.#waiters.splice(0)) {
        w({ value: undefined, done: true });
      }
    }
  }

  /**
   * Enqueue daemon-synthesized terminal events and then end the stream. This
   * preserves the normal iterator contract: buffered events drain first, the
   * synthetic events follow in caller order, and only then does `.next()` yield
   * `{done:true}`. Calling after cancellation or a prior stream end is a no-op.
   */
  endWithSynthetic(events: readonly CodexRichEvent[]): void {
    if (this.#cancelled || this.#endOfStream) return;
    for (const ev of events) {
      this.#enqueue(ev, "lifecycle");
    }
    this.#drain();
    this.endOfStream();
  }

  // ─── Internals ───────────────────────────────────────────────────

  #onNotification(msg: JsonRpcNotification): void {
    if (this.#cancelled || this.#endOfStream) return;
    const ev = this.#mapNotification(msg);
    const cls = this.#classifyForBackpressure(msg.method);
    this.#enqueue(ev, cls);
    this.#drain();
  }

  /**
   * Per-method backpressure classification. Uses METHOD_CLASS for
   * known methods; unknown methods default to lifecycle so we never
   * overflow them under burst (an unrecognized burst is already
   * abnormal — drop it on the lifecycle hard cap, not the delta soft
   * cap).
   */
  #classifyForBackpressure(method: string): EventClass {
    if (isServerNotificationMethod(method)) {
      return classifyMethod(method);
    }
    return "lifecycle";
  }

  /**
   * Walk-and-drop enqueue (D5 final / Codex B4).
   *
   *   1. If new event is delta and we're at the soft cap, walk forward
   *      for the oldest delta in the queue, splice it out, and insert
   *      a `normalizer_overflow{class:"delta"}` synthetic at the same
   *      position. Order preserved.
   *   2. Push the new event.
   *   3. If total length exceeds the hard cap (lifecycle saturation),
   *      drop oldest entry regardless of class with
   *      `normalizer_overflow{class:"lifecycle"}` at the front.
   */
  #enqueue(ev: CodexRichEvent, cls: EventClass): void {
    if (cls === "delta" && this.#deltaCount >= this.#deltaSoftCap) {
      for (let i = 0; i < this.#queue.length; i++) {
        const entry = this.#queue[i];
        if (entry?.cls === "delta") {
          this.#droppedDeltaCount++;
          this.#queue.splice(i, 1, {
            ev: {
              type: "normalizer_overflow",
              droppedCount: this.#droppedDeltaCount,
              class: "delta",
            },
            cls: "lifecycle",
          });
          this.#deltaCount--;
          break;
        }
      }
    }

    this.#queue.push({ ev, cls });
    if (cls === "delta") this.#deltaCount++;

    // Hard-cap backstop. Fires when the queue exceeds totalHardCap
    // after walk-and-drop has run. Two scenarios reach this branch
    // (codex T7b review):
    //
    //   1. Lifecycle saturation — a torrent of lifecycle events under
    //      load codex 0.125 doesn't actually produce. Catastrophic;
    //      indicates a runtime bug.
    //   2. Pure delta overload — sustained delta-class enqueueing at
    //      a rate that lets walk-and-drop synthetics accumulate. The
    //      synthetics themselves are class:"lifecycle" (they're not
    //      droppable by walk-and-drop), so they pile up until the
    //      hard cap fires.
    //
    // Drop oldest entries until under cap, then emit ONE synthetic
    // indicating the round's drop count. Queue may briefly sit at
    // hardCap+1 because of the synthetic; that's bounded — the next
    // push runs this block again and drops the synthetic alongside
    // the next oldest.
    //
    // Earlier T7b-2 attempt looped on `shift+unshift` per drop, which
    // turns into an infinite loop (each iteration nets +0 queue
    // size). The fix is to drain and synthesize OUTSIDE the loop.
    //
    // Codex T7b review #1: the count must NOT include prior overflow
    // synthetics that get re-dropped on subsequent overflows —
    // otherwise droppedCount grows by 2 per real entry lost (one for
    // the synthetic, one for the real entry). Filter the synthetic
    // out of the increment.
    if (this.#queue.length > this.#totalHardCap) {
      let droppedThisRound = 0;
      while (this.#queue.length > this.#totalHardCap) {
        const oldest = this.#queue.shift();
        if (oldest === undefined) break;
        if (oldest.cls === "delta") this.#deltaCount--;
        if (oldest.ev.type !== "normalizer_overflow") {
          droppedThisRound++;
        }
      }
      if (droppedThisRound > 0) {
        this.#droppedLifecycleCount += droppedThisRound;
        this.#queue.unshift({
          ev: {
            type: "normalizer_overflow",
            droppedCount: this.#droppedLifecycleCount,
            class: "lifecycle",
          },
          cls: "lifecycle",
        });
      }
    }
  }

  /**
   * Exhaustive map from JsonRpcNotification (whose `.method` is `string`)
   * to CodexRichEvent. Validates required fields on each typed case;
   * non-typed methods fall through to `unknownEvent(msg)` via
   * case-fall-through grouping. The `default` branch's never-cast catches
   * any future codex method we forgot to enumerate.
   */
  #mapNotification(msg: JsonRpcNotification): CodexRichEvent {
    if (!isServerNotificationMethod(msg.method)) {
      return unknownEvent(msg);
    }
    const method: ServerNotificationMethod = msg.method;

    switch (method) {
      // ─── Typed mapping (T7a + T7b-1 turn.status discrimination) ─

      case "turn/started": {
        const p = msg.params as { threadId?: unknown; turn?: { id?: unknown } };
        if (typeof p?.threadId !== "string" || typeof p?.turn?.id !== "string") {
          return unknownEvent(msg);
        }
        return { type: "turn_started", threadId: p.threadId, turnId: p.turn.id, raw: msg };
      }
      case "turn/completed": {
        // T7b-1: branch on turn.status.
        // TurnStatus = "completed" | "interrupted" | "failed" | "inProgress".
        // inProgress on a turn/completed wire frame is unusual; fall through
        // to unknown rather than guess the intent.
        const p = msg.params as {
          threadId?: unknown;
          turn?: { id?: unknown; status?: unknown };
        };
        if (typeof p?.threadId !== "string" || typeof p?.turn?.id !== "string") {
          return unknownEvent(msg);
        }
        const threadId = p.threadId;
        const turnId = p.turn.id;
        const status = p.turn.status;
        if (status === "completed") {
          return { type: "turn_completed", threadId, turnId, raw: msg, terminal: true };
        }
        if (status === "failed") {
          return { type: "turn_failed", threadId, turnId, raw: msg, terminal: true };
        }
        if (status === "interrupted") {
          return { type: "turn_interrupted", threadId, turnId, raw: msg, terminal: true };
        }
        return unknownEvent(msg);
      }
      case "thread/started": {
        // Wire shape (verified against generated
        // ThreadStartedNotification = { thread: Thread }):
        // threadId is nested under params.thread.id, NOT at top level.
        const p = msg.params as { thread?: { id?: unknown } };
        if (typeof p?.thread?.id !== "string") return unknownEvent(msg);
        return { type: "thread_started", threadId: p.thread.id, raw: msg };
      }
      case "thread/closed": {
        // Wire shape (verified against generated
        // ThreadClosedNotification = { threadId: string }):
        // threadId is at the top level, unlike thread/started.
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

      // ─── Methods without a typed arm (T7b-1: explicit case-fall-through
      //     to enforce exhaustiveness; downstream consumers can still
      //     branch on raw.method if they care). T8/Phase 2/Phase 3 will
      //     widen the typed surface as the runtime needs more arms.) ───

      // account/* — operational telemetry (login, rate limits, profile).
      case "account/login/completed":
      case "account/rateLimits/updated":
      case "account/updated":
      // app/* — config changes.
      case "app/list/updated":
      // command/* — legacy v1 command exec stream.
      case "command/exec/outputDelta":
      // config / deprecation / fs.
      case "configWarning":
      case "deprecationNotice":
      case "externalAgentConfig/import/completed":
      case "fs/changed":
      // fuzzyFileSearch — experimental, out of Phase 1 scope.
      case "fuzzyFileSearch/sessionCompleted":
      case "fuzzyFileSearch/sessionUpdated":
      // guardian — guardian/policy warnings (similar to warning but
      // codex-emitted; if Phase 2 wants typed guardian events, widen here).
      case "guardianWarning":
      // hooks — codex-side lifecycle hooks.
      case "hook/completed":
      case "hook/started":
      // item/autoApprovalReview — codex's auto-approval reviewer item.
      case "item/autoApprovalReview/completed":
      case "item/autoApprovalReview/started":
      // item/commandExecution — typed delta arms for shell exec output;
      // T8/render layer will care, T7b-1 leaves them as unknown.
      case "item/commandExecution/outputDelta":
      case "item/commandExecution/terminalInteraction":
      // item/fileChange — file change deltas + patch updates; same.
      case "item/fileChange/outputDelta":
      case "item/fileChange/patchUpdated":
      // item/mcpToolCall — MCP tool call progress.
      case "item/mcpToolCall/progress":
      // item/plan — plan-update deltas.
      case "item/plan/delta":
      // item/reasoning — chain-of-thought summary + text deltas.
      case "item/reasoning/summaryPartAdded":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      // mcpServer — MCP startup + oauth.
      case "mcpServer/oauthLogin/completed":
      case "mcpServer/startupStatus/updated":
      // model — codex's per-turn model events.
      case "model/rerouted":
      case "model/verification":
      // rawResponseItem — raw underlying model response items.
      case "rawResponseItem/completed":
      // serverRequest/resolved — fires after we respond to a server-initiated
      // request. T9b's ApprovalBroker may want to consume this directly.
      case "serverRequest/resolved":
      // skills — skill catalog churn.
      case "skills/changed":
      // thread/* — thread admin events; not turn lifecycle.
      case "thread/archived":
      case "thread/compacted":
      case "thread/goal/cleared":
      case "thread/goal/updated":
      case "thread/name/updated":
      case "thread/status/changed":
      case "thread/tokenUsage/updated":
      case "thread/unarchived":
      // thread/realtime/* — voice/realtime API; out of Phase 1 scope.
      case "thread/realtime/closed":
      case "thread/realtime/error":
      case "thread/realtime/itemAdded":
      case "thread/realtime/outputAudio/delta":
      case "thread/realtime/sdp":
      case "thread/realtime/started":
      case "thread/realtime/transcript/delta":
      case "thread/realtime/transcript/done":
      // turn/* — diff and plan updates (per-turn aggregates).
      case "turn/diff/updated":
      case "turn/plan/updated":
      // remoteControl — added codex 0.128.
      case "remoteControl/status/changed":
      // windows-specific.
      case "windows/worldWritableWarning":
      case "windowsSandbox/setupCompleted":
        return unknownEvent(msg);

      default: {
        // Exhaustiveness guard.
        const _exhaustive: never = method;
        void _exhaustive;
        return unknownEvent(msg);
      }
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
          const entry = self.#dequeue();
          if (entry !== undefined) {
            resolve({ value: entry.ev, done: false });
            return;
          }
          if (self.#cancelled || self.#endOfStream) {
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

  /**
   * Dequeue the head entry, maintaining the delta count. Used by both
   * the iterator's .next() and #drain so the count is always correct.
   */
  #dequeue(): QueueEntry | undefined {
    const entry = this.#queue.shift();
    if (entry?.cls === "delta") this.#deltaCount--;
    return entry;
  }

  #drain(): void {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      const w = this.#waiters.shift() as Resolver;
      const entry = this.#dequeue() as QueueEntry;
      w({ value: entry.ev, done: false });
    }
  }

  /**
   * Caller-cancellation path (iterator.return()). Drops the buffered
   * queue immediately. Idempotent.
   */
  #cancelConsumer(): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    if (!this.#endOfStream) {
      this.#unsub();
    }
    this.#queue.length = 0;
    this.#deltaCount = 0;
    for (const w of this.#waiters.splice(0)) {
      w({ value: undefined, done: true });
    }
  }
}

function unknownEvent(msg: JsonRpcNotification): CodexRichEvent {
  return { type: "unknown", method: msg.method, params: msg.params };
}

// Phase 1 codex-runtime — EventNormalizer (T7a + T7b-1).
//
// D5 final + Codex outside-voice B4 invariant: ONE FIFO queue. Order is
// preserved globally across both lifecycle and delta classes. Backpressure
// (T7b-2) is per-class via walk-and-drop, NOT via drain priority — a
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

import type {
  AppServerClient,
  JsonRpcNotification,
  Unsubscribe,
} from "@codex-im/app-server-client";
import { type ServerNotificationMethod, isServerNotificationMethod } from "./method-names.js";
import type { CodexRichEvent } from "./types.js";

/**
 * Future-compatibility surface. T7a doesn't store these caps yet — the
 * walk-and-drop overflow logic lives in T7b-2. The keys are accepted on
 * construction so callers can pass them today and T7b-2 becomes a
 * non-breaking add.
 */
export type NormalizerOptions = {
  /** T7b-2: when delta-class queue size exceeds this, walk and drop oldest delta. */
  deltaSoftCap?: number;
  /** T7b-2: total queue hard cap as a last-resort backstop. */
  totalHardCap?: number;
};

type Resolver = (ev: IteratorResult<CodexRichEvent>) => void;

export class EventNormalizer {
  // Single FIFO queue (D5 final invariant).
  #queue: CodexRichEvent[] = [];
  #waiters: Resolver[] = [];
  #cancelled = false;
  #endOfStream = false;
  #unsub: Unsubscribe;
  #iterator: AsyncIterableIterator<CodexRichEvent> | null = null;

  constructor(client: AppServerClient, _opts: NormalizerOptions = {}) {
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
    // Waiters can only exist when the queue is empty (drain() empties
    // them eagerly on enqueue). With endOfStream + no events ever
    // again, any waiter must resolve as done.
    if (this.#queue.length === 0) {
      for (const w of this.#waiters.splice(0)) {
        w({ value: undefined, done: true });
      }
    }
  }

  // ─── Internals ───────────────────────────────────────────────────

  #onNotification(msg: JsonRpcNotification): void {
    if (this.#cancelled || this.#endOfStream) return;
    const ev = this.#mapNotification(msg);
    this.#queue.push(ev);
    this.#drain();
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
    // Narrowed to ServerNotificationMethod — switch is exhaustive.
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
      // windows-specific.
      case "windows/worldWritableWarning":
      case "windowsSandbox/setupCompleted":
        return unknownEvent(msg);

      default: {
        // Exhaustiveness guard. If a future codex upgrade adds a new
        // ServerNotification arm, METHOD_CLASS would force a compile
        // error in event-class.ts; this branch catches the case where
        // the maintainer added the entry to METHOD_CLASS but forgot
        // to also enumerate it in this switch.
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
          if (self.#queue.length > 0) {
            const ev = self.#queue.shift() as CodexRichEvent;
            resolve({ value: ev, done: false });
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

  #drain(): void {
    while (this.#queue.length > 0 && this.#waiters.length > 0) {
      const w = this.#waiters.shift() as Resolver;
      const ev = this.#queue.shift() as CodexRichEvent;
      w({ value: ev, done: false });
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
    for (const w of this.#waiters.splice(0)) {
      w({ value: undefined, done: true });
    }
  }
}

function unknownEvent(msg: JsonRpcNotification): CodexRichEvent {
  return { type: "unknown", method: msg.method, params: msg.params };
}

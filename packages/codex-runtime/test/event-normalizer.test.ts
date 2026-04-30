// T7a (Phase 1, P1.3): EventNormalizer skeleton + happy path.
//
// Single FIFO queue per D5 final + Codex outside-voice B4. T7b adds:
//   - walk-and-drop overflow with global-ordering-preserving eviction
//   - exhaustive ServerNotification union switch
//   - turn.status -> turn_completed | turn_failed | turn_interrupted
//   - terminal-state semantics for the iterator
//   - fixture replay against phase1-richer-turn-event-stream.jsonl
//
// T7a covers:
//   - bare construction subscribes to client.onNotification
//   - happy-path mapping for turn/{started,completed},
//     item/{started,completed}, item/agentMessage/delta, warning, error,
//     thread/{started,closed}
//   - global FIFO order preserved across all delivered events
//   - late-subscriber semantics: events arriving before iteration starts
//     are buffered and yielded in order on first .next()
//   - unhandled-but-known method falls through to {type:"unknown"}
//     (T7b lands the exhaustive switch for the rest)
//   - iterator.return() closes the iterator cleanly
//   - constructor unsubscribes from client.onNotification on iterator close

import { AppServerClient } from "@codex-im/app-server-client";
import { FakeAppServer, loadFixture } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { EventNormalizer, type NormalizerOptions } from "../src/event-normalizer.js";
import type { CodexRichEvent } from "../src/types.js";

const SILENT = pino({ level: "silent" });

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  normalizer: EventNormalizer;
}

function harness(opts: NormalizerOptions = {}): Harness {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide, { logger: SILENT });
  void client.start();
  const normalizer = new EventNormalizer(client, opts);
  return { fake, client, normalizer };
}

async function teardown(h: Harness): Promise<void> {
  await h.client.stop();
  await h.fake.stop();
}

describe("EventNormalizer happy path (T7a)", () => {
  it("yields turn/started as turn_started", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("turn_started");
    if (ev.type === "turn_started") {
      expect(ev.threadId).toBe("thread-1");
      expect(ev.turnId).toBe("turn-1");
    }
    await teardown(h);
  });

  it("yields turn/completed as turn_completed with terminal: true", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed", durationMs: 5000 },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("turn_completed");
    if (ev.type === "turn_completed") {
      expect(ev.threadId).toBe("thread-1");
      expect(ev.turnId).toBe("turn-1");
      expect(ev.terminal).toBe(true);
    }
    await teardown(h);
  });

  it("yields item/started + item/completed", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/started", {
      item: { type: "agentMessage", id: "msg-1" },
      threadId: "thread-1",
      turnId: "turn-1",
    });
    h.fake.emitNotification("item/completed", {
      item: { type: "agentMessage", id: "msg-1" },
      threadId: "thread-1",
      turnId: "turn-1",
    });

    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    expect(a.type).toBe("item_started");
    expect(b.type).toBe("item_completed");
    if (a.type === "item_started" && b.type === "item_completed") {
      expect(a.itemId).toBe("msg-1");
      expect(b.itemId).toBe("msg-1");
      expect(a.threadId).toBe("thread-1");
      expect(b.turnId).toBe("turn-1");
    }
    await teardown(h);
  });

  it("yields item/agentMessage/delta as agent_message_delta with deltaText", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: "hello",
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("agent_message_delta");
    if (ev.type === "agent_message_delta") {
      expect(ev.deltaText).toBe("hello");
      expect(ev.itemId).toBe("msg-1");
    }
    await teardown(h);
  });

  it("yields thread/started + thread/closed (closed is terminal)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Wire shape: thread/started has params.thread.id (nested);
    // thread/closed has params.threadId (top-level). Verified against
    // generated v2 schemas.
    h.fake.emitNotification("thread/started", { thread: { id: "thread-1" } });
    h.fake.emitNotification("thread/closed", { threadId: "thread-1" });

    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    expect(a.type).toBe("thread_started");
    if (a.type === "thread_started") expect(a.threadId).toBe("thread-1");
    expect(b.type).toBe("thread_closed");
    if (b.type === "thread_closed") expect(b.terminal).toBe(true);
    await teardown(h);
  });

  it("yields warning + error", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("warning", { message: "x" });
    h.fake.emitNotification("error", { code: 1 });

    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    expect(a.type).toBe("warning");
    expect(b.type).toBe("error");
    await teardown(h);
  });

  it("falls through to {type:'unknown'} for an unhandled-but-known method (T7b will widen)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // model/rerouted is in METHOD_CLASS but T7a's minimal mapping does
    // not produce a typed arm for it — it should land as `unknown`
    // (T7b's exhaustive switch will widen the typed surface).
    h.fake.emitNotification("model/rerouted", { from: "x", to: "y" });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    if (ev.type === "unknown") expect(ev.method).toBe("model/rerouted");
    await teardown(h);
  });

  it("falls through to {type:'unknown'} for a method not in METHOD_CLASS", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("future/never/seen", { a: 1 });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    if (ev.type === "unknown") {
      expect(ev.method).toBe("future/never/seen");
      expect(ev.params).toEqual({ a: 1 });
    }
    await teardown(h);
  });

  it("preserves global FIFO order across mixed lifecycle + delta events (D5 final invariant)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    h.fake.emitNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: "1",
    });
    h.fake.emitNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: "2",
    });
    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    });

    const types: string[] = [];
    for (let i = 0; i < 4; i++) {
      types.push(((await it.next()).value as CodexRichEvent).type);
    }
    expect(types).toEqual([
      "turn_started",
      "agent_message_delta",
      "agent_message_delta",
      "turn_completed",
    ]);
    await teardown(h);
  });

  it("late subscriber sees events buffered before iteration started", async () => {
    const h = harness();

    // Emit BEFORE asking for the iterator — events should buffer.
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    });

    // queueMicrotask delivery from FakeAppServer fires asynchronously,
    // so we await one microtask cycle before iteration to let both
    // notifications land in the queue.
    await new Promise<void>((r) => queueMicrotask(r));

    const it = h.normalizer.events()[Symbol.asyncIterator]();
    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    expect(a.type).toBe("turn_started");
    expect(b.type).toBe("turn_completed");
    await teardown(h);
  });

  it("iterator.return() closes the iterator cleanly", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });

    const a = await it.next();
    expect(a.done).toBe(false);

    // Caller signals "stop pulling".
    expect(it.return).toBeDefined();
    const closed = await it.return?.();
    expect(closed?.done).toBe(true);

    // Subsequent next() must report done.
    const b = await it.next();
    expect(b.done).toBe(true);

    await teardown(h);
  });

  it("after iterator close, further notifications are not buffered (no leak)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();
    await it.return?.();

    // Notification arriving after close must not throw and must not
    // accumulate (the caller already dropped its handle on the
    // normalizer; backpressure here would just be a memory leak).
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    await new Promise<void>((r) => queueMicrotask(r));

    // Iteration is already done; .next() reports done on demand.
    const ev = await it.next();
    expect(ev.done).toBe(true);
    await teardown(h);
  });

  // ─── Codex T7a review #5 — cancellation race + FIFO + malformed ──

  it("a pending next() resolves done after return() is called", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Suspend a next() — no events yet, so it parks on the waiter list.
    const pending = it.next();
    // Immediately request cancellation. The pending Promise must resolve
    // with done:true rather than hanging forever.
    await it.return?.();

    const result = await pending;
    expect(result.done).toBe(true);
    await teardown(h);
  });

  it("two queued events with two waiters preserve FIFO drain order", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Two suspended next() calls in flight — both park on the waiter list.
    const p1 = it.next();
    const p2 = it.next();

    // Two events arrive — drain should resolve in arrival order to
    // arrival-order waiters (FIFO across both axes).
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    });

    const r1 = await p1;
    const r2 = await p2;
    expect((r1.value as CodexRichEvent).type).toBe("turn_started");
    expect((r2.value as CodexRichEvent).type).toBe("turn_completed");
    await teardown(h);
  });

  it("malformed turn/started (missing turn.id) falls through to unknown, not turn_started with empty IDs", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Wire frame missing the required `turn.id` — must NOT produce a
    // turn_started event with an empty turnId, which downstream state
    // code could mistake for a real turn (codex T7a review #2).
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { items: [], status: "inProgress" /* id missing */ },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    if (ev.type === "unknown") {
      expect(ev.method).toBe("turn/started");
    }
    await teardown(h);
  });

  it("malformed item/started (non-string itemId) falls through to unknown", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { type: "agentMessage", id: 42 /* number, not string */ },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    await teardown(h);
  });

  it("malformed item/agentMessage/delta (delta not a string) falls through to unknown", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: { not: "a string" },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    await teardown(h);
  });

  // ─── T7b-1: turn.status discrimination ─────────────────────────

  it("turn/completed with status=failed yields turn_failed (T7b-1)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "failed", error: { kind: "rate_limited" } },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("turn_failed");
    if (ev.type === "turn_failed") {
      expect(ev.threadId).toBe("thread-1");
      expect(ev.turnId).toBe("turn-1");
      expect(ev.terminal).toBe(true);
    }
    await teardown(h);
  });

  it("turn/completed with status=interrupted yields turn_interrupted (T7b-1)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "interrupted" },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("turn_interrupted");
    if (ev.type === "turn_interrupted") {
      expect(ev.terminal).toBe(true);
    }
    await teardown(h);
  });

  it("turn/completed with unrecognized status (e.g. inProgress) falls through to unknown", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });

    const ev = (await it.next()).value as CodexRichEvent;
    expect(ev.type).toBe("unknown");
    await teardown(h);
  });

  // ─── T7b-1: every method without a typed arm produces `unknown` ─

  it("every ServerNotification method without a typed arm produces {type:'unknown'} (exhaustive coverage)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Sample one method from each category that T7b-1 routes to unknown.
    // Tests the case-fall-through grouping in the exhaustive switch.
    const unknownBoundMethods = [
      "account/login/completed",
      "app/list/updated",
      "command/exec/outputDelta",
      "configWarning",
      "deprecationNotice",
      "fs/changed",
      "fuzzyFileSearch/sessionUpdated",
      "guardianWarning",
      "hook/started",
      "item/autoApprovalReview/started",
      "item/commandExecution/outputDelta",
      "item/fileChange/patchUpdated",
      "item/mcpToolCall/progress",
      "item/plan/delta",
      "item/reasoning/textDelta",
      "mcpServer/startupStatus/updated",
      "model/rerouted",
      "rawResponseItem/completed",
      "serverRequest/resolved",
      "skills/changed",
      "thread/status/changed",
      "thread/tokenUsage/updated",
      "thread/realtime/started",
      "turn/diff/updated",
      "turn/plan/updated",
    ];

    for (const m of unknownBoundMethods) {
      h.fake.emitNotification(m, { sample: m });
    }

    for (const m of unknownBoundMethods) {
      const ev = (await it.next()).value as CodexRichEvent;
      expect(ev.type, `expected unknown for ${m}`).toBe("unknown");
      if (ev.type === "unknown") {
        expect(ev.method).toBe(m);
        expect(ev.params).toEqual({ sample: m });
      }
    }

    await teardown(h);
  });

  // ─── T7b-1: endOfStream() vs iterator.return() split ────────────

  it("endOfStream() lets pending consumers drain the queue then yields done", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Buffer two events.
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    });
    await new Promise<void>((r) => queueMicrotask(r));

    // Source ended (e.g. transport.onClose). Queue still has events.
    h.normalizer.endOfStream();

    // Consumer drains naturally — both events yield, then done.
    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    const c = await it.next();
    expect(a.type).toBe("turn_started");
    expect(b.type).toBe("turn_completed");
    expect(c.done).toBe(true);

    await teardown(h);
  });

  it("endOfStream() resolves a pending next() with done when queue is empty", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Suspend a next() with no events.
    const pending = it.next();
    h.normalizer.endOfStream();

    const result = await pending;
    expect(result.done).toBe(true);
    await teardown(h);
  });

  it("endOfStream() is idempotent (calling twice is a no-op)", async () => {
    const h = harness();
    h.normalizer.endOfStream();
    expect(() => h.normalizer.endOfStream()).not.toThrow();
    await teardown(h);
  });

  it("endOfStream() is a no-op if iterator.return() was called first (cancellation wins)", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();
    await it.return?.();
    expect(() => h.normalizer.endOfStream()).not.toThrow();

    // Subsequent .next() still reports done.
    const ev = await it.next();
    expect(ev.done).toBe(true);
    await teardown(h);
  });

  it("iterator.return() drops buffered events; endOfStream() preserves them", async () => {
    // Cancellation path: drop queue immediately.
    const h1 = harness();
    const it1 = h1.normalizer.events()[Symbol.asyncIterator]();
    h1.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    await it1.return?.();
    const result1 = await it1.next();
    expect(result1.done).toBe(true);
    await teardown(h1);

    // Source-ended path: same buffered event is delivered before done.
    const h2 = harness();
    const it2 = h2.normalizer.events()[Symbol.asyncIterator]();
    h2.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    h2.normalizer.endOfStream();
    const ev = (await it2.next()).value as CodexRichEvent;
    expect(ev.type).toBe("turn_started");
    const after = await it2.next();
    expect(after.done).toBe(true);
    await teardown(h2);
  });

  it("after endOfStream(), notifications arriving via a stale subscription path are ignored", async () => {
    // This guards against a future regression where #unsub fails to
    // detach the handler — endOfStream() must also early-return on
    // notification ingress.
    const h = harness();
    h.normalizer.endOfStream();
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    await new Promise<void>((r) => queueMicrotask(r));

    const it = h.normalizer.events()[Symbol.asyncIterator]();
    const result = await it.next();
    expect(result.done).toBe(true);
    await teardown(h);
  });

  it("events() returns the SAME iterator on every call (single-consumer contract — codex T7a review #1)", async () => {
    const h = harness();
    const a = h.normalizer.events();
    const b = h.normalizer.events();
    expect(a).toBe(b);

    // Both share the queue: an event consumed via one is gone from the other.
    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });
    const ev1 = (await a.next()).value as CodexRichEvent;
    expect(ev1.type).toBe("turn_started");

    // Emit a second; only one of {a, b} sees it (work-queue, not broadcast).
    h.fake.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    });
    const ev2 = (await b.next()).value as CodexRichEvent;
    expect(ev2.type).toBe("turn_completed");

    await teardown(h);
  });
});

// ─── T7b-2: walk-and-drop overflow + ordering + fixture replay ──────

const delta = (n: string) => ({
  threadId: "t",
  turnId: "u",
  itemId: "m",
  delta: n,
});

describe("EventNormalizer walk-and-drop overflow (T7b-2)", () => {
  it("oldest delta is replaced by an overflow synthetic at the SAME position when soft cap hit", async () => {
    // Cap=2: third delta forces eviction of delta1.
    const h = harness({ deltaSoftCap: 2 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/agentMessage/delta", delta("1"));
    h.fake.emitNotification("item/agentMessage/delta", delta("2"));
    h.fake.emitNotification("warning", { msg: "between" });
    h.fake.emitNotification("item/agentMessage/delta", delta("3"));
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 4; i++) out.push((await it.next()).value as CodexRichEvent);

    // Expected: synthetic@0 (delta1 dropped), delta2@1, warning@2, delta3@3
    expect(out[0]?.type).toBe("normalizer_overflow");
    if (out[0]?.type === "normalizer_overflow") {
      expect(out[0].droppedCount).toBe(1);
      expect(out[0].class).toBe("delta");
    }
    expect(out[1]?.type).toBe("agent_message_delta");
    if (out[1]?.type === "agent_message_delta") expect(out[1].deltaText).toBe("2");
    expect(out[2]?.type).toBe("warning");
    expect(out[3]?.type).toBe("agent_message_delta");
    if (out[3]?.type === "agent_message_delta") expect(out[3].deltaText).toBe("3");

    await teardown(h);
  });

  it("multiple drops accumulate droppedCount monotonically (1, 2, 3, ...)", async () => {
    const h = harness({ deltaSoftCap: 1 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("item/agentMessage/delta", delta("1"));
    h.fake.emitNotification("item/agentMessage/delta", delta("2"));
    h.fake.emitNotification("item/agentMessage/delta", delta("3"));
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 3; i++) out.push((await it.next()).value as CodexRichEvent);

    // delta1 evicted by delta2 (synthetic dc=1), then delta2 evicted by delta3 (synthetic dc=2),
    // delta3 in queue.
    expect(out[0]?.type).toBe("normalizer_overflow");
    expect(out[1]?.type).toBe("normalizer_overflow");
    expect(out[2]?.type).toBe("agent_message_delta");
    if (out[0]?.type === "normalizer_overflow") expect(out[0].droppedCount).toBe(1);
    if (out[1]?.type === "normalizer_overflow") expect(out[1].droppedCount).toBe(2);

    await teardown(h);
  });

  it("LIFECYCLE invariant: lifecycle events are NEVER dropped under delta overflow (D5 final)", async () => {
    // Many deltas under a low cap; interleave lifecycle events. Every
    // lifecycle event must survive to the consumer.
    const h = harness({ deltaSoftCap: 2 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Emit 5 deltas, then 1 warning, then 5 more deltas (11 total).
    // Walk-and-drop math: each delta beyond cap=2 splices out 1 + adds
    // 1 synthetic + appends 1 new = net +1 queue entry. So 11 wire
    // frames → 11 queue entries (2 surviving deltas + 8 synthetics +
    // 1 warning), drain exactly 11 events.
    for (let i = 0; i < 5; i++) {
      h.fake.emitNotification("item/agentMessage/delta", delta(`a${i}`));
    }
    h.fake.emitNotification("warning", { msg: "load-bearing" });
    for (let i = 0; i < 5; i++) {
      h.fake.emitNotification("item/agentMessage/delta", delta(`b${i}`));
    }
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 11; i++) {
      out.push((await it.next()).value as CodexRichEvent);
    }

    // The warning MUST be present (lifecycle never dropped).
    expect(out.filter((e) => e.type === "warning")).toHaveLength(1);

    // Some deltas should have been dropped (overflow synthetics present).
    expect(out.some((e) => e.type === "normalizer_overflow" && e.class === "delta")).toBe(true);

    // No lifecycle-class overflow synthetic (would indicate the
    // catastrophic hard-cap fired, which shouldn't under this load).
    expect(out.some((e) => e.type === "normalizer_overflow" && e.class === "lifecycle")).toBe(
      false,
    );

    await teardown(h);
  });

  it("walk-and-drop preserves global FIFO order across non-evicted events", async () => {
    const h = harness({ deltaSoftCap: 2 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Wire pattern (as if from real codex):
    //   warning A, delta a, delta b, warning B, delta c, delta d, warning C
    // With cap=2, delta a and delta b will be evicted when c & d come in.
    h.fake.emitNotification("warning", { mark: "A" });
    h.fake.emitNotification("item/agentMessage/delta", delta("a"));
    h.fake.emitNotification("item/agentMessage/delta", delta("b"));
    h.fake.emitNotification("warning", { mark: "B" });
    h.fake.emitNotification("item/agentMessage/delta", delta("c"));
    h.fake.emitNotification("item/agentMessage/delta", delta("d"));
    h.fake.emitNotification("warning", { mark: "C" });
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 7; i++) out.push((await it.next()).value as CodexRichEvent);

    // Global FIFO invariant: every warning's relative position to other
    // warnings must be preserved.
    const warningMarks = out
      .filter((e): e is Extract<CodexRichEvent, { type: "warning" }> => e.type === "warning")
      .map((e) => (e.raw as { params: { mark: string } }).params.mark);
    expect(warningMarks).toEqual(["A", "B", "C"]);

    // The trailing two deltas (c, d) must be preserved (cap=2 + 2 in ⇒
    // walk-and-drop evicts a and b; c and d remain).
    const remainingDeltaTexts = out
      .filter(
        (e): e is Extract<CodexRichEvent, { type: "agent_message_delta" }> =>
          e.type === "agent_message_delta",
      )
      .map((e) => e.deltaText);
    expect(remainingDeltaTexts).toEqual(["c", "d"]);

    await teardown(h);
  });

  it("hard-cap drops oldest entry regardless of class with a lifecycle-class synthetic", async () => {
    // Hard cap at 3, soft cap effectively disabled (high). Push 4
    // lifecycle events; the 4th forces a hard-cap drop of the first.
    const h = harness({ deltaSoftCap: 1_000_000, totalHardCap: 3 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    h.fake.emitNotification("warning", { mark: "1" });
    h.fake.emitNotification("warning", { mark: "2" });
    h.fake.emitNotification("warning", { mark: "3" });
    h.fake.emitNotification("warning", { mark: "4" });
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await it.next();
      if (r.done) break;
      out.push(r.value as CodexRichEvent);
    }

    // Position 0 should be the hard-cap synthetic (replaces dropped warning1).
    expect(out[0]?.type).toBe("normalizer_overflow");
    if (out[0]?.type === "normalizer_overflow") {
      expect(out[0].class).toBe("lifecycle");
      expect(out[0].droppedCount).toBe(1);
    }
    // Then warnings 2, 3, 4 in order.
    const trailing = out
      .slice(1)
      .filter((e): e is Extract<CodexRichEvent, { type: "warning" }> => e.type === "warning")
      .map((e) => (e.raw as { params: { mark: string } }).params.mark);
    expect(trailing).toEqual(["2", "3", "4"]);

    await teardown(h);
  });

  it("synthetic events do NOT count toward the delta cap (no recursive overflow)", async () => {
    const h = harness({ deltaSoftCap: 1 });
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    // Emit two deltas — the second triggers walk-and-drop and inserts
    // a synthetic. The synthetic is class:"lifecycle" so it must NOT
    // bump the delta count and must NOT itself be evicted.
    h.fake.emitNotification("item/agentMessage/delta", delta("1"));
    h.fake.emitNotification("item/agentMessage/delta", delta("2"));
    await new Promise<void>((r) => queueMicrotask(r));

    // Emit a third delta. Should evict the second (since cap=1, count=1).
    // The synthetic from round 1 must remain at position 0.
    h.fake.emitNotification("item/agentMessage/delta", delta("3"));
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < 3; i++) out.push((await it.next()).value as CodexRichEvent);

    expect(out[0]?.type).toBe("normalizer_overflow"); // delta1 evicted
    expect(out[1]?.type).toBe("normalizer_overflow"); // delta2 evicted
    expect(out[2]?.type).toBe("agent_message_delta"); // delta3 survives
    if (out[2]?.type === "agent_message_delta") expect(out[2].deltaText).toBe("3");

    await teardown(h);
  });

  it("default caps don't break ordinary load (the captured T4 fixture)", async () => {
    // Default cap is 4096; the fixture has 25 events. No overflow expected.
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    const messages = loadFixture("0.125.0", "phase1-richer-turn-event-stream.jsonl");
    for (const msg of messages) {
      const m = msg as { method: string; params: unknown };
      h.fake.emitNotification(m.method, m.params);
    }
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < messages.length; i++) {
      out.push((await it.next()).value as CodexRichEvent);
    }

    expect(out.length).toBe(messages.length);
    // No overflow at default caps.
    expect(out.some((e) => e.type === "normalizer_overflow")).toBe(false);

    await teardown(h);
  });
});

// ─── T7b-2: fixture replay against the captured T4 wire ──────────────

describe("EventNormalizer fixture replay (T7b-2)", () => {
  it("replays phase1-richer-turn-event-stream and yields the expected lifecycle types", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    const messages = loadFixture("0.125.0", "phase1-richer-turn-event-stream.jsonl");
    for (const msg of messages) {
      const m = msg as { method: string; params: unknown };
      h.fake.emitNotification(m.method, m.params);
    }
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < messages.length; i++) {
      out.push((await it.next()).value as CodexRichEvent);
    }

    const types = out.map((e) => e.type);

    // Expected typed arms from the captured fixture.
    expect(types).toContain("turn_started");
    expect(types).toContain("turn_completed");
    expect(types).toContain("thread_started");
    expect(types).toContain("agent_message_delta");
    expect(types).toContain("item_started");
    expect(types).toContain("item_completed");
    expect(types).toContain("warning");

    // The turn/completed in this fixture has status="completed" (not
    // failed/interrupted). T7b-1's discrimination must produce
    // turn_completed, not turn_failed/turn_interrupted.
    expect(types).not.toContain("turn_failed");
    expect(types).not.toContain("turn_interrupted");

    // Methods without a typed arm (item/started for fileChange items,
    // mcpServer/startupStatus/updated, etc.) come through as `unknown`
    // — verify some are present.
    expect(types).toContain("unknown");

    // No overflow at default caps.
    expect(types).not.toContain("normalizer_overflow");

    await teardown(h);
  });

  it("preserves arrival order across the entire fixture", async () => {
    const h = harness();
    const it = h.normalizer.events()[Symbol.asyncIterator]();

    const messages = loadFixture("0.125.0", "phase1-richer-turn-event-stream.jsonl");
    for (const msg of messages) {
      const m = msg as { method: string; params: unknown };
      h.fake.emitNotification(m.method, m.params);
    }
    await new Promise<void>((r) => queueMicrotask(r));

    const out: CodexRichEvent[] = [];
    for (let i = 0; i < messages.length; i++) {
      out.push((await it.next()).value as CodexRichEvent);
    }

    // For each event, its index in the output must match the original
    // wire frame's index in the fixture.
    expect(out.length).toBe(messages.length);
    for (let i = 0; i < messages.length; i++) {
      const wireMethod = (messages[i] as { method: string }).method;
      const richEvent = out[i];
      expect(richEvent).toBeDefined();
      // raw should be the original message envelope (or {method,params}
      // for unknown).
      const raw = richEvent && "raw" in richEvent ? richEvent.raw : undefined;
      if (raw !== undefined) {
        expect((raw as { method: string }).method).toBe(wireMethod);
      } else if (richEvent?.type === "unknown") {
        expect(richEvent.method).toBe(wireMethod);
      } else {
        throw new Error(`event at index ${i} has neither raw nor unknown shape`);
      }
    }

    await teardown(h);
  });
});

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
import { FakeAppServer } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { EventNormalizer } from "../src/event-normalizer.js";
import type { CodexRichEvent } from "../src/types.js";

const SILENT = pino({ level: "silent" });

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  normalizer: EventNormalizer;
}

function harness(): Harness {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide, { logger: SILENT });
  void client.start();
  const normalizer = new EventNormalizer(client);
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

    h.fake.emitNotification("thread/started", { threadId: "thread-1" });
    h.fake.emitNotification("thread/closed", { threadId: "thread-1" });

    const a = (await it.next()).value as CodexRichEvent;
    const b = (await it.next()).value as CodexRichEvent;
    expect(a.type).toBe("thread_started");
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

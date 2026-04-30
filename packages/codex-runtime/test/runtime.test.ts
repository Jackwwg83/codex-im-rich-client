// T8 (Phase 1, P1.1): CodexRuntime typed wrappers.
//
// Validates that each ClientRequest method has a typed wrapper:
//   1. forwards params verbatim to client.request<P, R>
//   2. returns the typed response shape
//   3. types are sourced from @codex-im/protocol's facade
//      (Pre-2 expansion), never hardcoded
//
// runtime.events is the EventNormalizer instance — covered by
// event-normalizer.test.ts. Here we exercise the wrappers themselves
// against FakeAppServer.

import { AppServerClient } from "@codex-im/app-server-client";
import type {
  ReviewStartParams,
  ReviewStartResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@codex-im/protocol";
import { FakeAppServer } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../src/runtime.js";

const SILENT = pino({ level: "silent" });

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  runtime: CodexRuntime;
}

function harness(): Harness {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide, { logger: SILENT });
  void client.start();
  const runtime = new CodexRuntime(client);
  return { fake, client, runtime };
}

async function teardown(h: Harness): Promise<void> {
  await h.client.stop();
  await h.fake.stop();
}

describe("CodexRuntime — thread/* wrappers (T8)", () => {
  it("threadStart forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("thread/start", (params) => {
      received = params;
      return {
        thread: { id: "thread-1" },
        model: "gpt-X",
        modelProvider: "openai",
        serviceTier: null,
        cwd: "/tmp/x",
        instructionSources: [],
        approvalPolicy: "on-request",
        approvalsReviewer: { type: "default" },
        sandbox: { mode: "read-only" },
        permissionProfile: null,
        reasoningEffort: null,
      } as unknown as ThreadStartResponse;
    });

    const params: ThreadStartParams = {
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    };
    const r = await h.runtime.threadStart(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-1");

    await teardown(h);
  });

  it("threadResume forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("thread/resume", (params) => {
      received = params;
      return { thread: { id: "thread-resumed" } } as unknown as ThreadResumeResponse;
    });

    const params: ThreadResumeParams = {
      threadId: "thread-1",
      persistExtendedHistory: false,
    } as ThreadResumeParams;
    const r = await h.runtime.threadResume(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-resumed");

    await teardown(h);
  });

  it("threadFork forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("thread/fork", (params) => {
      received = params;
      return { thread: { id: "thread-forked" } } as unknown as ThreadForkResponse;
    });

    const params: ThreadForkParams = {
      threadId: "thread-1",
      persistExtendedHistory: false,
    } as ThreadForkParams;
    const r = await h.runtime.threadFork(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-forked");

    await teardown(h);
  });

  it("threadTurnsList forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("thread/turns/list", (params) => {
      received = params;
      return {
        data: [],
        nextCursor: null,
        backwardsCursor: null,
      } as ThreadTurnsListResponse;
    });

    const params: ThreadTurnsListParams = { threadId: "thread-1" };
    const r = await h.runtime.threadTurnsList(params);
    expect(received).toEqual(params);
    expect(r.data).toEqual([]);
    expect(r.nextCursor).toBeNull();

    await teardown(h);
  });

  it("threadRead forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("thread/read", (params) => {
      received = params;
      return { thread: { id: "thread-1" } } as unknown as ThreadReadResponse;
    });

    const params: ThreadReadParams = { threadId: "thread-1", includeTurns: false };
    const r = await h.runtime.threadRead(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-1");

    await teardown(h);
  });
});

describe("CodexRuntime — turn/* wrappers (T8)", () => {
  it("turnStart forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("turn/start", (params) => {
      received = params;
      return {
        turn: { id: "turn-1", items: [], status: "inProgress" },
      } as unknown as TurnStartResponse;
    });

    const params: TurnStartParams = {
      threadId: "thread-1",
      input: [{ type: "text", text: "hi", text_elements: [] }],
    } as TurnStartParams;
    const r = await h.runtime.turnStart(params);
    expect(received).toEqual(params);
    expect(r.turn.id).toBe("turn-1");

    await teardown(h);
  });

  it("turnSteer forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("turn/steer", (params) => {
      received = params;
      return { turnId: "turn-1" } as TurnSteerResponse;
    });

    const params: TurnSteerParams = {
      threadId: "thread-1",
      input: [],
      expectedTurnId: "turn-1",
    } as TurnSteerParams;
    const r = await h.runtime.turnSteer(params);
    expect(received).toEqual(params);
    expect(r.turnId).toBe("turn-1");

    await teardown(h);
  });

  it("turnInterrupt forwards params and returns void-shaped response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("turn/interrupt", (params) => {
      received = params;
      return {} as TurnInterruptResponse;
    });

    const params: TurnInterruptParams = { threadId: "thread-1", turnId: "turn-1" };
    const r = await h.runtime.turnInterrupt(params);
    expect(received).toEqual(params);
    expect(r).toEqual({});

    await teardown(h);
  });
});

describe("CodexRuntime — review/* wrappers (T8)", () => {
  it("reviewStart forwards params and returns typed response", async () => {
    const h = harness();
    let received: unknown;
    h.fake.respondTo("review/start", (params) => {
      received = params;
      return {
        turn: { id: "turn-1", items: [], status: "inProgress" },
        reviewThreadId: "thread-1",
      } as unknown as ReviewStartResponse;
    });

    const params: ReviewStartParams = {
      threadId: "thread-1",
      target: { type: "uncommittedChanges" },
    };
    const r = await h.runtime.reviewStart(params);
    expect(received).toEqual(params);
    expect(r.reviewThreadId).toBe("thread-1");

    await teardown(h);
  });
});

describe("CodexRuntime — events surface (T8)", () => {
  it("exposes the EventNormalizer's AsyncIterable via runtime.events", async () => {
    const h = harness();
    expect(h.runtime.events).toBeDefined();
    // The normalizer's events() returns an AsyncIterableIterator.
    const it = h.runtime.events.events();
    expect(typeof it.next).toBe("function");
    expect(typeof it.return).toBe("function");
    expect(typeof it[Symbol.asyncIterator]).toBe("function");
    await teardown(h);
  });

  it("runtime.events emits notifications received via the underlying client", async () => {
    const h = harness();
    const it = h.runtime.events.events();

    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });

    const ev = (await it.next()).value;
    expect(ev?.type).toBe("turn_started");

    await teardown(h);
  });
});

describe("CodexRuntime — request error propagation (T8)", () => {
  it("rejects with JsonRpcResponseError when the server returns a JSON-RPC error", async () => {
    const h = harness();
    // FakeAppServer's default behavior: handler throwing → maps to
    // -32603. Add an explicit handler that throws.
    h.fake.respondTo("thread/read", () => {
      throw new Error("not found");
    });

    await expect(
      h.runtime.threadRead({ threadId: "missing", includeTurns: false }),
    ).rejects.toThrow(/not found/);

    await teardown(h);
  });

  it("rejects when codex returns -32601 for an unhandled method", async () => {
    const h = harness();
    // FakeAppServer auto-emits -32601 for unregistered methods.
    await expect(h.runtime.threadRead({ threadId: "x", includeTurns: false })).rejects.toThrow();
    await teardown(h);
  });
});

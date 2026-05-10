// Slice 2 Cut 1 — Commit 1 (RED phase).
//
// Direct unit tests against TurnOutputManager. The implementation is a stub
// (every method throws "not implemented"); these 24 tests fix the contract.
// Commit 2 (GREEN) makes them pass without touching this file.
//
// Tests use fake adapter / fake clock / fake audit / fake readFile so the
// manager surface is exercised at the component level. The legacy
// turn-output.test.ts will keep its 5 integration tests (Daemon -> Manager
// chain) and migrate the other 10 down here in Commit 6.

import type { CodexRichEvent } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import type { DaemonMessageRef, DaemonOutboundFile } from "../src/index.js";
import {
  type TurnOutputAdapter,
  type TurnOutputAuditEmitter,
  type TurnOutputClock,
  TurnOutputManager,
  type TurnOutputReadFile,
  type TurnOutputRuntime,
} from "../src/turn-output.js";

// ---------- fixtures -----------------------------------------------------

const TARGET: Target = { platform: "telegram", chatId: "-1001" };
const TARGET_2: Target = { platform: "telegram", chatId: "-2002" };
const THREAD_ID = "thread-1";
const THREAD_ID_2 = "thread-2";
const TURN_ID = "turn-1";
const PLACEHOLDER = "Codex is working...";
const PROGRESS_INTERVAL_MS = 1_500;
const MAX_IM_TEXT_CHARS = 3_800;
const ARTIFACT_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

function makeAdapter() {
  const sendText = vi.fn(
    async (target: Target, _body: string): Promise<DaemonMessageRef> => ({
      target,
      messageId: "msg-1",
      kind: "text",
    }),
  );
  const editText = vi.fn(async (_ref: DaemonMessageRef, _body: string): Promise<void> => undefined);
  const sendFile = vi.fn(
    async (target: Target, _file: DaemonOutboundFile): Promise<DaemonMessageRef> => ({
      target,
      messageId: "file-1",
      kind: "file",
    }),
  );
  return { sendText, editText, sendFile };
}

function makeAdapterWithoutSendFile() {
  const adapter = makeAdapter();
  return { ...adapter, sendFile: undefined as unknown as typeof adapter.sendFile };
}

function makeAudit(): TurnOutputAuditEmitter & { calls: Array<{ event: string; detail: object }> } {
  const calls: Array<{ event: string; detail: object }> = [];
  const emit = ((event: string, detail: object) => {
    calls.push({ event, detail });
  }) as TurnOutputAuditEmitter & { calls: typeof calls };
  emit.calls = calls;
  return emit;
}

function makeReadFile(bytes: Uint8Array = ARTIFACT_BYTES): TurnOutputReadFile {
  return vi.fn(async (_path: string) => bytes);
}

function makeClock(initial = 1_000_000_000): {
  now: TurnOutputClock;
  advance: (delta: number) => void;
  set: (value: number) => void;
} {
  let t = initial;
  return {
    now: () => t,
    advance: (delta) => {
      t += delta;
    },
    set: (value) => {
      t = value;
    },
  };
}

function makeManager(overrides?: {
  adapter?: TurnOutputAdapter;
  audit?: TurnOutputAuditEmitter;
  readFile?: TurnOutputReadFile;
  clock?: TurnOutputClock;
}): TurnOutputManager {
  return new TurnOutputManager(
    overrides?.adapter ?? makeAdapter(),
    overrides?.audit ?? makeAudit(),
    overrides?.readFile ?? makeReadFile(),
    overrides?.clock ?? makeClock().now,
  );
}

// ---------- event constructors ------------------------------------------

function deltaEvent(threadId: string, turnId: string, deltaText: string): CodexRichEvent {
  return {
    type: "agent_message_delta",
    threadId,
    turnId,
    itemId: "item-msg",
    deltaText,
    raw: {},
  };
}

function itemCompletedEvent(
  threadId: string,
  turnId: string,
  item: Record<string, unknown>,
): CodexRichEvent {
  return {
    type: "item_completed",
    threadId,
    turnId,
    itemId: typeof item.id === "string" ? item.id : "item-1",
    raw: { params: { item } },
  };
}

function turnCompletedEvent(threadId: string, turnId: string): CodexRichEvent {
  return { type: "turn_completed", threadId, turnId, raw: {}, terminal: true };
}

function turnFailedEvent(threadId: string, turnId: string): CodexRichEvent {
  return { type: "turn_failed", threadId, turnId, raw: {}, terminal: true };
}

function turnInterruptedEvent(threadId: string, turnId: string): CodexRichEvent {
  return { type: "turn_interrupted", threadId, turnId, raw: {}, terminal: true };
}

function unknownStatusEvent(method: string, params: unknown): CodexRichEvent {
  return { type: "unknown", method, params };
}

// ---------- shared helpers ----------------------------------------------

const fileChangeItem = (id: string, path: string) => ({
  type: "fileChange",
  id,
  status: "completed",
  changes: [{ path, kind: "modify", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
});

const imageGenItem = (id: string, savedPath: string) => ({
  type: "imageGeneration",
  id,
  status: "completed",
  savedPath,
});

// =========================================================================

describe("TurnOutputManager.open", () => {
  it("sends placeholder text and stores state for the (thread, turn) pair", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);

    expect(adapter.sendText).toHaveBeenCalledTimes(1);
    expect(adapter.sendText).toHaveBeenCalledWith(TARGET, PLACEHOLDER);
  });

  it("emits runtime.turn_output_send_failed when adapter.sendText throws", async () => {
    const adapter = makeAdapter();
    adapter.sendText.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const audit = makeAudit();
    const manager = makeManager({ adapter, audit });

    await manager.open(TARGET, THREAD_ID, TURN_ID);

    expect(audit.calls.some((c) => c.event === "runtime.turn_output_send_failed")).toBe(true);
  });
});

describe("TurnOutputManager.handle agent_message_delta", () => {
  it("appends delta text and edits the placeholder once the throttle interval elapses", async () => {
    const adapter = makeAdapter();
    const clock = makeClock();
    const manager = makeManager({ adapter, clock: clock.now });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    adapter.editText.mockClear();

    clock.advance(PROGRESS_INTERVAL_MS + 1);
    const signal = await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "hello"));

    expect(signal?.kind).toBe("progress");
    expect(adapter.editText).toHaveBeenCalledTimes(1);
    const [, body] = adapter.editText.mock.calls[0] ?? [];
    expect(body).toContain("hello");
  });

  it("does not progress-edit a second time before the throttle interval elapses", async () => {
    const adapter = makeAdapter();
    const clock = makeClock();
    const manager = makeManager({ adapter, clock: clock.now });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    // first delta primes the throttle: editText fires once.
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "first"));
    adapter.editText.mockClear();

    // second delta within the throttle window must be skipped.
    clock.advance(PROGRESS_INTERVAL_MS - 1);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "second"));

    expect(adapter.editText).not.toHaveBeenCalled();
  });
});

describe("TurnOutputManager.handle item_completed", () => {
  it("appends an item summary and deduplicates repeat summaries within a turn", async () => {
    const adapter = makeAdapter();
    const clock = makeClock();
    const manager = makeManager({ adapter, clock: clock.now });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    adapter.editText.mockClear();

    await manager.handle(itemCompletedEvent(THREAD_ID, TURN_ID, fileChangeItem("a", "src/a.ts")));
    await manager.handle(itemCompletedEvent(THREAD_ID, TURN_ID, fileChangeItem("a", "src/a.ts")));

    clock.advance(PROGRESS_INTERVAL_MS + 1);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, ""));
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    const finalCall = lastCall(adapter.editText) ?? lastCall(adapter.sendText);
    const finalBody = String(finalCall?.[1] ?? finalCall?.[0]);
    const occurrences = finalBody.split("src/a.ts").length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it("deduplicates per-turn artifact files by turnOutputFileKey", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, imageGenItem("img-1", "/tmp/codex-img-1.png")),
    );
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, imageGenItem("img-1", "/tmp/codex-img-1.png")),
    );
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.sendFile).toHaveBeenCalledTimes(1);
  });
});

describe("TurnOutputManager.handle unknown status event", () => {
  it("appends a status summary and edits the in-progress message after the throttle", async () => {
    const adapter = makeAdapter();
    const clock = makeClock();
    const manager = makeManager({ adapter, clock: clock.now });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    adapter.editText.mockClear();

    clock.advance(PROGRESS_INTERVAL_MS + 1);
    await manager.handle(
      unknownStatusEvent("thread/tokenUsage/updated", {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        tokenUsage: { total: { totalTokens: 1234 }, last: { totalTokens: 12 } },
      }),
    );

    expect(adapter.editText).toHaveBeenCalledTimes(1);
    const [, body] = adapter.editText.mock.calls[0] ?? [];
    expect(body).toContain("Codex status:");
  });
});

describe("TurnOutputManager.handle turn terminal events", () => {
  it("turn_completed publishes terminal output, removes state, and returns a turn_terminal signal", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "Done. Result: ok"));
    const signal = await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(signal).toEqual({
      kind: "turn_terminal",
      target: TARGET,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    // state removed: a follow-up handle for the same turn is a no-op (returns undefined)
    const after = await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));
    expect(after).toBeUndefined();
  });

  it("turn_completed is a no-op when no state exists for the (thread, turn) pair", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    const signal = await manager.handle(turnCompletedEvent("unknown-thread", "unknown-turn"));

    expect(signal).toBeUndefined();
    expect(adapter.editText).not.toHaveBeenCalled();
    expect(adapter.sendText).not.toHaveBeenCalled();
  });

  it("turn_failed appends a [turn failed] suffix to the terminal output", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "partial"));
    await manager.handle(turnFailedEvent(THREAD_ID, TURN_ID));

    const finalBody = String(
      lastCall(adapter.editText)?.[1] ?? lastCall(adapter.sendText)?.[1] ?? "",
    );
    expect(finalBody).toContain("[turn failed]");
  });

  it("turn_interrupted appends a [turn interrupted] suffix to the terminal output", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "partial"));
    await manager.handle(turnInterruptedEvent(THREAD_ID, TURN_ID));

    const finalBody = String(
      lastCall(adapter.editText)?.[1] ?? lastCall(adapter.sendText)?.[1] ?? "",
    );
    expect(finalBody).toContain("[turn interrupted]");
  });
});

describe("TurnOutputManager.interrupt", () => {
  it("synthesizes an interrupted terminal frame, flushes terminal output, and removes state", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "halfway"));

    await manager.interrupt(THREAD_ID, TURN_ID);

    const finalBody = String(
      lastCall(adapter.editText)?.[1] ?? lastCall(adapter.sendText)?.[1] ?? "",
    );
    expect(finalBody).toContain("[turn interrupted]");
    // state was removed
    const after = await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));
    expect(after).toBeUndefined();
  });

  it("is a no-op when no state exists for the (thread, turn) pair", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await expect(manager.interrupt("missing-thread", "missing-turn")).resolves.toBeUndefined();
    expect(adapter.editText).not.toHaveBeenCalled();
    expect(adapter.sendText).not.toHaveBeenCalled();
  });
});

describe("TurnOutputManager terminal text body", () => {
  it("splits a body that exceeds MAX_IM_TEXT_CHARS into edit + sendText continuations", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    const longText = "x".repeat(MAX_IM_TEXT_CHARS * 2 + 100);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, longText));
    // ignore in-progress edit calls; only count what the terminal flush emits.
    adapter.editText.mockClear();
    adapter.sendText.mockClear();
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    // First terminal chunk uses editText (replaces placeholder); continuations use sendText.
    expect(adapter.editText).toHaveBeenCalledTimes(1);
    expect(adapter.sendText.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("uses the edit path when first-chunk editText succeeds", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "short reply"));
    adapter.editText.mockClear();
    adapter.sendText.mockClear();
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.editText).toHaveBeenCalledTimes(1);
    expect(adapter.sendText).not.toHaveBeenCalled();
  });

  it("falls back to sendText when first-chunk editText throws", async () => {
    const adapter = makeAdapter();
    adapter.editText.mockImplementation(async () => {
      throw new Error("can't edit");
    });
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "fallback body"));
    adapter.sendText.mockClear();
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.sendText).toHaveBeenCalledTimes(1);
    const [, body] = adapter.sendText.mock.calls[0] ?? [];
    expect(body).toContain("fallback body");
  });
});

describe("TurnOutputManager terminal files", () => {
  it("publishes an in-memory image attachment via adapter.sendFile", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, fileChangeItem("fc-1", "src/foo.ts")),
    );
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.sendFile).toHaveBeenCalledTimes(1);
    const [target, file] = adapter.sendFile.mock.calls[0] ?? [];
    expect(target).toEqual(TARGET);
    expect(file?.contentType).toBe("text/x-patch");
    expect(file?.bytes).toBeInstanceOf(Uint8Array);
  });

  it("reads artifact bytes from disk via the injected readFile when only a path is known", async () => {
    const adapter = makeAdapter();
    const readFile = vi.fn(async (_path: string) => ARTIFACT_BYTES);
    const manager = makeManager({ adapter, readFile });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, imageGenItem("img-1", "/tmp/codex-img-1.png")),
    );
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(readFile).toHaveBeenCalledWith("/tmp/codex-img-1.png");
    expect(adapter.sendFile).toHaveBeenCalledTimes(1);
    const [, file] = adapter.sendFile.mock.calls[0] ?? [];
    expect(file?.bytes).toEqual(ARTIFACT_BYTES);
  });

  it("skips files and emits an audit event when adapter.sendFile is not provided", async () => {
    const adapter = makeAdapterWithoutSendFile();
    const audit = makeAudit();
    const manager = makeManager({ adapter, audit });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, fileChangeItem("fc-1", "src/foo.ts")),
    );
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(
      audit.calls.some(
        (c) =>
          c.event === "runtime.turn_output_file_skipped" ||
          c.event === "runtime.turn_output_send_failed",
      ),
    ).toBe(true);
  });

  it("skips and audits a file that exceeds MAX_IM_ARTIFACT_FILE_BYTES (10 MiB)", async () => {
    const adapter = makeAdapter();
    const audit = makeAudit();
    const oversized = new Uint8Array(11 * 1024 * 1024);
    const readFile = vi.fn(async (_path: string) => oversized);
    const manager = makeManager({ adapter, audit, readFile });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(
      itemCompletedEvent(THREAD_ID, TURN_ID, imageGenItem("img-big", "/tmp/big.png")),
    );
    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.sendFile).not.toHaveBeenCalled();
    expect(audit.calls.some((c) => c.event === "runtime.turn_output_file_skipped")).toBe(true);
  });
});

describe("TurnOutputManager multi-turn isolation", () => {
  it("keeps independent state for concurrent turns on different threads", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.open(TARGET_2, THREAD_ID_2, TURN_ID);

    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "alpha"));
    await manager.handle(deltaEvent(THREAD_ID_2, TURN_ID, "beta"));

    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));
    await manager.handle(turnCompletedEvent(THREAD_ID_2, TURN_ID));

    const calls = adapter.editText.mock.calls;
    const targets = new Set(calls.map(([ref]) => ref.target.chatId));
    expect(targets.has(TARGET.chatId)).toBe(true);
    expect(targets.has(TARGET_2.chatId)).toBe(true);

    const target1Body = String(
      calls.find(([ref]) => ref.target.chatId === TARGET.chatId)?.[1] ?? "",
    );
    const target2Body = String(
      calls.find(([ref]) => ref.target.chatId === TARGET_2.chatId)?.[1] ?? "",
    );
    expect(target1Body).toContain("alpha");
    expect(target1Body).not.toContain("beta");
    expect(target2Body).toContain("beta");
    expect(target2Body).not.toContain("alpha");
  });
});

describe("TurnOutputManager append-only messageRef", () => {
  it("when sendText returns an append-only ref, terminal output uses sendText (no editText)", async () => {
    const adapter = makeAdapter();
    adapter.sendText.mockImplementation(async (target: Target) => ({
      target,
      messageId: "msg-append-1",
      kind: "text" as const,
      textUpdateMode: "append" as const,
    }));
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "Final answer"));
    adapter.sendText.mockClear();
    adapter.editText.mockClear();

    await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(adapter.editText).not.toHaveBeenCalled();
    expect(adapter.sendText).toHaveBeenCalled();
    const [, body] = adapter.sendText.mock.calls[0] ?? [];
    expect(body).toContain("Final answer");
  });
});

describe("TurnOutputManager.ensureEventPump", () => {
  it("is idempotent: calling twice with the same runtime registers a single pump", async () => {
    const events: CodexRichEvent[] = [];
    const runtimeEvents = {
      events: () => emptyAsyncIterator(events),
    };
    const runtime: TurnOutputRuntime = { events: runtimeEvents };
    const eventsSpy = vi.spyOn(runtimeEvents, "events");

    const manager = makeManager();
    manager.ensureEventPump(runtime);
    manager.ensureEventPump(runtime);

    expect(eventsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("TurnOutputManager.clear", () => {
  it("empties all in-flight state so subsequent handle() calls are no-ops", async () => {
    const adapter = makeAdapter();
    const manager = makeManager({ adapter });

    await manager.open(TARGET, THREAD_ID, TURN_ID);
    manager.clear();

    const signal = await manager.handle(deltaEvent(THREAD_ID, TURN_ID, "anything"));
    const terminal = await manager.handle(turnCompletedEvent(THREAD_ID, TURN_ID));

    expect(signal).toBeUndefined();
    expect(terminal).toBeUndefined();
  });
});

// ---------- helpers ------------------------------------------------------

function lastCall<T extends ReturnType<typeof vi.fn>>(
  fn: T,
): T extends (...args: infer P) => unknown ? P : unknown[] {
  const calls = (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return (calls[calls.length - 1] ?? []) as never;
}

function emptyAsyncIterator<T>(_seed: T[]): AsyncIterableIterator<T> {
  return {
    next: () => Promise.resolve({ value: undefined, done: true }),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

// T10 (Phase 1, P1.4): `codex-im runtime send` CLI.
//
// Plan section: docs/superpowers/plans/2026-04-30-phase-1-runtime.md §1934.
//
// runRuntimeSendCore is the testable inner that takes a Transport (so this
// test can inject a FakeAppServer instead of spawning real codex). The
// outer `run(argv)` does the StdioTransport spawn + env-gate; we exercise
// it indirectly through the core. Mirrors the test pattern from
// smoke-real-turn-capture.test.ts.
//
// What this test verifies:
//   1. Initialize handshake completes (FakeAppServer's default initialize
//      handler responds; see packages/testkit/src/fake-app-server.ts:64).
//   2. thread/start succeeds; runtime captures the thread id.
//   3. turn/start succeeds.
//   4. The runtime's EventNormalizer streams notifications as JSONL
//      lines via the `output` callback.
//   5. Stream terminates on the first terminal turn event
//      (turn_completed / turn_failed / turn_interrupted).
//   6. ApprovalBroker is attached — Phase 1 default-deny applies for
//      any server-initiated request that lands during the turn.
//      (Verified via the dispatch path; we don't fire one in this happy
//      path test, but the broker.attach() call is exercised.)
//   7. Clean shutdown — no unsettled promises, no zombie handlers.

import { FakeAppServer } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { parseRuntimeSendArgs, runRuntimeSendCore } from "../src/runtime-send.js";

describe("runRuntimeSendCore (T10)", () => {
  it("completes one turn end-to-end and streams events as JSONL", async () => {
    const fake = new FakeAppServer();

    // FakeAppServer's default handler covers `initialize`. Add the
    // thread/start + turn/start handlers, and schedule the
    // turn-started + turn-completed notifications after turn/start
    // returns (mirroring real codex ordering: response first, then
    // deltas, then terminal lifecycle).
    fake.respondTo("thread/start", () => ({
      thread: {
        id: "thread-test-1",
        forkedFromId: null,
        preview: "",
        ephemeral: true,
        modelProvider: "openai",
        createdAt: 0,
        updatedAt: 0,
        status: "active",
        path: null,
        cwd: "/tmp/test",
        cliVersion: "test",
        source: { type: "appServer" },
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      },
      model: "gpt-X",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/test",
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: { type: "default" },
      sandbox: { mode: "read-only" },
      permissionProfile: null,
      reasoningEffort: null,
    }));

    fake.respondTo("turn/start", () => {
      queueMicrotask(() => {
        fake.emitNotification("turn/started", {
          threadId: "thread-test-1",
          turn: { id: "turn-test-1", items: [], status: "inProgress" },
        });
        fake.emitNotification("item/agentMessage/delta", {
          threadId: "thread-test-1",
          turnId: "turn-test-1",
          delta: "OK",
        });
        fake.emitNotification("turn/completed", {
          threadId: "thread-test-1",
          turn: { id: "turn-test-1", items: [], status: "completed" },
        });
      });
      return { turn: { id: "turn-test-1", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    const lines: string[] = [];

    await runRuntimeSendCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "Reply OK",
      output: (line) => lines.push(line),
      turnTimeoutMs: 5_000,
      clientName: "test-runtime-send",
      clientVersion: "0.0.0-test",
    });

    await fake.stop();

    // Each line must be valid JSONL (parses as JSON).
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    // The stream MUST include the terminal turn_completed event.
    // (turn_started + delta are also expected but order is not
    // load-bearing for this assertion.)
    const types = events.map((e) => e.type as string);
    expect(types).toContain("turn_completed");

    // The terminal event has terminal: true (T7b-1 contract) and matches
    // the threadId/turnId we emitted.
    const completed = events.find((e) => e.type === "turn_completed");
    expect(completed).toMatchObject({
      type: "turn_completed",
      threadId: "thread-test-1",
      turnId: "turn-test-1",
      terminal: true,
    });
  });

  it("attaches ApprovalBroker so server-initiated approvals get default-rejected", async () => {
    // Phase 1 safety rail (T9b default-reject policy): every approval
    // method has handler=null, so the broker returns the per-method
    // default-reject response shape. Verify by firing a server-initiated
    // request mid-turn and asserting the broker's default-reject lands
    // on the wire.
    const fake = new FakeAppServer();

    fake.respondTo("thread/start", () => ({
      thread: {
        id: "thread-approval-test",
        forkedFromId: null,
        preview: "",
        ephemeral: true,
        modelProvider: "openai",
        createdAt: 0,
        updatedAt: 0,
        status: "active",
        path: null,
        cwd: "/tmp/test",
        cliVersion: "test",
        source: { type: "appServer" },
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      },
      model: "gpt-X",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/test",
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: { type: "default" },
      sandbox: { mode: "read-only" },
      permissionProfile: null,
      reasoningEffort: null,
    }));

    let approvalResp: unknown = null;

    fake.respondTo("turn/start", () => {
      queueMicrotask(async () => {
        // Mid-turn, fire a server-initiated approval. Phase 1's broker
        // default-rejects this with {decision: "decline"} for fileChange.
        try {
          approvalResp = await fake.emitServerRequest(
            "item/fileChange/requestApproval",
            { threadId: "thread-approval-test", turnId: "turn-approval-test", itemId: "i1" },
            500,
          );
        } catch (e) {
          approvalResp = { error: e };
        }
        fake.emitNotification("turn/completed", {
          threadId: "thread-approval-test",
          turn: { id: "turn-approval-test", items: [], status: "completed" },
        });
      });
      return { turn: { id: "turn-approval-test", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    const lines: string[] = [];

    await runRuntimeSendCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "Trigger an approval",
      output: (line) => lines.push(line),
      turnTimeoutMs: 5_000,
      clientName: "test-runtime-send",
      clientVersion: "0.0.0-test",
    });

    await fake.stop();

    // Broker default-rejected with the fileChange shape.
    expect(approvalResp).toEqual({ decision: "decline" });
  });

  it("throws when initialize fails (no silent failure)", async () => {
    // FakeAppServer with no `initialize` handler installed would still
    // use the default; we need a fake that rejects initialize. Easiest:
    // override the default with a throwing handler.
    const fake = new FakeAppServer();
    fake.respondTo("initialize", () => {
      throw new Error("test-only initialize failure");
    });

    const log = pino({ level: "silent" });

    await expect(
      runRuntimeSendCore({
        transport: fake.clientSide,
        logger: log,
        prompt: "ignored",
        output: () => {},
        turnTimeoutMs: 1_000,
        clientName: "test-runtime-send",
        clientVersion: "0.0.0-test",
      }),
    ).rejects.toThrow();

    await fake.stop();
  });

  it("output sink receives at least the terminal event for a happy turn (sanity)", async () => {
    // Sanity check that the `output` callback is wired into the
    // event-streaming loop; we don't instrument transport/logger here
    // (those are exercised more thoroughly by the JSONL test above).
    const fake = new FakeAppServer();

    fake.respondTo("thread/start", () => ({
      thread: {
        id: "thread-logger-test",
        forkedFromId: null,
        preview: "",
        ephemeral: true,
        modelProvider: "openai",
        createdAt: 0,
        updatedAt: 0,
        status: "active",
        path: null,
        cwd: "/tmp/test",
        cliVersion: "test",
        source: { type: "appServer" },
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      },
      model: "gpt-X",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/test",
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: { type: "default" },
      sandbox: { mode: "read-only" },
      permissionProfile: null,
      reasoningEffort: null,
    }));

    fake.respondTo("turn/start", () => {
      queueMicrotask(() => {
        fake.emitNotification("turn/completed", {
          threadId: "thread-logger-test",
          turn: { id: "turn-logger-test", items: [], status: "completed" },
        });
      });
      return { turn: { id: "turn-logger-test", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    let outputCount = 0;

    await runRuntimeSendCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "Reply OK",
      output: () => {
        outputCount++;
      },
      turnTimeoutMs: 5_000,
      clientName: "test-runtime-send",
      clientVersion: "0.0.0-test",
    });

    await fake.stop();

    // At minimum the turn_completed event was streamed.
    expect(outputCount).toBeGreaterThanOrEqual(1);
  });
});

describe("parseRuntimeSendArgs (T10 — codex T10 review missing-tests)", () => {
  it("returns empty flags for empty argv", () => {
    expect(parseRuntimeSendArgs([])).toEqual({});
  });

  it("parses --prompt with a value", () => {
    expect(parseRuntimeSendArgs(["--prompt", "Reply OK"])).toEqual({ prompt: "Reply OK" });
  });

  it("parses --prompt-file with a value", () => {
    expect(parseRuntimeSendArgs(["--prompt-file", "/tmp/p.txt"])).toEqual({
      promptFile: "/tmp/p.txt",
    });
  });

  it("parses --cwd with a value", () => {
    expect(parseRuntimeSendArgs(["--cwd", "/tmp/work"])).toEqual({ subprocessCwd: "/tmp/work" });
  });

  it("parses multiple flags in any order", () => {
    expect(parseRuntimeSendArgs(["--cwd", "/tmp/w", "--prompt", "hi"])).toEqual({
      subprocessCwd: "/tmp/w",
      prompt: "hi",
    });
  });

  it("rejects an unknown flag", () => {
    expect(() => parseRuntimeSendArgs(["--bogus"])).toThrow(/unknown flag/);
  });

  it("rejects a missing value (end-of-argv)", () => {
    expect(() => parseRuntimeSendArgs(["--prompt"])).toThrow(/--prompt requires a value/);
  });

  it("rejects a missing value (next-token-is-flag — '--prompt --cwd /tmp')", () => {
    // The "next-token-is-flag" detection prevents silently treating
    // "--cwd" as the value for "--prompt".
    expect(() => parseRuntimeSendArgs(["--prompt", "--cwd", "/tmp"])).toThrow(
      /--prompt requires a value/,
    );
  });

  it("rejects --prompt and --prompt-file together (mutually exclusive)", () => {
    expect(() => parseRuntimeSendArgs(["--prompt", "x", "--prompt-file", "y"])).toThrow(
      /mutually exclusive/,
    );
  });
});

describe("runRuntimeSendCore — terminal turn variants (T10 — codex T10 review missing-tests)", () => {
  // Helper: build a fake that responds to thread/start with a stub
  // response and lets the test drive turn/start's behavior.
  function setupThreadStart(fake: FakeAppServer): void {
    fake.respondTo("thread/start", () => ({
      thread: {
        id: "thread-terminal-test",
        forkedFromId: null,
        preview: "",
        ephemeral: true,
        modelProvider: "openai",
        createdAt: 0,
        updatedAt: 0,
        status: "active",
        path: null,
        cwd: "/tmp/test",
        cliVersion: "test",
        source: { type: "appServer" },
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      },
      model: "gpt-X",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/test",
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: { type: "default" },
      sandbox: { mode: "read-only" },
      permissionProfile: null,
      reasoningEffort: null,
    }));
  }

  it("breaks the event loop on turn_failed terminal event", async () => {
    const fake = new FakeAppServer();
    setupThreadStart(fake);
    fake.respondTo("turn/start", () => {
      queueMicrotask(() => {
        fake.emitNotification("turn/completed", {
          threadId: "thread-terminal-test",
          turn: { id: "turn-failed-test", items: [], status: "failed" },
        });
      });
      return { turn: { id: "turn-failed-test", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    const lines: string[] = [];
    await runRuntimeSendCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "anything",
      output: (l) => lines.push(l),
      turnTimeoutMs: 5_000,
      clientName: "test",
      clientVersion: "0.0.0",
    });
    await fake.stop();

    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const types = events.map((e) => e.type);
    expect(types).toContain("turn_failed");
  });

  it("breaks the event loop on turn_interrupted terminal event", async () => {
    const fake = new FakeAppServer();
    setupThreadStart(fake);
    fake.respondTo("turn/start", () => {
      queueMicrotask(() => {
        fake.emitNotification("turn/completed", {
          threadId: "thread-terminal-test",
          turn: { id: "turn-interrupted-test", items: [], status: "interrupted" },
        });
      });
      return { turn: { id: "turn-interrupted-test", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    const lines: string[] = [];
    await runRuntimeSendCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "anything",
      output: (l) => lines.push(l),
      turnTimeoutMs: 5_000,
      clientName: "test",
      clientVersion: "0.0.0",
    });
    await fake.stop();

    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const types = events.map((e) => e.type);
    expect(types).toContain("turn_interrupted");
  });

  it("throws with timeout message when turn never reaches terminal", async () => {
    const fake = new FakeAppServer();
    setupThreadStart(fake);
    fake.respondTo("turn/start", () => {
      // Never emits a terminal turn event — the runtime-send timeout
      // should fire and throw.
      return { turn: { id: "turn-stuck-test", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });
    await expect(
      runRuntimeSendCore({
        transport: fake.clientSide,
        logger: log,
        prompt: "anything",
        output: () => {},
        turnTimeoutMs: 80,
        clientName: "test",
        clientVersion: "0.0.0",
      }),
    ).rejects.toThrow(/did not complete within 80ms/);

    await fake.stop();
  });
});

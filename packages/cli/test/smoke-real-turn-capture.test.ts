// T2 (Phase 1): smoke:real-turn --capture flow against FakeAppServer.
//
// Lives under the smoke-* exclude pattern (not in default unit gate)
// because the file is named alongside future subprocess tests. Runs
// via `pnpm test:cli-smoke` and via `bash scripts/ci-check.sh`
// (the script lands in T3).
//
// Verifies T2 capture wiring without spawning a real codex:
//   - FakeAppServer responds to initialize / thread/start / turn/start
//   - emits an inbound notification + a turn/completed terminator
//   - runSmokeRealTurnCore taps the transport via attachCapture()
//   - capture file contains exactly one JSONL line per inbound message,
//     and every line is parseable JSON.
//
// Codex outside-voice required-test: "CLI tests for --capture, --prompt-file,
// and --cwd included in the default test gate" — argv tests live in
// cli-flags.test.ts (default gate); transport-injected capture flow
// lives here (cli-smoke gate; required by ci-check.sh).

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAppServer } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { runSmokeRealTurnCore } from "../src/smoke-real-turn.js";

describe("runSmokeRealTurnCore --capture (FakeAppServer-injected)", () => {
  it("writes one JSONL line per inbound message and exits cleanly", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-im-capture-"));
    const capturePath = join(tmp, "out.jsonl");

    const fake = new FakeAppServer();

    // FakeAppServer's default handler covers `initialize`. Add the rest:
    fake.respondTo("thread/start", () => ({ thread: { id: "thread-test-1" } }));
    fake.respondTo("turn/start", () => {
      // Schedule the inbound notifications AFTER turn/start's response is
      // sent, to mimic real codex ordering: response first, then deltas,
      // then the terminal turn/completed.
      queueMicrotask(() => {
        fake.emitNotification("item/agentMessage/delta", {
          threadId: "thread-test-1",
          turnId: "turn-test-1",
          delta: "OK",
        });
        fake.emitNotification("turn/completed", {
          threadId: "thread-test-1",
          turnId: "turn-test-1",
        });
      });
      return { turn: { id: "turn-test-1" } };
    });

    const log = pino({ level: "silent" });

    await runSmokeRealTurnCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "Reply OK",
      capturePath,
      turnTimeoutMs: 5_000,
      clientName: "test-smoke",
      clientVersion: "0.0.0-test",
    });

    await fake.stop();

    const text = readFileSync(capturePath, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);

    // Each line must parse as JSON — capture format is JSONL.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    // Inbound messages over the lifecycle should include:
    //   - 1 response to initialize
    //   - 1 response to thread/start
    //   - 1 response to turn/start
    //   - 1 item/agentMessage/delta notification
    //   - 1 turn/completed notification
    expect(parsed.length).toBeGreaterThanOrEqual(5);

    const methods = parsed
      .filter((p) => typeof p.method === "string")
      .map((p) => p.method as string);
    expect(methods).toContain("item/agentMessage/delta");
    expect(methods).toContain("turn/completed");

    // Response envelopes carry an id but no method (per JSON-RPC lite shape).
    const responseCount = parsed.filter((p) => "id" in p && !("method" in p)).length;
    expect(responseCount).toBeGreaterThanOrEqual(3); // initialize, thread/start, turn/start
  });

  it("ApprovalBroker default-denies every server request (Phase 1 tag-gate fix: smoke now uses broker)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-im-capture-"));
    const capturePath = join(tmp, "out.jsonl");

    const fake = new FakeAppServer();
    fake.respondTo("thread/start", () => ({ thread: { id: "thread-test-2" } }));

    // Track the rejection envelope from the broker's per-method
    // default-reject path. Pre-T8 the smoke used a throwing
    // setServerRequestHandler that produced -32603; now ApprovalBroker
    // returns shape-correct responses per DispatchTable. For
    // item/commandExecution/requestApproval that's
    // {decision: "decline"} (Phase 1 never auto-approve; T9b contract).
    let serverRequestResult: { ok: true; value: unknown } | { ok: false; error: unknown } | null =
      null;

    fake.respondTo("turn/start", () => {
      // Fire a server-initiated request mid-turn; expect broker default-deny.
      queueMicrotask(async () => {
        try {
          const value = await fake.emitServerRequest(
            "item/commandExecution/requestApproval",
            { fake: true },
            123,
            { timeoutMs: 1_000 },
          );
          serverRequestResult = { ok: true, value };
        } catch (err) {
          serverRequestResult = { ok: false, error: err };
        } finally {
          // Then complete the turn so runSmokeRealTurnCore returns.
          fake.emitNotification("turn/completed", {
            threadId: "thread-test-2",
            turn: { id: "turn-test-2", items: [], status: "completed" },
          });
        }
      });
      return { turn: { id: "turn-test-2", items: [], status: "inProgress" } };
    });

    const log = pino({ level: "silent" });

    await runSmokeRealTurnCore({
      transport: fake.clientSide,
      logger: log,
      prompt: "trigger an approval",
      capturePath,
      turnTimeoutMs: 5_000,
      clientName: "test-smoke-reject",
      clientVersion: "0.0.0-test",
    });

    await fake.stop();

    // The server request resolves successfully with the broker's
    // per-method default-reject shape. {decision:"decline"} per T9b's
    // contract. The smoke is "rejecting" by giving codex a denied
    // decision; codex sees a successful response with decision=decline
    // rather than a -32603 handler error.
    expect(serverRequestResult).not.toBeNull();
    expect(serverRequestResult).toMatchObject({ ok: true, value: { decision: "decline" } });
  });
});

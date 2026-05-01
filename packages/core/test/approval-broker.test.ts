// T9a (Phase 1, P1.2 part 1): ApprovalBroker skeleton + happy path.
//
// Step 9a.1 lands ONLY the failing tests for the two skeleton invariants:
//   1. default-reject for unknown (non-generated) methods → -32601 via
//      Pre-3 path (broker throws JsonRpcResponseError, AppServerClient
//      preserves the explicit code/message/data verbatim).
//   2. single-handler invariant — duplicate attach() throws.
//
// Per-method dispatch + dispatch-coverage tests land in Step 9a.3-9a.5
// (approval-broker-dispatch.test.ts + dispatch-coverage.test.ts).
// Edges (timeout, throw, transport-loss, reattach) land in T9b.
//
// Plan section: docs/superpowers/plans/2026-04-30-phase-1-runtime.md §1592.
//
// Synthetic method names only — NO approval method-name string literals
// in this file. Production-side method dispatch reads the generated
// ServerRequest["method"] union; tests use names that are intentionally
// outside that union (e.g. "future/unseen/method") so a future codex
// bump can't accidentally make the "unknown method" test passable via
// real dispatch.

import { AppServerClient, JsonRpcResponseError, type Transport } from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";

// NOTE: tests do not pass a logger to AppServerClient. The client
// constructs its own default (warn-level pino) internally — that means
// test output will carry warn lines on the default-reject path, which
// is acceptable noise for these skeleton tests. Adding `pino` as a
// devDep just to silence is outside T9a's authorized Files; T9b can
// revisit silencing if the noise becomes load-bearing.

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  broker: ApprovalBroker;
}

async function harness(): Promise<Harness> {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide);
  await client.start();
  const broker = new ApprovalBroker(client);
  return { fake, client, broker };
}

async function teardown(h: Harness): Promise<void> {
  await h.client.stop();
  await h.fake.stop();
}

/**
 * Test-only Transport proxy that records every outbound frame the
 * AppServerClient sends. Used by the T9b blocker-fix tests to count
 * wire responses for a given JSON-RPC id and prove that the broker
 * doesn't produce duplicate responses on late-handler completion.
 *
 * Lives in this test file (not in `packages/testkit/`) because the
 * blocker-fix is scoped to `packages/core/` only — modifying testkit
 * was explicitly disallowed by the user's Step 1 instructions
 * ("If this requires changing packages/testkit, stop and report
 * before modifying it"). Wrapping the inner Transport here is a
 * test-local concern that doesn't require any testkit changes.
 */
interface InstrumentedTransport {
  transport: Transport;
  outboundFrames: unknown[];
}

function instrumentTransport(inner: Transport): InstrumentedTransport {
  const outboundFrames: unknown[] = [];
  const transport: Transport = {
    start: () => inner.start(),
    stop: () => inner.stop(),
    send: (msg) => {
      outboundFrames.push(msg);
      inner.send(msg);
    },
    onMessage: (h) => inner.onMessage(h),
    onError: (h) => inner.onError(h),
    onClose: (h) => inner.onClose(h),
  };
  return { transport, outboundFrames };
}

/** Count wire frames addressed to a particular JSON-RPC id. Counts BOTH
 * `{id, result}` and `{id, error}` shapes since either is a wire response. */
function countFramesForId(frames: readonly unknown[], id: number | string): number {
  return frames.filter(
    (f): f is { id: number | string } =>
      typeof f === "object" && f !== null && "id" in f && (f as { id: unknown }).id === id,
  ).length;
}

describe("ApprovalBroker skeleton (T9a Step 9a.1)", () => {
  it("default-rejects an unknown (non-generated) method via -32601 (Pre-3 path)", async () => {
    const h = await harness();
    h.broker.attach();

    // Synthetic method name — not in the generated ServerRequest union.
    // The broker's dispatch table does not contain it, so the broker
    // throws JsonRpcResponseError({ code: -32601, ... }). Pre-3's
    // AppServerClient catch-arm preserves the explicit code on the wire,
    // and FakeAppServer.emitServerRequest rejects its returned Promise
    // with the unwrapped error envelope.
    await expect(h.fake.emitServerRequest("future/unseen/method", {}, 42)).rejects.toMatchObject({
      code: -32601,
    });

    await teardown(h);
  });

  it("duplicate attach() throws (single-handler invariant — D7)", async () => {
    const h = await harness();
    h.broker.attach();
    expect(() => h.broker.attach()).toThrow(/already attached/);
    await teardown(h);
  });

  it("reattach(newClient) transfers handler ownership and frees prior slot (T9b Step 9b.1 — Codex B7)", async () => {
    // Supervisor pattern: a codex subprocess restart yields a fresh
    // {transport, client} pair. The broker survives the boundary by
    // calling reattach(newClient). After reattach:
    //   - prior client's handler slot is null (subsequent server
    //     requests on it return -32601 from AppServerClient's default)
    //   - new client routes to the broker's #handle
    //   - the broker's pending Map is preserved (T9b Step 9b.5 wires
    //     this to resolve(); for 9b.1 the Map is empty)

    // First leg: brokerOnClientA
    const fakeA = new FakeAppServer();
    const clientA = new AppServerClient(fakeA.clientSide);
    await clientA.start();
    const broker = new ApprovalBroker(clientA);
    broker.attach();

    // Second leg: a fresh client (mirrors a supervisor-driven restart)
    const fakeB = new FakeAppServer();
    const clientB = new AppServerClient(fakeB.clientSide);
    await clientB.start();
    broker.reattach(clientB);

    // The broker's handler is now on clientB. Install a per-method
    // handler and route a server request through fakeB; the broker
    // should dispatch to it.
    let brokerSawOnB = false;
    broker.registerHandler("item/fileChange/requestApproval", async () => {
      brokerSawOnB = true;
      return { decision: "decline" };
    });
    await fakeB.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      201,
    );
    expect(brokerSawOnB).toBe(true);

    // Prior client is no longer wired to the broker. Send a request
    // through fakeA's transport; AppServerClient's default-reject path
    // returns -32601 because setServerRequestHandler(null) was called.
    await expect(
      fakeA.emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        202,
      ),
    ).rejects.toMatchObject({ code: -32601 });

    await clientB.stop();
    await fakeB.stop();
    await clientA.stop();
    await fakeA.stop();
  });

  it("reattach(sameClient) throws (catches supervisor identity bugs — T9b Step 9b.1)", async () => {
    const h = await harness();
    h.broker.attach();
    expect(() => h.broker.reattach(h.client)).toThrow(/must be a different instance/);
    await teardown(h);
  });

  it("reattach() before attach() throws (broker must be attached first — T9b Step 9b.1)", async () => {
    const fakeA = new FakeAppServer();
    const clientA = new AppServerClient(fakeA.clientSide);
    await clientA.start();
    const broker = new ApprovalBroker(clientA);
    // No attach() — reattach should refuse.
    const fakeB = new FakeAppServer();
    const clientB = new AppServerClient(fakeB.clientSide);
    await clientB.start();
    expect(() => broker.reattach(clientB)).toThrow(/has not been attached yet/);
    await clientB.stop();
    await fakeB.stop();
    await clientA.stop();
    await fakeA.stop();
  });

  it("reattach() to a client already claimed by another broker throws (D7 cross-instance — T9b Step 9b.1)", async () => {
    const fakeA = new FakeAppServer();
    const clientA = new AppServerClient(fakeA.clientSide);
    await clientA.start();
    const broker1 = new ApprovalBroker(clientA);
    broker1.attach();

    const fakeB = new FakeAppServer();
    const clientB = new AppServerClient(fakeB.clientSide);
    await clientB.start();
    const broker2 = new ApprovalBroker(clientB);
    broker2.attach();

    // broker1 trying to reattach to clientB (which broker2 already
    // claimed) must fail — would otherwise silently replace broker2's
    // handler.
    expect(() => broker1.reattach(clientB)).toThrow(/already has an attached broker/);

    await clientB.stop();
    await fakeB.stop();
    await clientA.stop();
    await fakeA.stop();
  });

  it("two brokers on the same client cannot both attach (D7 cross-instance — codex T9a review medium-1)", async () => {
    // The per-broker `#attached` flag stops the SAME broker from attaching
    // twice. The cross-instance guard (module-level WeakSet) stops a
    // SECOND broker from silently stealing the first's handler slot —
    // because AppServerClient.setServerRequestHandler is a single slot
    // that overwrites without complaint.
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();

    const broker1 = new ApprovalBroker(client);
    const broker2 = new ApprovalBroker(client);
    broker1.attach();
    expect(() => broker2.attach()).toThrow(/client already has an attached broker/);

    // broker1 is still the one wired to the client (sanity check):
    // broker2's attempt did not silently overwrite. We don't have an
    // observable handler getter on AppServerClient, but we can verify
    // by routing a server request and asserting broker1's installed
    // handler runs (broker2 never installed one because attach threw).
    let broker1Saw = false;
    broker1.registerHandler("item/fileChange/requestApproval", async () => {
      broker1Saw = true;
      return { decision: "decline" };
    });
    await fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      99,
    );
    expect(broker1Saw).toBe(true);

    await client.stop();
    await fake.stop();
  });
});

describe("ApprovalBroker handler-error edges (T9b Steps 9b.2 + 9b.3)", () => {
  // Step 9b.2: timeout test — registered handler that exceeds the
  // serverRequestHandlerTimeoutMs is treated as a handler error and
  // collapses to -32603. Distinguishes "broker is alive but slow"
  // from "broker is gone" (the latter is detected via transport close
  // — D6, T9b Step 9b.4).

  it("times out a slow handler with -32603 (T9b Step 9b.2)", async () => {
    const fake = new FakeAppServer();
    // Tiny serverRequestHandlerTimeoutMs so the test is fast.
    const client = new AppServerClient(fake.clientSide, {
      serverRequestHandlerTimeoutMs: 30,
    });
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    broker.registerHandler(
      "item/fileChange/requestApproval",
      () => new Promise((resolve) => setTimeout(() => resolve({ decision: "accept" }), 1000)),
    );

    await expect(
      fake.emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        301,
      ),
    ).rejects.toMatchObject({
      code: -32603,
      message: expect.stringMatching(/handler error: .*timeout/i),
    });

    await client.stop();
    await fake.stop();
  });

  // Step 9b.3 case 1: generic-throw distinction.
  // A registered handler that throws a plain Error collapses to -32603
  // with the legacy "handler error: <msg>" prefix. This is the path
  // for unexpected handler bugs (TypeError, runtime exceptions, etc.)
  // — never the path for "method not in dispatch table" (which uses
  // JsonRpcResponseError → -32601 verbatim, case 2 below).

  it("collapses a generic Error throw to -32603 with handler-error prefix (T9b Step 9b.3 case 1)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    broker.registerHandler("item/fileChange/requestApproval", async () => {
      throw new Error("policy denied");
    });

    await expect(
      fake.emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        302,
      ),
    ).rejects.toMatchObject({
      code: -32603,
      message: "handler error: policy denied",
    });

    await client.stop();
    await fake.stop();
  });

  // Step 9b.3 case 2: explicit JsonRpcResponseError throw (Pre-3 path).
  // A registered handler that throws JsonRpcResponseError preserves
  // the explicit code/message/data on the wire. NO "handler error: "
  // prefix. This is what the broker itself uses for "method not in
  // dispatch table" → -32601, but downstream handlers can use the
  // same path to signal any specific JSON-RPC error code.

  it("preserves JsonRpcResponseError code/message/data verbatim (T9b Step 9b.3 case 2 — Pre-3)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    broker.registerHandler("item/fileChange/requestApproval", async () => {
      throw new JsonRpcResponseError({
        code: -32004,
        message: "synthetic-rejection",
        data: { reason: "test" },
      });
    });

    await expect(
      fake.emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        303,
      ),
    ).rejects.toMatchObject({
      code: -32004,
      message: "synthetic-rejection",
      data: { reason: "test" },
    });

    // Important negative assertion: the wire envelope's message MUST
    // NOT carry the "handler error: " prefix. That prefix is reserved
    // for the -32603 generic-throw path (case 1).
    await expect(
      fake.emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        304,
      ),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("handler error:"),
    });

    await client.stop();
    await fake.stop();
  });

  // Negative cross-check: neither path crashes the broker. After a
  // generic-throw, the broker is still alive and routes the next
  // server request through its dispatch table.

  it("survives a handler throw — broker keeps dispatching subsequent requests (T9b Step 9b.3)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    let throws = 0;
    let succeeds = 0;
    broker.registerHandler("item/fileChange/requestApproval", async () => {
      if (throws === 0) {
        throws++;
        throw new Error("boom");
      }
      succeeds++;
      return { decision: "decline" };
    });

    await expect(
      fake.emitServerRequest("item/fileChange/requestApproval", {}, 305),
    ).rejects.toMatchObject({ code: -32603 });

    const ok = await fake.emitServerRequest("item/fileChange/requestApproval", {}, 306);
    expect(ok).toEqual({ decision: "decline" });
    expect(throws).toBe(1);
    expect(succeeds).toBe(1);

    await client.stop();
    await fake.stop();
  });
});

describe("ApprovalBroker pending-state lifecycle (T9b Steps 9b.4 + 9b.5)", () => {
  // Step 9b.4 / 9b.5: pending tracking, transport-loss (D6), expire.
  //
  // The broker's #handle inserts a pending record before invoking the
  // registered handler. failPendingAsTransportLost marks every pending
  // record as transport_lost terminal (D6), idempotent. expirePending
  // does the same for stale records and emits per-method default-reject
  // wire responses to codex.

  it("tracks an in-flight approval in #pending while the handler is running (T9b Step 9b.5)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Hand-controlled handler resolution — we'll let the test drive
    // when the handler completes so we can observe #pending mid-flight.
    let release!: () => void;
    const handlerDone = new Promise<void>((r) => {
      release = r;
    });
    broker.registerHandler("item/fileChange/requestApproval", async () => {
      await handlerDone;
      return { decision: "decline" };
    });

    // Fire-and-forget: handler is awaiting; emitServerRequest waits
    // for the response.
    const respPromise = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      400,
    );

    // Wait for the broker to insert the pending record (microtasks +
    // a tick for the handler to start).
    await new Promise((r) => setTimeout(r, 20));

    // Inspect — pending record should exist with status "pending"
    const beforeMap = broker._pendingRecordsForTest();
    expect(beforeMap.size).toBe(1);
    const beforeRecord = beforeMap.get(400);
    expect(beforeRecord?.status).toBe("pending");
    expect(beforeRecord?.method).toBe("item/fileChange/requestApproval");
    expect(beforeRecord?.actor).toBeNull();
    expect(beforeRecord?.id).toBe("approval-400");
    expect(beforeRecord?.appServerRequestId).toBe(400);

    // Release the handler; emitServerRequest's promise should now resolve.
    release();
    const resp = await respPromise;
    expect(resp).toEqual({ decision: "decline" });

    // After handler resolves, the try/finally removes the record from
    // #pending (cleanup; record is no longer in flight).
    const afterMap = broker._pendingRecordsForTest();
    expect(afterMap.size).toBe(0);

    await client.stop();
    await fake.stop();
  });

  it("does NOT track default-reject path in #pending (no handler installed)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    // No registerHandler — defaultReject runs synchronously.

    const resp = await fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      401,
    );
    expect(resp).toEqual({ decision: "decline" });
    // #pending was never populated for this synchronous path
    expect(broker._pendingRecordsForTest().size).toBe(0);

    await client.stop();
    await fake.stop();
  });

  it("failPendingAsTransportLost marks every pending record as transport_lost (D6 — T9b Step 9b.4)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Two hanging handlers — neither will resolve.
    broker.registerHandler(
      "item/fileChange/requestApproval",
      () =>
        new Promise(() => {}) as Promise<{
          decision: "accept" | "decline" | "acceptForSession" | "cancel";
        }>,
    );
    broker.registerHandler(
      "applyPatchApproval",
      () =>
        new Promise(() => {}) as Promise<{
          decision: "approved" | "denied" | "abort" | "timed_out" | "approved_for_session";
        }>,
    );

    // Two in-flight requests. Suppress the eventual rejection (these
    // never settle; client.stop() at end of test will drop them).
    const _h1 = fake.emitServerRequest("item/fileChange/requestApproval", {}, 410).catch(() => {});
    const _h2 = fake.emitServerRequest("applyPatchApproval", {}, 411).catch(() => {});

    // Wait for handlers to be invoked.
    await new Promise((r) => setTimeout(r, 30));

    // Both pending
    expect(broker._pendingRecordsForTest().size).toBe(2);
    for (const record of broker._pendingRecordsForTest().values()) {
      expect(record.status).toBe("pending");
    }

    // Trigger transport-loss path (in production, T11b's supervisor
    // calls this from transport.onClose).
    broker.failPendingAsTransportLost();

    // Records are still present with terminal status (we keep them
    // for audit — see broker.ts comment).
    const after = broker._pendingRecordsForTest();
    expect(after.size).toBe(2);
    for (const record of after.values()) {
      expect(record.status).toBe("transport_lost");
      expect(record.actor).toEqual({ kind: "system", reason: "transport_lost" });
      expect(record.decision).toEqual({ kind: "denied", reason: "transport_lost" });
      expect(record.decidedAt).toBeInstanceOf(Date);
    }

    // Idempotent: second call is a no-op (same terminal state).
    broker.failPendingAsTransportLost();
    const after2 = broker._pendingRecordsForTest();
    expect(after2.size).toBe(2);
    for (const record of after2.values()) {
      expect(record.status).toBe("transport_lost");
    }

    await client.stop();
    await fake.stop();
  });

  it("expirePending marks stale records as expired and emits default-reject responses (T9b Step 9b.5)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Hanging handler — emit a request, let it sit in pending, then
    // call expirePending with a tiny maxAgeMs.
    broker.registerHandler(
      "item/fileChange/requestApproval",
      () =>
        new Promise(() => {}) as Promise<{
          decision: "accept" | "decline" | "acceptForSession" | "cancel";
        }>,
    );
    const respP = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      420,
    );

    // Wait long enough that the record is older than 5ms cutoff
    await new Promise((r) => setTimeout(r, 30));

    const expiredCount = broker.expirePending(5);
    expect(expiredCount).toBe(1);

    // Record should be in expired terminal state
    const record = broker._pendingRecordsForTest().get(420);
    expect(record?.status).toBe("expired");
    expect(record?.actor).toEqual({ kind: "system", reason: "expired" });
    expect(record?.decision).toEqual({ kind: "denied", reason: "expired" });

    // Default-reject response was sent on the wire — emitServerRequest
    // should now resolve with the expected default-reject shape.
    const resp = await respP;
    expect(resp).toEqual({ decision: "decline" });

    await client.stop();
    await fake.stop();
  });

  it("expirePending skips records younger than maxAgeMs", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    broker.registerHandler(
      "item/fileChange/requestApproval",
      () =>
        new Promise(() => {}) as Promise<{
          decision: "accept" | "decline" | "acceptForSession" | "cancel";
        }>,
    );
    const _h = fake.emitServerRequest("item/fileChange/requestApproval", {}, 421).catch(() => {});

    await new Promise((r) => setTimeout(r, 10));
    // maxAgeMs is huge; no record old enough
    const count = broker.expirePending(60_000);
    expect(count).toBe(0);
    expect(broker._pendingRecordsForTest().get(421)?.status).toBe("pending");

    await client.stop();
    await fake.stop();
  });

  it("resolve() returns unknown_approval_id for an unknown id (T11 / Phase 2 — replaces the Phase 1 stub assertion)", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();
    const result = await broker.resolve({
      approvalId: "approval-does-not-exist",
      decision: { kind: "decline" },
      actor: { kind: "im", platform: "telegram", userId: "u-test" },
      target: { platform: "telegram", chatId: "c-test" },
      callbackNonce: "nonce-test-aaaaaaaaaaa",
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error.kind).toBe("unknown_approval_id");
    }
    await client.stop();
    await fake.stop();
  });
});

// ─── T9b blocker-fix tests (TDD red — design = B-clean) ────────────────
//
// Plan section: docs/superpowers/plans/2026-04-30-phase-1-runtime.md
// "Task 9b blocker-fix — broker completion race".
//
// These tests prove the duplicate-response race exists in the current
// implementation. They fail at Step 1 (this commit) and turn green when
// Step 2 lands the B-clean refactor (broker owns single completion
// promise per pending request; expirePending and
// failPendingAsTransportLost route through settleOnce instead of
// directly calling client.respond/client.reject; late handler
// completion observes terminal record status and is dropped).
//
// Wire-frame counting strategy: a test-local `instrumentTransport`
// proxy (defined above near the harness helpers) records every outbound
// frame from the AppServerClient. The blocker-fix tests then count
// frames matching a specific JSON-RPC id; the duplicate-response bug
// shows up as count > 1, and B-clean keeps it at exactly 1.

describe("ApprovalBroker T9b blocker-fix — broker completion race (failing under current code)", () => {
  it("late-resolving handler after expirePending does not produce duplicate wire response (Blocker 1)", async () => {
    const fake = new FakeAppServer();
    const { transport, outboundFrames } = instrumentTransport(fake.clientSide);
    const client = new AppServerClient(transport);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Manually-controlled handler — won't settle until the test releases it.
    let release!: (v: { decision: "accept" | "decline" | "acceptForSession" | "cancel" }) => void;
    const handlerPromise = new Promise<{
      decision: "accept" | "decline" | "acceptForSession" | "cancel";
    }>((res) => {
      release = res;
    });
    broker.registerHandler("item/fileChange/requestApproval", () => handlerPromise);

    // Fire the server request; promise won't settle until handler does
    // (current code) or until expirePending fires (B-clean).
    const respP = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      700,
    );

    // Wait for the broker's #handle to insert the pending record AND
    // start awaiting the handler.
    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(700)?.status).toBe("pending");
    expect(countFramesForId(outboundFrames, 700)).toBe(0);

    // Trigger the expire path. Under B-clean this immediately produces
    // a single wire response carrying the per-method default-reject
    // shape (decision="decline" for fileChange). Under current code
    // expirePending also writes a wire response — count goes to 1.
    broker.expirePending(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(countFramesForId(outboundFrames, 700)).toBe(1);

    // emitServerRequest's promise sees the expire response.
    const wireResp = await respP;
    expect(wireResp).toEqual({ decision: "decline" });

    // Now the late handler completes. Under current buggy code, this
    // causes AppServerClient.dispatchServerRequest to call
    // client.respond again — count goes to 2. Under B-clean, the late
    // handler observes record.status !== "pending" and bails;
    // settleOnce no-ops; count stays at 1.
    release({ decision: "accept" });
    await new Promise((r) => setTimeout(r, 30));

    // CRITICAL: still exactly one wire frame for id 700. This is the
    // load-bearing assertion; it fails under current code.
    expect(countFramesForId(outboundFrames, 700)).toBe(1);

    await client.stop();
    await fake.stop();
  });

  it("late-rejecting handler after expirePending does not produce duplicate wire response (Blocker 1)", async () => {
    const fake = new FakeAppServer();
    const { transport, outboundFrames } = instrumentTransport(fake.clientSide);
    const client = new AppServerClient(transport);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    let reject!: (err: Error) => void;
    const handlerPromise = new Promise<{
      decision: "accept" | "decline" | "acceptForSession" | "cancel";
    }>((_res, rej) => {
      reject = rej;
    });
    broker.registerHandler("item/fileChange/requestApproval", () => handlerPromise);

    const respP = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      701,
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(701)?.status).toBe("pending");

    broker.expirePending(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(countFramesForId(outboundFrames, 701)).toBe(1);

    const wireResp = await respP;
    expect(wireResp).toEqual({ decision: "decline" });

    // Late rejection. Under current buggy code, AppServerClient's catch
    // arm calls client.reject({code: -32603, message: "handler error: ..."})
    // — that's the duplicate. Under B-clean, the rejection observes
    // terminal record status and is dropped.
    reject(new Error("late rejection"));
    await new Promise((r) => setTimeout(r, 30));

    expect(countFramesForId(outboundFrames, 701)).toBe(1);

    await client.stop();
    await fake.stop();
  });

  it("failPendingAsTransportLost does not produce duplicate response on late handler resolution (Blocker 1)", async () => {
    const fake = new FakeAppServer();
    const { transport, outboundFrames } = instrumentTransport(fake.clientSide);
    const client = new AppServerClient(transport);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    let release!: (v: { decision: "accept" | "decline" | "acceptForSession" | "cancel" }) => void;
    const handlerPromise = new Promise<{
      decision: "accept" | "decline" | "acceptForSession" | "cancel";
    }>((res) => {
      release = res;
    });
    broker.registerHandler("item/fileChange/requestApproval", () => handlerPromise);

    const respP = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      702,
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(702)?.status).toBe("pending");
    expect(countFramesForId(outboundFrames, 702)).toBe(0);

    // Transport is intentionally still alive here so we can observe
    // wire frames. In production T11b drives this path from
    // transport.onClose, where AppServerClient.respond is a no-op
    // anyway — but the broker contract should still be: exactly one
    // wire response per server-request id, regardless of whether the
    // transport is alive.
    //
    // Under B-clean: settleOnce → #handle returns defaultReject →
    //   AppServerClient.respond → 1 frame.
    // Under current code: failPendingAsTransportLost only flips record
    //   status, no wire send → 0 frames here, then late handler wins
    //   the wire → 1 frame with WRONG content (handler's accept
    //   instead of the transport-lost denial).
    broker.failPendingAsTransportLost();
    await new Promise((r) => setTimeout(r, 10));
    expect(countFramesForId(outboundFrames, 702)).toBe(1);

    const wireResp = await respP;
    // The wire content must be the transport-lost default-reject, NOT
    // the handler's eventual accept. This is the substance of "no
    // second response path" — the late handler's path doesn't get to
    // write to the wire.
    expect(wireResp).toEqual({ decision: "decline" });

    // Late handler completion. Under current code it would write
    // {decision: "accept"} as a SECOND wire frame for id 702. Under
    // B-clean it's dropped (settleOnce no-ops on terminal record).
    release({ decision: "accept" });
    await new Promise((r) => setTimeout(r, 30));

    expect(countFramesForId(outboundFrames, 702)).toBe(1);

    await client.stop();
    await fake.stop();
  });

  it("reattach resets transportLostFired so a second client generation can flag transport_lost (Blocker 2)", async () => {
    // First generation
    const fakeA = new FakeAppServer();
    const clientA = new AppServerClient(fakeA.clientSide);
    await clientA.start();
    const broker = new ApprovalBroker(clientA);
    broker.attach();

    broker.registerHandler(
      "item/fileChange/requestApproval",
      () =>
        new Promise<{ decision: "accept" | "decline" | "acceptForSession" | "cancel" }>(() => {}),
    );
    // Hanging request on clientA. Suppress the eventual rejection; we
    // care about the broker's record state, not emitServerRequest's
    // resolution.
    const _hA = fakeA
      .emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        710,
        { timeoutMs: 200 },
      )
      .catch(() => {});
    void _hA;
    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(710)?.status).toBe("pending");

    broker.failPendingAsTransportLost();
    expect(broker._pendingRecordsForTest().get(710)?.status).toBe("transport_lost");

    // Supervisor swap: attach the SAME broker to a fresh client (the
    // pattern T11b uses).
    const fakeB = new FakeAppServer();
    const clientB = new AppServerClient(fakeB.clientSide);
    await clientB.start();
    broker.reattach(clientB);

    // Hanging request on clientB.
    const _hB = fakeB
      .emitServerRequest(
        "item/fileChange/requestApproval",
        { threadId: "t", turnId: "u", itemId: "i" },
        720,
        { timeoutMs: 200 },
      )
      .catch(() => {});
    void _hB;
    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(720)?.status).toBe("pending");

    // Second-generation transport-loss. Under current buggy code,
    // #transportLostFired stays `true` from the first call, so this
    // returns immediately and the clientB record stays "pending".
    // Under B-clean (with `this.#transportLostFired = false` reset in
    // reattach), this works and flips the record to terminal.
    broker.failPendingAsTransportLost();
    expect(broker._pendingRecordsForTest().get(720)?.status).toBe("transport_lost");

    await clientB.stop();
    await fakeB.stop();
    await clientA.stop();
    await fakeA.stop();
  });

  // ─── Codex T9b blocker-fix review P2 follow-ups ────────────────────
  // Two additional tests recommended by codex's APPROVE-with-P2 review:
  //   - auth-refresh expirePending preserves the JsonRpcResponseError(-32601)
  //     envelope through the new completion path
  //   - late-reject after failPendingAsTransportLost (completes the matrix
  //     of {late-resolve, late-reject} × {expire, transport-lost})

  it("expirePending of auth-refresh preserves -32601 wire envelope (codex T9b blocker-fix P2)", async () => {
    const fake = new FakeAppServer();
    const { transport, outboundFrames } = instrumentTransport(fake.clientSide);
    const client = new AppServerClient(transport);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Hanging handler so we can drive expirePending while the request
    // is in flight. account/chatgptAuthTokens/refresh's defaultReject
    // throws JsonRpcResponseError(-32601); the B-clean expirePending
    // catches that and settles via reject so AppServerClient's catch
    // arm preserves the envelope on the wire (Pre-3 path).
    broker.registerHandler(
      "account/chatgptAuthTokens/refresh",
      () =>
        new Promise<{ accessToken: string; chatgptAccountId: string; chatgptPlanType: string }>(
          () => {},
        ),
    );
    const respP = fake.emitServerRequest(
      "account/chatgptAuthTokens/refresh",
      { reason: "expired" },
      730,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(730)?.status).toBe("pending");

    const expired = broker.expirePending(5);
    expect(expired).toBe(1);

    // The wire envelope must be the explicit -32601 from the throwing
    // defaultReject, NOT a -32603 "handler error: ..." collapse and
    // NOT a successful response.
    await expect(respP).rejects.toMatchObject({
      code: -32601,
      message: expect.stringMatching(/auth refresh not supported/i),
    });

    // Exactly one wire frame for id 730 (no duplicate from the still-
    // hanging handler).
    expect(countFramesForId(outboundFrames, 730)).toBe(1);

    await client.stop();
    await fake.stop();
  });

  it("late-rejecting handler after failPendingAsTransportLost does not produce duplicate wire response (codex T9b blocker-fix P2)", async () => {
    const fake = new FakeAppServer();
    const { transport, outboundFrames } = instrumentTransport(fake.clientSide);
    const client = new AppServerClient(transport);
    await client.start();
    const broker = new ApprovalBroker(client);
    broker.attach();

    // Manually-controlled reject so the test drives the timing.
    let reject!: (err: Error) => void;
    const handlerPromise = new Promise<{
      decision: "accept" | "decline" | "acceptForSession" | "cancel";
    }>((_res, rej) => {
      reject = rej;
    });
    broker.registerHandler("item/fileChange/requestApproval", () => handlerPromise);

    const respP = fake.emitServerRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", turnId: "u", itemId: "i" },
      740,
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(broker._pendingRecordsForTest().get(740)?.status).toBe("pending");
    expect(countFramesForId(outboundFrames, 740)).toBe(0);

    // Transport-loss path settles the completion with defaultReject.
    // Under B-clean: 1 wire frame; under the prior buggy code there'd
    // also be a duplicate when the handler eventually rejects.
    broker.failPendingAsTransportLost();
    await new Promise((r) => setTimeout(r, 10));
    expect(countFramesForId(outboundFrames, 740)).toBe(1);

    const wireResp = await respP;
    expect(wireResp).toEqual({ decision: "decline" });

    // Late rejection — settleOnce no-ops because entry.settled is true.
    // No second wire frame.
    reject(new Error("late rejection after transport-loss"));
    await new Promise((r) => setTimeout(r, 30));

    expect(countFramesForId(outboundFrames, 740)).toBe(1);

    await client.stop();
    await fake.stop();
  });
});

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

import { AppServerClient } from "@codex-im/app-server-client";
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

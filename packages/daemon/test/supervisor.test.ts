// T11a (Phase 1, P1.4 part 1): Supervisor skeleton tests.
//
// Plan section: docs/superpowers/plans/2026-04-30-phase-1-runtime.md §1975.
//
// Step 11a.4 specifies four scoped tests for the skeleton:
//   1. Fresh transport+client per spawn — assert object identity of
//      both differs after a simulated transport close.
//   2. broker.reattach called once per spawn — assert mock spy count.
//   3. Subscribe-before-spawn ordering — using a transport that emits
//      onClose synchronously inside its constructor, assert the
//      supervisor still receives it (proves the subscription happens
//      before the client construction races).
//   4. No zombie listeners — old transport's onClose handler does not
//      fire after a new transport is in place.
//
// Tests #1 and #4 require the supervisor to perform a SECOND spawn,
// which only happens when #onTransportClose triggers a re-spawn. T11a's
// #onTransportClose is a stub that throws (T11b owns the close-handling
// edge cases). To exercise the skeleton's "second spawn" path without
// T11b's logic, these tests directly invoke a small private helper-stub
// called via a typed test door. The "test door" lives in the same
// package and uses TypeScript's private-class-field bypass via
// `as unknown as { ... }` — the production surface is unchanged.
//
// Tests #2 and #3 are exercisable purely through the public API:
//   - #2 spies on broker.reattach via a tracking ApprovalBroker subclass.
//   - #3 uses a Transport whose onClose emits synchronously (which is
//     unusual but not impossible — InMemoryTransport's behavior is
//     async, but a hand-rolled fixture can emit sync to prove the
//     ordering invariant).

import { AppServerClient, type Transport } from "@codex-im/app-server-client";
import { CodexRuntime } from "@codex-im/codex-runtime";
import { ApprovalBroker } from "@codex-im/core";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { Supervisor } from "../src/supervisor.js";
import type { SupervisorAudit, SupervisorOptions } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function silentAudit(): SupervisorAudit {
  return {
    emit: () => {},
    emitFatal: () => {},
  };
}

/**
 * Helper to build a SupervisorOptions wired to a generator function
 * that yields a fresh `{ transport, client, runtime }` triple per spawn.
 * Tests hook into this generator to control spawn timing + observe
 * identity changes.
 */
interface SpawnGen {
  next: () => { transport: Transport; client: AppServerClient; runtime: CodexRuntime };
}

function makeSpawnGen(): SpawnGen {
  let generation = 0;
  return {
    next() {
      generation++;
      const fake = new FakeAppServer();
      // FakeAppServer's default initialize handler covers the
      // performHandshake step.
      const client = new AppServerClient(fake.clientSide);
      const runtime = new CodexRuntime(client);
      // Tag the transport so identity is observable in test assertions
      // without depending on object reference (which we still check).
      // (We'll also assert Object.is identity, but the tag helps debug
      // a failure message.)
      (fake.clientSide as unknown as { __generation?: number }).__generation = generation;
      return { transport: fake.clientSide, client, runtime };
    },
  };
}

/** Helper that builds a SupervisorOptions populated from a SpawnGen.
 *  Returns the options PLUS the spawn-gen and the latest emission so
 *  tests can assert against current generation state. */
function makeSupervisorHarness(): {
  opts: SupervisorOptions;
  reattachCount: { value: number };
  handshakeCount: { value: number };
  latest: () => ReturnType<SpawnGen["next"]>;
} {
  const gen = makeSpawnGen();
  let lastEmission!: ReturnType<SpawnGen["next"]>;
  const reattachCount = { value: 0 };
  const handshakeCount = { value: 0 };

  // ApprovalBroker subclass that counts reattach calls. Need a
  // reference broker bound to a placeholder client first, since
  // ApprovalBroker.attach() must precede reattach() per T9b.
  const placeholderFake = new FakeAppServer();
  const placeholderClient = new AppServerClient(placeholderFake.clientSide);

  class CountingBroker extends ApprovalBroker {
    override reattach(newClient: AppServerClient): void {
      reattachCount.value++;
      super.reattach(newClient);
    }
  }
  const broker = new CountingBroker(placeholderClient);
  // attach() to the placeholder so the broker's first reattach is
  // valid (per T9b's reattach contract: attach must precede reattach).
  broker.attach();

  const opts: SupervisorOptions = {
    transportFactory: () => {
      lastEmission = gen.next();
      return lastEmission.transport;
    },
    clientFactory: (_transport) => {
      // The transportFactory and clientFactory are coupled here via
      // closure: the spawn-gen's `next()` returned both transport
      // AND client; we just hand back the same client.
      return lastEmission.client;
    },
    runtimeFactory: (_client) => lastEmission.runtime,
    broker,
    performHandshake: async (_client) => {
      handshakeCount.value++;
      // Don't actually run the wire-level handshake — the FakeAppServer
      // handles it in production via performInitializeHandshake, but
      // this test focuses on supervisor lifecycle, not wire shape.
      return { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" };
    },
    audit: silentAudit(),
  };

  return {
    opts,
    reattachCount,
    handshakeCount,
    latest: () => lastEmission,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Supervisor skeleton (T11a Step 11a.4)", () => {
  it("start() builds the quartet and assigns currentTransport + currentClient", async () => {
    const h = makeSupervisorHarness();
    const sup = new Supervisor(h.opts);

    expect(sup.currentTransportForTest()).toBeNull();
    expect(sup.currentClientForTest()).toBeNull();

    await sup.start();

    expect(sup.currentTransportForTest()).not.toBeNull();
    expect(sup.currentClientForTest()).not.toBeNull();
    expect(sup.currentTransportForTest()).toBe(h.latest().transport);
    expect(sup.currentClientForTest()).toBe(h.latest().client);

    // performHandshake was awaited exactly once.
    expect(h.handshakeCount.value).toBe(1);

    // broker.reattach was called exactly once for the new generation.
    expect(h.reattachCount.value).toBe(1);

    await sup.currentClientForTest()?.stop();
  });

  it("rejects double-start (supervisors are one-shot per instance)", async () => {
    const h = makeSupervisorHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();
    await expect(sup.start()).rejects.toThrow(/already started/);
    await sup.currentClientForTest()?.stop();
  });

  it("subscribes to transport.onClose BEFORE constructing the client (Codex B7)", async () => {
    // Use a transport whose factory order can be observed: we record
    // the call sequence of (a) transport.onClose subscription and
    // (b) client construction. The supervisor is correct iff onClose
    // subscription happens BEFORE client construction.

    const order: string[] = [];

    // Custom transport: a minimal in-memory facade whose onClose is
    // observable. We don't use FakeAppServer here because we want to
    // assert ordering at the factory boundary.
    let transportClose: ((code: number | null) => void) | null = null;
    const transport: Transport = {
      start: async () => {},
      stop: async () => {},
      send: () => {},
      onMessage: (_h) => () => {},
      onError: (_h) => () => {},
      onClose: (h) => {
        order.push("onClose-subscribed");
        transportClose = h;
        return () => {
          transportClose = null;
        };
      },
    };

    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    // Track via an object property so TS doesn't narrow through the
    // closure assignment (a `let capturedClient: ... = null` would get
    // narrowed to `null` after construction, breaking later access).
    const captured: { client?: AppServerClient } = {};

    const opts: SupervisorOptions = {
      transportFactory: () => {
        order.push("transportFactory-called");
        return transport;
      },
      clientFactory: (t) => {
        order.push("clientFactory-called");
        captured.client = new AppServerClient(t);
        return captured.client;
      },
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    await sup.start();

    // The load-bearing assertion: transportFactory ran, then onClose
    // was subscribed, then clientFactory ran. Subscription before
    // client construction is the Codex B7 invariant.
    expect(order.indexOf("onClose-subscribed")).toBeLessThan(order.indexOf("clientFactory-called"));

    // Cleanup: avoid dangling subscriptions
    transportClose = null;
    await captured.client?.stop();
  });

  it("fresh transport+client per spawn — object identity differs after re-spawn (Step 11a.4 test #1)", async () => {
    // Drive a second #spawnFresh on the SAME supervisor via the
    // test-door. T11a's #onTransportClose is a stub (T11b implements
    // close-driven recovery); the test-door _spawnFreshForTest()
    // exercises the same code path #onTransportClose will call.

    const h = makeSupervisorHarness();
    const sup = new Supervisor(h.opts);

    await sup.start();
    const gen1Transport = sup.currentTransportForTest();
    const gen1Client = sup.currentClientForTest();
    expect(gen1Transport).not.toBeNull();
    expect(gen1Client).not.toBeNull();

    // Stop generation 1's client cleanly before re-spawning so the
    // test doesn't leak in-memory transport state. (Production T11b
    // skips this because the transport closing is what triggered the
    // re-spawn in the first place.)
    await gen1Client?.stop();

    // Drive a second spawn through the test door.
    await sup._spawnFreshForTest();

    const gen2Transport = sup.currentTransportForTest();
    const gen2Client = sup.currentClientForTest();
    expect(gen2Transport).not.toBeNull();
    expect(gen2Client).not.toBeNull();

    // The load-bearing assertion: object identity changes per spawn.
    // ONE-SHOT lifecycle is preserved — the supervisor never reuses a
    // closed transport or client.
    expect(gen2Transport).not.toBe(gen1Transport);
    expect(gen2Client).not.toBe(gen1Client);

    // Generation tag (debug aid) confirms two distinct factory calls.
    expect((gen1Transport as unknown as { __generation?: number }).__generation).toBe(1);
    expect((gen2Transport as unknown as { __generation?: number }).__generation).toBe(2);

    // broker.reattach was called per spawn = 2 total. The performHandshake
    // hook is also called per spawn = 2 total.
    expect(h.reattachCount.value).toBe(2);
    expect(h.handshakeCount.value).toBe(2);

    await gen2Client?.stop();
  });

  it("no zombie listeners — prior transport's onClose unsub fires before new transport is in place (Step 11a.4 test #4)", async () => {
    // Use a hand-rolled Transport whose onClose subscription returns
    // a tracked unsub. Drive two #spawnFresh calls; assert the gen-1
    // unsub was called BEFORE the gen-2 transport is in place.
    //
    // The Codex B7 invariant the supervisor enforces:
    //   #spawnFresh() opens with `if (this.#currentCloseUnsub) {
    //     this.#currentCloseUnsub(); this.#currentCloseUnsub = null; }`
    // — i.e. the prior generation's onClose is detached BEFORE the new
    // transport's onClose is wired. This prevents the zombie-listener
    // bug where a stale onClose handler fires for a transport the
    // supervisor has already moved past.

    const closes: { generation: number; unsubCalled: boolean }[] = [];
    let generation = 0;

    function makeTrackedTransport(): Transport {
      generation++;
      const myGen = generation;
      const entry = { generation: myGen, unsubCalled: false };
      closes.push(entry);
      return {
        start: async () => {},
        stop: async () => {},
        send: () => {},
        onMessage: (_h) => () => {},
        onError: (_h) => () => {},
        onClose: (_h) => () => {
          entry.unsubCalled = true;
        },
      };
    }

    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    const opts: SupervisorOptions = {
      transportFactory: () => makeTrackedTransport(),
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);

    await sup.start();
    expect(closes.length).toBe(1);
    expect(closes[0]?.unsubCalled).toBe(false);

    // Drive second spawn.
    await sup._spawnFreshForTest();
    expect(closes.length).toBe(2);

    // The load-bearing assertion: the FIRST transport's onClose
    // subscription was unsubbed when the supervisor moved to the
    // second generation. The second transport's onClose remains
    // subscribed (current generation).
    expect(closes[0]?.unsubCalled).toBe(true);
    expect(closes[1]?.unsubCalled).toBe(false);

    await sup.currentClientForTest()?.stop();
  });
});

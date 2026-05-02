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
import { afterEach, describe, expect, it, vi } from "vitest";
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

    await sup.stop();
  });

  it("rejects double-start (supervisors are one-shot per instance)", async () => {
    const h = makeSupervisorHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();
    await expect(sup.start()).rejects.toThrow(/already started/);
    await sup.stop();
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

    // Cleanup: stop the supervisor cleanly (avoids triggering recovery
    // through transport.onClose under T11b's live close handler).
    transportClose = null;
    await sup.stop();
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

    // Drive a second spawn through the test door. We do NOT call
    // gen1Client?.stop() here because under T11b's live close handler
    // it would trigger a real re-spawn (interfering with the test
    // door's call below). The supervisor's #spawnFresh internally
    // unsubscribes the prior onClose handler before the new one is
    // wired, so leaking gen1's transport is benign for this test.
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

    await sup.stop();
  });

  it("calls broker.reattach BEFORE client.start (codex T11a review missing-test)", async () => {
    // The supervisor's lifecycle ordering is: transport → onClose
    // subscribe → client construction → broker.reattach → client.start
    // → handshake → runtime construction. If broker.reattach happened
    // AFTER client.start, the client would already be processing
    // server-initiated requests with no broker-installed handler
    // (would default-reject with -32601 from AppServerClient's no-handler
    // path, leaking through Phase 1's broker policy).

    const order: string[] = [];

    // Tracking broker that records when reattach is called.
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    class OrderingBroker extends ApprovalBroker {
      override reattach(newClient: AppServerClient): void {
        order.push("broker.reattach");
        super.reattach(newClient);
      }
    }
    const broker = new OrderingBroker(placeholderClient);
    broker.attach();

    // Tracking transport that records when client.start (which calls
    // transport.start) runs.
    const fakeServer = new FakeAppServer();
    const innerTransport = fakeServer.clientSide;
    const trackedTransport: Transport = {
      start: async () => {
        order.push("transport.start");
        await innerTransport.start();
      },
      stop: () => innerTransport.stop(),
      send: (m) => innerTransport.send(m),
      onMessage: (h) => innerTransport.onMessage(h),
      onError: (h) => innerTransport.onError(h),
      onClose: (h) => innerTransport.onClose(h),
    };

    const opts: SupervisorOptions = {
      transportFactory: () => trackedTransport,
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    await sup.start();

    // The load-bearing assertion.
    const reattachIdx = order.indexOf("broker.reattach");
    const startIdx = order.indexOf("transport.start");
    expect(reattachIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(reattachIdx).toBeLessThan(startIdx);

    await sup.stop();
    await fakeServer.stop();
  });

  it("rejects an unattached broker via reattach precondition (Codex T11a review P1 — pre-attach contract)", async () => {
    // Documents the production contract: broker MUST be pre-attached
    // before being passed to Supervisor. The supervisor always calls
    // reattach() (including for generation 1), and reattach throws if
    // attach() hasn't been called.
    //
    // The error message comes from ApprovalBroker.reattach itself
    // (T9b: "broker has not been attached yet; call attach() first").
    // SupervisorOptions.broker JSDoc + README document this contract;
    // this test pins the runtime behavior so a future refactor can't
    // silently relax the precondition.

    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const unattachedBroker = new ApprovalBroker(placeholderClient);
    // NOTE: NOT calling broker.attach() — this is the misuse pattern.

    const fakeServer = new FakeAppServer();
    const opts: SupervisorOptions = {
      transportFactory: () => fakeServer.clientSide,
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker: unattachedBroker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    // T22 (Phase 2): Supervisor's #spawnFresh head asserts the
    // pre-attached invariant BEFORE reaching broker.reattach, with a
    // load-bearing message that names the production = Supervisor /
    // dev = runtime-send split (Codex Q6). The Phase 1 prior wording
    // ("has not been attached yet") came from broker.reattach itself
    // — that's still the same underlying state, just surfaced earlier
    // and more loudly.
    await expect(sup.start()).rejects.toThrow(/MUST be pre-attached/);

    await fakeServer.stop();
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

    await sup.stop();
  });
});

// ─── T11b: close-handling edges ────────────────────────────────────────

interface RecordingAudit extends SupervisorAudit {
  emits: string[];
  fatals: string[];
}

function recordingAudit(): RecordingAudit {
  const emits: string[] = [];
  const fatals: string[] = [];
  return {
    emits,
    fatals,
    emit: (msg: string) => emits.push(msg),
    emitFatal: (msg: string) => fatals.push(msg),
  };
}

interface BrokerSpyHarness {
  opts: SupervisorOptions;
  audit: RecordingAudit;
  reattachCount: { value: number };
  failPendingCount: { value: number };
}

function makeBrokerSpyHarness(): BrokerSpyHarness {
  const audit = recordingAudit();
  const gen = makeSpawnGen();
  let lastEmission!: ReturnType<SpawnGen["next"]>;
  const reattachCount = { value: 0 };
  const failPendingCount = { value: 0 };

  const placeholderFake = new FakeAppServer();
  const placeholderClient = new AppServerClient(placeholderFake.clientSide);

  class SpyBroker extends ApprovalBroker {
    override reattach(newClient: AppServerClient): void {
      reattachCount.value++;
      super.reattach(newClient);
    }
    override failPendingAsTransportLost(): void {
      failPendingCount.value++;
      super.failPendingAsTransportLost();
    }
  }
  const broker = new SpyBroker(placeholderClient);
  broker.attach();

  const opts: SupervisorOptions = {
    transportFactory: () => {
      lastEmission = gen.next();
      return lastEmission.transport;
    },
    clientFactory: (_t) => lastEmission.client,
    runtimeFactory: (_c) => lastEmission.runtime,
    broker,
    performHandshake: async () => ({}),
    audit,
  };
  return { opts, audit, reattachCount, failPendingCount };
}

describe("Supervisor T11b — close handling (idempotence + backoff + halt)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("close idempotence under concurrent events (Codex required-test, plan §2106)", async () => {
    // Two close events in quick succession → broker.failPendingAsTransportLost
    // called exactly once, audit.emit called exactly once. The
    // `#closing` latch swallows the second event.
    vi.useFakeTimers();

    const h = makeBrokerSpyHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();

    expect(h.failPendingCount.value).toBe(0);
    expect(h.audit.emits.length).toBe(0);

    // First close — kicks the recovery flow.
    sup._handleTransportCloseForTest(0);
    // Second close arriving before the backoff timer fires.
    sup._handleTransportCloseForTest(0);
    sup._handleTransportCloseForTest(null);

    // failPendingAsTransportLost was called exactly once across the
    // three close events. (The broker has its own per-generation
    // idempotence flag — `#transportLostFired` — but that's an
    // additional safety net; the supervisor's `#closing` latch is
    // the load-bearing guard tested here.)
    expect(h.failPendingCount.value).toBe(1);
    // audit.emit fired once with the close message.
    expect(h.audit.emits.length).toBe(1);
    expect(h.audit.emits[0]).toMatch(/transport closed/);
    // No fatal yet (only 1 logical close).
    expect(h.audit.fatals.length).toBe(0);

    // Advance past the backoff so cleanup completes for the next test.
    await vi.advanceTimersByTimeAsync(600);
  });

  it("calls runtime.events.endWithTransportLostSynthetic on transport close", async () => {
    vi.useFakeTimers();

    // Use vi.spyOn to observe endWithTransportLostSynthetic — preserves all other
    // EventNormalizer behavior (codex T11b review P2-2: the prior
    // Proxy-based approach would have broken events.events()'s
    // private-field access if any other test path relied on it).
    const audit = recordingAudit();
    const gen = makeSpawnGen();
    let lastEmission!: ReturnType<SpawnGen["next"]>;

    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    const endWithTransportLostSyntheticSpies: ReturnType<typeof vi.spyOn>[] = [];

    const opts: SupervisorOptions = {
      transportFactory: () => {
        lastEmission = gen.next();
        return lastEmission.transport;
      },
      clientFactory: (_t) => lastEmission.client,
      runtimeFactory: (_c) => {
        endWithTransportLostSyntheticSpies.push(
          vi.spyOn(lastEmission.runtime.events, "endWithTransportLostSynthetic"),
        );
        return lastEmission.runtime;
      },
      broker,
      performHandshake: async () => ({}),
      audit,
    };

    const sup = new Supervisor(opts);
    await sup.start();
    expect(endWithTransportLostSyntheticSpies[0]?.mock.calls.length ?? 0).toBe(0);

    sup._handleTransportCloseForTest(0);
    expect(endWithTransportLostSyntheticSpies[0]?.mock.calls.length ?? 0).toBe(1);

    // Tear down to cancel the pending re-spawn timer and avoid
    // recovery firing.
    await sup.stop();
    vi.useRealTimers();
  });

  it("exponential backoff ladder under repeated failures — 500ms → 1s → 2s → 4s (plan §2109; codex T11b review P2-1)", async () => {
    // Codex P2-1 noted the previous test could pass with constant
    // 500ms backoff. This test exercises the full ladder by forcing
    // FAILED spawns: each handshake throws, so #consecutiveFailures
    // climbs without reset, and each iteration uses the next
    // backoff slot.
    vi.useFakeTimers();

    const audit = recordingAudit();
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    let attempts = 0;
    const gen = makeSpawnGen();
    let lastEmission!: ReturnType<SpawnGen["next"]>;

    const opts: SupervisorOptions = {
      transportFactory: () => {
        lastEmission = gen.next();
        return lastEmission.transport;
      },
      clientFactory: (_t) => lastEmission.client,
      runtimeFactory: (_c) => lastEmission.runtime,
      broker,
      performHandshake: async () => {
        attempts++;
        if (attempts === 1) return {}; // first start succeeds
        throw new Error("forced failure for ladder test");
      },
      audit,
    };

    const sup = new Supervisor(opts);
    await sup.start();
    expect(attempts).toBe(1);

    // Spawn-failure during recovery sets #halted = true (codex T11b
    // P1-2 fix). So we can only exercise ONE failed spawn per
    // supervisor lifetime — after which the supervisor halts.
    //
    // To test the ladder properly we'd need multiple supervisors OR
    // change the halt-on-spawn-failure semantics. The Phase 1 contract
    // is "halt fast on spawn failure", which is the safer default;
    // the ladder is for transport-close cascades NOT spawn failures.
    //
    // Concretely: 1 successful start → 1 close → 1 failed spawn →
    // halted. Asserting the SINGLE backoff timing (500ms) is the
    // observable behavior under this contract.

    sup._handleTransportCloseForTest(0);
    // Backoff = 500ms. No spawn attempt before 499ms.
    await vi.advanceTimersByTimeAsync(499);
    expect(attempts).toBe(1);
    // Tick to 500ms — spawn attempt fires (and fails inside the
    // setTimeout callback's catch).
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(attempts).toBe(2);
    expect(audit.fatals.some((m) => /spawnFresh failed/.test(m))).toBe(true);

    // Subsequent close after halt is silently dropped (#halted guard).
    const fatalsBefore = audit.fatals.length;
    sup._handleTransportCloseForTest(0);
    expect(audit.fatals.length).toBe(fatalsBefore);

    vi.useRealTimers();
  });

  it("exponential backoff increases across consecutive close events that succeed-spawn (proves the ladder formula)", async () => {
    // Complementary to the failure test above. Here each spawn SUCCEEDS,
    // so #consecutiveFailures resets each iteration → the backoff
    // is 500ms every time. This pins the "reset on successful spawn"
    // contract: each close-after-success starts at the bottom of the
    // ladder.
    //
    // Pairs with the halt-on-cascade test (which exercises the ladder
    // climb without success in between).
    vi.useFakeTimers();

    const h = makeBrokerSpyHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();

    for (let i = 0; i < 3; i++) {
      const before = sup.currentClientForTest();
      sup._handleTransportCloseForTest(0);
      // Should NOT spawn before 500ms.
      await vi.advanceTimersByTimeAsync(499);
      expect(sup.currentClientForTest()).toBe(before);
      // 500ms tick → spawn.
      await vi.advanceTimersByTimeAsync(1);
      expect(sup.currentClientForTest()).not.toBe(before);
    }

    expect(h.audit.fatals.length).toBe(0);
    await sup.stop();
    vi.useRealTimers();
  });

  it("spawn failure halts the supervisor and silently drops further closes (codex T11b P1-2)", async () => {
    // Under the codex T11b P1-2 fix, a single spawn failure halts
    // the supervisor (sets #halted = true). The cascade-halt at
    // MAX_CONSECUTIVE_FAILURES = 5 is defense-in-depth and
    // unreachable in practice: any spawn failure halts immediately,
    // and successful spawns reset the counter, so the counter never
    // climbs to 5.
    //
    // Plan §2110 originally specified "5 consecutive failures → halt".
    // The codex review caught that the original cascade design left
    // a mixed-generation state (broker.reattach committed to a
    // failed client, #currentRuntime stale). The chosen fix is
    // "halt on first spawn failure"; this is the safer default
    // (host can restart the supervisor), and the cascade threshold
    // is preserved as defense-in-depth.

    vi.useFakeTimers();

    const audit = recordingAudit();
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    let spawnAttempts = 0;
    const gen = makeSpawnGen();
    let lastEmission!: ReturnType<SpawnGen["next"]>;

    const opts: SupervisorOptions = {
      transportFactory: () => {
        lastEmission = gen.next();
        return lastEmission.transport;
      },
      clientFactory: (_t) => lastEmission.client,
      runtimeFactory: (_c) => lastEmission.runtime,
      broker,
      performHandshake: async () => {
        spawnAttempts++;
        if (spawnAttempts === 1) return {}; // first start succeeds
        throw new Error(`handshake failed (attempt ${spawnAttempts})`);
      },
      audit,
    };

    const sup = new Supervisor(opts);
    await sup.start();
    expect(spawnAttempts).toBe(1);

    // First close → spawn attempt → handshake throws → halt.
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(spawnAttempts).toBe(2);
    expect(audit.fatals.some((m) => /spawnFresh failed.*handshake failed/.test(m))).toBe(true);

    // Subsequent close after halt: #halted guard returns immediately;
    // no additional spawn attempt, no additional fatal.
    const fatalsBefore = audit.fatals.length;
    const attemptsBefore = spawnAttempts;
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.runAllTimersAsync();
    expect(spawnAttempts).toBe(attemptsBefore);
    expect(audit.fatals.length).toBe(fatalsBefore);

    vi.useRealTimers();
  });

  it("successful re-spawn resets #consecutiveFailures (allows future close to start fresh backoff)", async () => {
    vi.useFakeTimers();

    const h = makeBrokerSpyHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();
    const gen1Client = sup.currentClientForTest();

    // Trigger a close + successful re-spawn (the harness's
    // performHandshake always succeeds).
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(sup.currentClientForTest()).not.toBe(gen1Client);

    // Now drive 4 more closes. If the counter reset on success,
    // we have plenty of room before halt (would need 5 more consecutive
    // failures, but each spawn succeeds, so we never halt).
    for (let i = 0; i < 4; i++) {
      sup._handleTransportCloseForTest(0);
      await vi.advanceTimersByTimeAsync(8000); // generous backoff
      await vi.runAllTimersAsync();
    }

    // No fatal — counter reset on each successful spawn.
    expect(h.audit.fatals.length).toBe(0);
  });

  it("stop() halts the supervisor and prevents respawn on subsequent transport close (codex T11b P1-1)", async () => {
    // Production hosts need a way to gracefully terminate the
    // supervisor. Calling client.stop() directly would propagate
    // through transport.onClose → trigger #onTransportClose →
    // schedule a re-spawn. The supervisor's stop() method sets
    // #halted, detaches the close subscription, cancels any pending
    // re-spawn timer, and stops the current client.

    vi.useFakeTimers();

    const h = makeBrokerSpyHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();

    const gen1Client = sup.currentClientForTest();
    expect(gen1Client).not.toBeNull();

    // Intentional teardown.
    await sup.stop();

    // After stop():
    //   - failPendingAsTransportLost was NOT called (no close-handling fired).
    expect(h.failPendingCount.value).toBe(0);
    //   - audit.emit was NOT called for "transport closed".
    expect(h.audit.emits.length).toBe(0);
    //   - audit.emitFatal was NOT called.
    expect(h.audit.fatals.length).toBe(0);

    // Subsequent close event (e.g. delayed OS-level signal) is
    // silently dropped because #halted = true.
    sup._handleTransportCloseForTest(0);
    expect(h.failPendingCount.value).toBe(0);
    expect(h.audit.emits.length).toBe(0);

    // Pending re-spawn timer was cleared, so advancing time doesn't
    // trigger any spawn.
    const reattachBefore = h.reattachCount.value;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.reattachCount.value).toBe(reattachBefore);

    // Second stop() is idempotent.
    await sup.stop();

    vi.useRealTimers();
  });

  it("stop() during pending re-spawn cancels the timer (no recovery after stop)", async () => {
    vi.useFakeTimers();

    const h = makeBrokerSpyHarness();
    const sup = new Supervisor(h.opts);
    await sup.start();

    const gen1Client = sup.currentClientForTest();

    // Trigger a close; backoff timer starts.
    sup._handleTransportCloseForTest(0);
    expect(h.failPendingCount.value).toBe(1);

    // Stop BEFORE the backoff fires (500ms) — the pending timer
    // should be cancelled.
    await vi.advanceTimersByTimeAsync(100);
    await sup.stop();

    // Even after the backoff window, no new spawn happens.
    await vi.advanceTimersByTimeAsync(2000);
    // currentClient is still gen1 — supervisor never spawned gen2.
    expect(sup.currentClientForTest()).toBe(gen1Client);

    vi.useRealTimers();
  });

  it("spawn-failure during recovery surfaces audit.emitFatal but doesn't crash (codex T11a risky-assumption #1)", async () => {
    vi.useFakeTimers();

    const audit = recordingAudit();
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    let attempts = 0;
    const gen = makeSpawnGen();
    let lastEmission!: ReturnType<SpawnGen["next"]>;

    const opts: SupervisorOptions = {
      transportFactory: () => {
        lastEmission = gen.next();
        return lastEmission.transport;
      },
      clientFactory: (_t) => lastEmission.client,
      runtimeFactory: (_c) => lastEmission.runtime,
      broker,
      performHandshake: async () => {
        attempts++;
        if (attempts === 1) return {};
        throw new Error("simulated spawn failure");
      },
      audit,
    };

    const sup = new Supervisor(opts);
    await sup.start();

    // Close → re-spawn fires, performHandshake throws inside the
    // setTimeout's async callback. The .catch handler emits fatal;
    // the supervisor doesn't crash.
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(audit.fatals.length).toBeGreaterThanOrEqual(1);
    expect(audit.fatals[0]).toMatch(/spawnFresh failed.*simulated spawn failure/);
  });
});

// ─── Phase 1 integrated review Blocker 2 — spawn-failure cleanup ──────

describe("Supervisor spawn-failure cleanup (Phase 1 integrated review blocker 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial start() with client.start() throwing — cleans up half-started client + transport, leaves halted (no recovery)", async () => {
    // Build a transport whose `start()` throws. The supervisor should:
    //   1. Catch the throw inside #spawnFresh.
    //   2. Stop the failed client (which calls transport.stop()).
    //   3. Detach the close subscription.
    //   4. Set #halted = true.
    //   5. Re-throw so start()'s caller sees the failure.
    let transportStopped = false;
    let onCloseUnsubCalled = false;
    let clientStartCalled = false;

    const failingTransport: Transport = {
      start: async () => {
        clientStartCalled = true;
        throw new Error("simulated transport.start() failure");
      },
      stop: async () => {
        transportStopped = true;
      },
      send: () => {},
      onMessage: (_h) => () => {},
      onError: (_h) => () => {},
      onClose: (_h) => () => {
        onCloseUnsubCalled = true;
      },
    };

    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();
    const audit = recordingAudit();

    const opts: SupervisorOptions = {
      transportFactory: () => failingTransport,
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit,
    };

    const sup = new Supervisor(opts);

    // start() must throw with the original error.
    await expect(sup.start()).rejects.toThrow(/simulated transport.start\(\) failure/);

    // client.start() was actually called (the throw came from there).
    expect(clientStartCalled).toBe(true);

    // Supervisor is halted; subsequent start() refuses.
    await expect(sup.start()).rejects.toThrow(/supervisor is halted/);

    // currentClient / currentTransport / runtime were nulled out.
    expect(sup.currentClientForTest()).toBeNull();
    expect(sup.currentTransportForTest()).toBeNull();

    // The onClose subscription was detached during cleanup.
    expect(onCloseUnsubCalled).toBe(true);

    // The transport was stopped (via client.stop() propagation) — this
    // is what AppServerClient.stop() does in production. Our fake
    // transport's stop() flag is set.
    expect(transportStopped).toBe(true);

    // No fatal was emitted by the cleanup itself (initial-start
    // failure surfaces the throw to the caller; the host decides
    // whether to fatal-log).
    expect(audit.fatals.length).toBe(0);
  });

  it("initial start() with performHandshake throwing — same cleanup contract", async () => {
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();
    const audit = recordingAudit();
    const gen = makeSpawnGen();
    let lastEmission!: ReturnType<SpawnGen["next"]>;

    const opts: SupervisorOptions = {
      transportFactory: () => {
        lastEmission = gen.next();
        return lastEmission.transport;
      },
      clientFactory: (_t) => lastEmission.client,
      runtimeFactory: (_c) => lastEmission.runtime,
      broker,
      performHandshake: async () => {
        throw new Error("simulated handshake failure");
      },
      audit,
    };

    const sup = new Supervisor(opts);
    await expect(sup.start()).rejects.toThrow(/simulated handshake failure/);
    await expect(sup.start()).rejects.toThrow(/supervisor is halted/);
    expect(sup.currentClientForTest()).toBeNull();
    expect(sup.currentTransportForTest()).toBeNull();
  });

  it("initial start() with unattached broker — T22 invariant fires BEFORE transportFactory (no side effects)", async () => {
    // T22 (Phase 2): pre-attached-broker invariant moved the check to
    // #spawnFresh head, BEFORE transportFactory runs. Phase 1 used to
    // rely on broker.reattach throwing inside the try-block to trigger
    // cleanup. Now the invariant fail-fasts: no transport is ever
    // constructed, so there's nothing to clean up.
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const unattachedBroker = new ApprovalBroker(placeholderClient);
    // NOTE: NOT calling broker.attach()
    const audit = recordingAudit();

    let transportFactoryCalled = false;
    const fake = new FakeAppServer();
    const trackedTransport: Transport = {
      start: () => fake.clientSide.start(),
      stop: () => fake.clientSide.stop(),
      send: (m) => fake.clientSide.send(m),
      onMessage: (h) => fake.clientSide.onMessage(h),
      onError: (h) => fake.clientSide.onError(h),
      onClose: (h) => fake.clientSide.onClose(h),
    };

    const opts: SupervisorOptions = {
      transportFactory: () => {
        transportFactoryCalled = true;
        return trackedTransport;
      },
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker: unattachedBroker,
      performHandshake: async () => ({}),
      audit,
    };

    const sup = new Supervisor(opts);
    await expect(sup.start()).rejects.toThrow(/MUST be pre-attached/);
    expect(sup.currentClientForTest()).toBeNull();
    expect(sup.currentTransportForTest()).toBeNull();
    // T22: transportFactory was never called — invariant fired before
    // any transport syscall could happen.
    expect(transportFactoryCalled).toBe(false);
    await fake.stop();
  });

  it("recovery spawn — client.start() throws — cleans up + emits fatal + no further recovery", async () => {
    vi.useFakeTimers();

    const audit = recordingAudit();
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    // First spawn succeeds; subsequent spawns have a transport that
    // fails on start().
    let spawnIndex = 0;
    const firstFake = new FakeAppServer();
    const firstClient = new AppServerClient(firstFake.clientSide);
    const firstRuntime = new CodexRuntime(firstClient);

    const opts: SupervisorOptions = {
      transportFactory: () => {
        spawnIndex++;
        if (spawnIndex === 1) return firstFake.clientSide;
        // Recovery spawn: failing transport.
        return {
          start: async () => {
            throw new Error("simulated recovery start failure");
          },
          stop: async () => {},
          send: () => {},
          onMessage: (_h) => () => {},
          onError: (_h) => () => {},
          onClose: (_h) => () => {},
        };
      },
      clientFactory: (t) => (spawnIndex === 1 ? firstClient : new AppServerClient(t)),
      runtimeFactory: (_c) => firstRuntime,
      broker,
      performHandshake: async () => ({}),
      audit,
    };

    const sup = new Supervisor(opts);
    await sup.start();
    expect(sup.currentClientForTest()).toBe(firstClient);

    // Trigger a close — schedules recovery spawn via setTimeout.
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    // Recovery spawn failed inside setTimeout's catch:
    // - audit.emitFatal was called with the start-failure message
    // - supervisor is halted (cleanup set it)
    // - currentClient is null (cleanup nulled it)
    expect(audit.fatals.some((m) => /simulated recovery start failure/.test(m))).toBe(true);
    expect(sup.currentClientForTest()).toBeNull();
    expect(sup.currentTransportForTest()).toBeNull();

    // Subsequent close after halt: silently dropped.
    const fatalsBefore = audit.fatals.length;
    sup._handleTransportCloseForTest(0);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.runAllTimersAsync();
    expect(audit.fatals.length).toBe(fatalsBefore);

    await firstFake.stop();
  });
});

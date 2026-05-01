// Phase 1 daemon — Supervisor (T11a / P1.4 part 1).
//
// Owns the codex App Server subprocess lifecycle. On every spawn:
//   1. transportFactory() yields a fresh Transport.
//   2. SUBSCRIBE to transport.onClose BEFORE constructing AppServerClient.
//      Codex outside-voice B7: this ordering matters because the
//      client's later `start()` call subscribes to transport.onClose
//      internally (see packages/app-server-client/src/client.ts:106).
//      If the supervisor doesn't subscribe first, a transport that
//      synchronously fires onClose between transportFactory's return
//      and client.start() (rare but possible with custom transports
//      that have pre-existing close state) would be observable to the
//      client (which tears itself down) but invisible to the supervisor
//      (which would never spawn a replacement). Subscribing first
//      eliminates that race window.
//   3. clientFactory(transport) constructs AppServerClient.
//   4. broker.reattach(newClient) — T9b B-clean keeps in-flight approval
//      state coherent across the quartet swap.
//   5. await client.start() — opens the JSONL stdio pipe.
//   6. await performHandshake(client) — initialize round-trip.
//   7. runtimeFactory(client) — CodexRuntime + EventNormalizer.
//
// ONE-SHOT lifecycle (per AppServerClient JSDoc): the supervisor never
// reuses a closed transport or client. T11b's #onTransportClose builds
// a fresh quartet via #spawnFresh() rather than trying to restart the
// existing one. Every reference (#currentTransport, #currentClient) is
// replaced atomically per spawn.
//
// What this skeleton (T11a) does:
//   - start()           → calls #spawnFresh() once.
//   - #spawnFresh()     → builds the quartet + subscribes to onClose.
//   - #onTransportClose → stub (T11b lands the close handling).
//
// What T11b adds:
//   - close idempotence (#closing flag protects concurrent close events).
//   - bounded exponential backoff (500ms → 1s → 2s → 4s → 8s).
//   - halt-on-cascade (5 consecutive failures → audit.emitFatal).
//   - broker.failPendingAsTransportLost() invocation on every close.
//   - synthesized turn_failed events for in-flight turns.

import type {
  AppServerClient,
  AppServerClientOptions,
  Transport,
} from "@codex-im/app-server-client";
import type { CodexRuntime } from "@codex-im/codex-runtime";
import type { SupervisorOptions } from "./types.js";

/**
 * Supervisor — owns codex subprocess lifecycle.
 *
 * Construction is cheap: the spawn doesn't happen until `start()`.
 * One supervisor instance manages a sequence of quartet generations;
 * the host process holds the supervisor reference and decides when
 * to call `start()` (Phase 1: at IM adapter boot; production daemon:
 * at launchd start).
 */
export class Supervisor {
  readonly #opts: SupervisorOptions;

  // Current generation's references. Replaced atomically per
  // #spawnFresh(). `null` only between construction and the first
  // start(), and during the brief window inside #spawnFresh() before
  // assignment.
  #currentTransport: Transport | null = null;
  #currentClient: AppServerClient | null = null;
  // T11b / Phase 2 will consume #currentRuntime (e.g. exposing
  // runtime.events to a host adapter, propagating turn_failed events
  // on transport-loss). T11a sets it but doesn't read it; intentional
  // placeholder rather than dead code.
  #currentRuntime: CodexRuntime | null = null;
  #currentCloseUnsub: (() => void) | null = null;

  // T11b will use these — kept here so the field shape is stable
  // between T11a and T11b (avoids a rebase-conflict pattern where
  // T11b's edge-impl PR would have to add fields to the same class
  // body T11a created).
  #closing = false;
  #consecutiveFailures = 0;

  constructor(opts: SupervisorOptions) {
    this.#opts = opts;
  }

  /**
   * Spawn the first generation. Returns when the handshake completes
   * and the runtime is built. Throws if any step in the spawn fails;
   * the caller decides whether to retry or surface to the host.
   *
   * Idempotent against accidental double-call: if a current quartet
   * already exists, throws — the supervisor is not a singleton, and
   * multiple start() calls would leak the prior generation's onClose
   * subscription.
   */
  async start(): Promise<void> {
    if (this.#currentTransport !== null) {
      throw new Error("Supervisor.start: already started; supervisors are one-shot per instance");
    }
    await this.#spawnFresh();
  }

  /**
   * Test-only / observer API: returns the current AppServerClient
   * instance (or null if start() hasn't been called yet, or if the
   * current generation is mid-spawn). Tests use this to assert
   * object-identity changes across simulated transport closes.
   *
   * @internal — not part of Phase 1 public stability guarantee.
   *   Phase 2 IM adapter wiring should consume the runtime/broker
   *   directly via factory closures; this getter is a stop-gap for
   *   T11a's identity-change tests.
   */
  currentClientForTest(): AppServerClient | null {
    return this.#currentClient;
  }

  /**
   * @internal — paired with currentClientForTest(). Tests assert that
   * #currentTransport identity changes per generation.
   */
  currentTransportForTest(): Transport | null {
    return this.#currentTransport;
  }

  /**
   * @internal — drive a second `#spawnFresh()` from tests. T11a's
   * `#onTransportClose` is a stub (T11b lands close handling), so the
   * "fresh transport+client per spawn" and "no zombie listener" tests
   * need a way to invoke #spawnFresh manually. Tests are the only
   * caller; production code reaches #spawnFresh exclusively via
   * `start()` (first generation) and `#onTransportClose` (T11b).
   *
   * This door is intentionally NOT named `respawnForTest` to avoid
   * suggesting it's a substitute for T11b's close-handling — it skips
   * idempotence, backoff, and audit emit. Tests must not use it to
   * exercise close-driven recovery; that's T11b's surface.
   */
  async _spawnFreshForTest(): Promise<void> {
    await this.#spawnFresh();
  }

  /**
   * Internal spawn helper. Atomic from the supervisor's perspective:
   * either the entire quartet is built and #current* fields are set,
   * or an error propagates and the caller can decide to retry.
   *
   * Subscription ordering (Codex B7):
   *   1. transport = transportFactory()   ← may emit onClose synchronously
   *   2. supervisor subscribes              ← BEFORE client construction
   *   3. client = clientFactory(transport)
   *   4. broker.reattach(client)
   *   5. await client.start()
   *   6. await performHandshake(client)
   *   7. runtime = runtimeFactory(client)
   *
   * Steps 1-2 are synchronous on a single tick — JS run-to-completion
   * guarantees no async work can interleave between them. Step 3+ may
   * be async (clientFactory may capture the transport in async closures
   * but doesn't itself await), and the close subscription installed at
   * step 2 catches a transport.onClose that fires during steps 3-7.
   *
   * The previous generation's #currentCloseUnsub is unhooked BEFORE
   * subscribing the new one, so the prior transport's listeners are
   * fully detached. This prevents "zombie listener" bugs where a
   * stale onClose handler mutates supervisor state for a generation
   * the supervisor has moved past.
   */
  async #spawnFresh(): Promise<void> {
    // Detach prior generation's onClose subscription first.
    // For the first generation #currentCloseUnsub is null; no-op.
    if (this.#currentCloseUnsub !== null) {
      this.#currentCloseUnsub();
      this.#currentCloseUnsub = null;
    }

    // Step 1: transport. Capture the reference IMMEDIATELY so step 2
    // can subscribe; do not interleave any other work between the
    // factory call and the subscription.
    const transport = this.#opts.transportFactory();
    this.#currentTransport = transport;

    // Step 2: subscribe-before-spawn (Codex B7). This ordering is
    // load-bearing — see JSDoc above.
    this.#currentCloseUnsub = transport.onClose((code) => {
      this.#onTransportClose(code);
    });

    // Step 3: client. The clientFactory may apply AppServerClientOptions
    // (logger override, timeout overrides) — that's the caller's
    // responsibility. We pass a default-empty opts object; production
    // CLI provides logger/timeouts via the factory closure.
    const client = this.#constructClient(transport);
    this.#currentClient = client;

    // Step 4: broker.reattach(client). T9b B-clean: this is the only
    // way to swap the broker's client reference without leaking handler
    // state. attach() would throw because the broker was attached to
    // the prior client (or the very first attach happens here for
    // generation 1 — see note below).
    //
    // Note for generation 1: the caller is expected to have called
    // broker.attach() against a placeholder client OR not at all.
    // T11a's tests use the latter pattern (broker untouched until
    // first reattach). T11b will document this contract precisely
    // and may add a one-shot "first generation = attach, subsequent
    // = reattach" branch if production wiring needs it.
    this.#opts.broker.reattach(client);

    // Step 5: await client.start(). This opens the transport's send
    // pipe (StdioTransport spawns the subprocess here in production).
    await client.start();

    // Step 6: handshake. Initialize round-trip; resolves with the
    // codex InitializeResponse. The supervisor doesn't read the
    // response — it just awaits it as a "the wire is live" gate.
    await this.#opts.performHandshake(client);

    // Step 7: runtime. CodexRuntime constructs an EventNormalizer
    // which subscribes to client.onNotification — that subscription
    // lives until client closes (no separate teardown needed).
    this.#currentRuntime = this.#opts.runtimeFactory(client);

    // Reset close-handling state for the new generation. T11b uses
    // these fields; T11a leaves them at safe initial values.
    this.#closing = false;
  }

  /**
   * Helper for client construction. Encapsulated so the call site in
   * #spawnFresh stays readable and so T11b's options-override hook
   * (logger / timeout per generation) can grow here without further
   * threading.
   */
  #constructClient(transport: Transport): AppServerClient {
    const opts: AppServerClientOptions | undefined = undefined;
    return this.#opts.clientFactory(transport, opts);
  }

  /**
   * Transport-close handler. T11a is intentionally a no-op — T11b
   * lands the real edge handling (idempotence, exponential backoff,
   * halt-on-cascade, audit on fatal, broker.failPendingAsTransportLost
   * invocation, synthesized turn_failed events).
   *
   * The supervisor MUST subscribe to transport.onClose during T11a
   * (Codex B7 — the subscription has to happen before client
   * construction so a synchronous close-during-construction is
   * observable). This stub satisfies the wiring contract without
   * making any decisions about recovery — leaving close-driven
   * recovery entirely in T11b's scope.
   *
   * Why a no-op rather than a throw: client.stop() in tests (and in
   * production teardown) propagates through the InMemoryTransport
   * pair to fire the supervisor's onClose subscription. A throwing
   * stub would crash test cleanup paths. The no-op is safe; T11b
   * replaces it with the real handler that flips a #closing flag,
   * notifies the broker, and drives the backoff loop.
   *
   * @internal — paired with the subscribe-before-spawn invariant
   * tested in `subscribes to transport.onClose BEFORE constructing
   * the client (Codex B7)`.
   */
  #onTransportClose(_code: number | null): void {
    // Intentional no-op for T11a. T11b replaces.
  }
}

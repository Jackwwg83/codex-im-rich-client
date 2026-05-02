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

  // T11b close-handling state.
  #closing = false;
  #consecutiveFailures = 0;
  // Halted = supervisor refuses further work. Set by:
  //   - 5 consecutive transport closes without recovery (cascade halt)
  //   - spawn-during-recovery failure (handshake throws, etc.)
  //   - explicit stop() call
  // Once set, never cleared. Codex T11b review P1-2: prevents the
  // mixed-generation state where #currentClient points at a failed
  // new client while #currentRuntime is the prior generation.
  #halted = false;
  // Pending re-spawn timer handle; cleared on cancel-during-stop.
  #pendingRespawnTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.#halted) {
      throw new Error("Supervisor.start: supervisor is halted; construct a fresh one");
    }
    if (this.#currentTransport !== null) {
      throw new Error("Supervisor.start: already started; supervisors are one-shot per instance");
    }
    await this.#spawnFresh();
  }

  /**
   * Intentional teardown (Codex T11b review P1-1). Stops the current
   * client cleanly and prevents the close handler from triggering a
   * re-spawn. Call this when the host process is shutting down or when
   * the supervisor's owning context (IM adapter, CLI, etc.) is going
   * away.
   *
   * After stop():
   *   - The supervisor is halted; further start() / re-spawn calls
   *     throw or no-op.
   *   - `#currentCloseUnsub` is invoked, so transport.onClose can no
   *     longer reach `#onTransportClose`.
   *   - Any pending re-spawn timer (from a prior close) is cleared.
   *   - `#currentClient.stop()` is awaited; transport closes propagate
   *     normally but won't trigger recovery.
   *
   * Idempotent: a second stop() is a no-op (broker.failPendingAsTransportLost
   * stays correctly idempotent via T9b's per-client flag, but the
   * supervisor's own state is just a `#halted = true` write that's
   * already true).
   */
  async stop(): Promise<void> {
    // Order matters: SET #halted BEFORE detaching the close handler,
    // so any close events that fire between detach and clientStop are
    // ignored by #onTransportClose's halted-guard at the top.
    this.#halted = true;

    // Cancel any pending re-spawn timer (from a prior close that hadn't
    // yet fired its setTimeout callback).
    if (this.#pendingRespawnTimer !== null) {
      clearTimeout(this.#pendingRespawnTimer);
      this.#pendingRespawnTimer = null;
    }

    // Detach the supervisor's onClose subscription. The next close
    // (which client.stop() will emit) won't reach #onTransportClose.
    if (this.#currentCloseUnsub !== null) {
      this.#currentCloseUnsub();
      this.#currentCloseUnsub = null;
    }

    // Stop the current client. AppServerClient.stop() is idempotent
    // (its `if (this.closed) return` guard); safe to call even if
    // start() wasn't ever called or already-stopped.
    if (this.#currentClient !== null) {
      try {
        await this.#currentClient.stop();
      } catch {
        // Swallow — host already requested teardown; reporting the
        // stop error doesn't help.
      }
    }
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
   * Return the current runtime generation for production daemon routing.
   * The daemon uses this to send IM prompts through CodexRuntime wrappers
   * without owning the app-server subprocess lifecycle itself.
   */
  currentRuntime(): CodexRuntime | null {
    return this.#currentRuntime;
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
    // T22 (Phase 2 / D16 / Codex Q6): pre-attached-broker invariant.
    // The Supervisor is the production owner of the broker lifecycle —
    // dev/operator entry points like `runtime:send` construct + attach
    // the broker themselves; production daemon wire-up MUST attach the
    // broker BEFORE handing it to Supervisor. Without this guard, a
    // misuse pattern (forgetting attach()) would surface as a confusing
    // broker.reattach error a few lines down. This check makes the
    // contract violation explicit at the boundary.
    if (!this.#opts.broker.isAttached()) {
      throw new Error(
        "Supervisor.#spawnFresh: broker MUST be pre-attached before passing to Supervisor. " +
          "Production callers (daemon wire-up) construct the broker, call broker.attach(client), " +
          "then construct Supervisor. The broker.reattach(newClient) call inside #spawnFresh swaps " +
          "the client reference; it does NOT replace the missing initial attach. " +
          "Note: production = Supervisor; runtime-send = dev/operator only (Codex Q6).",
      );
    }

    // Detach prior generation's onClose subscription first.
    // For the first generation #currentCloseUnsub is null; no-op.
    if (this.#currentCloseUnsub !== null) {
      this.#currentCloseUnsub();
      this.#currentCloseUnsub = null;
    }

    // Locals track the in-flight spawn. On failure, we use these
    // (not `this.#current*`) for cleanup — they always reflect THIS
    // spawn's progress, even if `#current*` was overwritten or never
    // assigned (e.g. transportFactory threw).
    //
    // Phase 1 integrated review blocker 2: the supervisor must clean
    // up the half-started generation on any spawn failure. Steps 1-7
    // are wrapped in try/catch; the catch arm calls
    // `#cleanupFailedGeneration` (stop client/transport, detach
    // onClose, set `#halted = true`) and re-throws so the outer
    // caller — `start()` for first-generation, the recovery `setTimeout`
    // callback for subsequent generations — sees the failure. Both
    // outer paths are responsible for surfacing the fatal to the
    // host (`audit.emitFatal`); the cleanup itself is silent so we
    // don't double-emit.
    let transport: Transport | null = null;
    let client: AppServerClient | null = null;

    try {
      // Step 1: transport. Capture the reference IMMEDIATELY so step 2
      // can subscribe; do not interleave any other work between the
      // factory call and the subscription.
      transport = this.#opts.transportFactory();
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
      client = this.#constructClient(transport);
      this.#currentClient = client;

      // Step 4: broker.reattach(client). T9b B-clean: this is the only
      // way to swap the broker's client reference without leaking handler
      // state. The broker MUST be pre-attached (see SupervisorOptions
      // JSDoc). If reattach throws (e.g. cross-instance guard), we
      // hit the cleanup path below.
      this.#opts.broker.reattach(client);

      // Step 5: await client.start(). This opens the transport's send
      // pipe (StdioTransport spawns the subprocess here in production).
      // If start() throws (e.g. subprocess spawn failed, transport-init
      // race), cleanup below stops the half-started client.
      await client.start();

      // Step 6: handshake. Initialize round-trip; resolves with the
      // codex InitializeResponse. The supervisor doesn't read the
      // response — it just awaits it as a "the wire is live" gate.
      // If the handshake throws (e.g. codex returns -32600 on init,
      // version mismatch), cleanup stops the started client.
      await this.#opts.performHandshake(client);

      // Step 7: runtime. CodexRuntime constructs an EventNormalizer
      // which subscribes to client.onNotification — that subscription
      // lives until client closes (no separate teardown needed).
      // If runtimeFactory throws (e.g. caller-supplied factory has
      // a bug), cleanup again stops the client cleanly.
      this.#currentRuntime = this.#opts.runtimeFactory(client);

      // Success — reset close-handling state for the new generation.
      // The failure counter resets on a successful spawn (T11b) — a
      // healthy spawn should not count toward the halt threshold.
      this.#closing = false;
      this.#consecutiveFailures = 0;
    } catch (err) {
      await this.#cleanupFailedGeneration(transport, client);
      throw err;
    }
  }

  /**
   * Cleanup helper for `#spawnFresh` failure paths. Tears down the
   * half-started generation atomically from the supervisor's perspective:
   *
   *   1. Sets `#halted = true` (durable; never cleared) — future
   *      operations on this supervisor refuse via the halted-guard
   *      at the top of `#onTransportClose` and `start()`.
   *   2. Detaches the new generation's onClose subscription so a
   *      transport-close fired during cleanup doesn't re-enter
   *      `#onTransportClose` and schedule another respawn.
   *   3. Stops the half-started client (which propagates to the
   *      transport via AppServerClient.stop()'s implementation). If
   *      client construction failed before the client was assigned,
   *      stops the transport directly.
   *   4. Nulls out `#currentTransport` / `#currentClient` /
   *      `#currentRuntime` so any test-door / Phase 2 reader sees
   *      a clean halted state, not stale references to a stopped
   *      generation.
   *
   * All inner steps swallow their own errors — cleanup must be
   * best-effort. The caller (try/catch in `#spawnFresh`) re-throws
   * the original error so the outer caller (`start()` or recovery
   * `setTimeout`) sees the spawn failure.
   *
   * Phase 1 integrated review blocker 2 fix.
   */
  async #cleanupFailedGeneration(
    transport: Transport | null,
    client: AppServerClient | null,
  ): Promise<void> {
    this.#halted = true;

    // Detach the new generation's onClose subscription FIRST so any
    // transport-close fired by the imminent client.stop() doesn't
    // re-enter #onTransportClose.
    if (this.#currentCloseUnsub !== null) {
      try {
        this.#currentCloseUnsub();
      } catch {
        // Ignore: transport's onClose unsub contract is "synchronous,
        // idempotent". A throw here would be a transport-implementation
        // bug; cleanup must continue.
      }
      this.#currentCloseUnsub = null;
    }

    // Stop the half-started client. AppServerClient.stop() is
    // idempotent (its `if (this.closed) return` guard) and propagates
    // to transport.stop(). If client construction itself failed before
    // the client was assigned, fall back to stopping the transport
    // directly.
    if (client !== null) {
      try {
        await client.stop();
      } catch {
        // Ignore: the client is doomed; cleanup must continue.
      }
    } else if (transport !== null) {
      try {
        await transport.stop();
      } catch {
        // Ignore.
      }
    }

    // Cancel any pending re-spawn timer in case cleanup was triggered
    // mid-recovery (shouldn't happen because the caller sets #halted
    // BEFORE the timer fires, but defense-in-depth).
    if (this.#pendingRespawnTimer !== null) {
      clearTimeout(this.#pendingRespawnTimer);
      this.#pendingRespawnTimer = null;
    }

    // Clear stale references — observers should see "halted, no
    // current generation" rather than "halted, but #currentClient
    // points at a stopped instance".
    this.#currentClient = null;
    this.#currentTransport = null;
    this.#currentRuntime = null;
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
   * Transport-close handler (T11b). Drives the close-recovery
   * lifecycle:
   *
   *   1. Idempotence guard via `#closing` flag — concurrent close
   *      events (rare but possible if the OS layer fires multiple
   *      events on subprocess exit) collapse to a single cleanup.
   *   2. `broker.failPendingAsTransportLost()` — D6: every pending
   *      approval flips to `transport_lost` terminal. T9b's B-clean
   *      lifecycle guarantees this is race-free; AppServerClient.respond
   *      on a closed client is a no-op so the wire frame is harmlessly
   *      dropped.
   *   3. `runtime.events.endWithTransportLostSynthetic()` — signals the
   *      EventNormalizer that no more notifications will arrive on this
   *      generation and appends one `turn_failed` synthetic for each
   *      in-flight turn before `{done:true}`.
   *   4. `audit.emit` — informational record of the close + cleanup.
   *   5. `#consecutiveFailures++` — bounded retry counter. Reset to 0
   *      on a successful subsequent spawn (in `#spawnFresh`).
   *   6. Halt at 5 consecutive failures: `audit.emitFatal` + return
   *      (no further `#spawnFresh`). The host process decides what to
   *      do with the fatal; the supervisor never calls `process.exit`.
   *   7. Otherwise schedule `#spawnFresh` via `setTimeout(#backoff())`.
   *      Backoff: 500ms → 1s → 2s → 4s → 8s (capped). On spawn failure,
   *      `audit.emitFatal` and stop — the spawn-recovery path is
   *      not infinitely retryable; once `#spawnFresh` itself fails
   *      we surface to the host.
   *
   * @internal — production invocation is via the transport.onClose
   * subscription; tests drive it via the test-door
   * `_handleTransportCloseForTest`.
   */
  #onTransportClose(code: number | null): void {
    // Halted = supervisor is shutting down or has cascaded out.
    // Halts (cascade or stop()) are durable; never re-enter recovery.
    if (this.#halted) return;
    if (this.#closing) return;
    this.#closing = true;

    // Step 2: fail pending approvals as transport-lost (D6).
    this.#opts.broker.failPendingAsTransportLost();

    // Step 3: signal the EventNormalizer to synthesize transport-lost
    // terminal turns, drain, and close the iterator.
    if (this.#currentRuntime !== null) {
      this.#currentRuntime.events.endWithTransportLostSynthetic();
    }

    // Step 4: audit.
    this.#opts.audit.emit(`transport closed (code=${code ?? "null"}); cleanup complete`);

    // Step 5: failure counter.
    this.#consecutiveFailures++;

    // Step 6: halt-on-cascade.
    if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.#halted = true;
      this.#opts.audit.emitFatal(
        `supervisor halted: ${MAX_CONSECUTIVE_FAILURES} consecutive transport closes`,
      );
      return;
    }

    // Step 7: schedule recovery spawn after backoff.
    const delayMs = this.#backoff();
    this.#pendingRespawnTimer = setTimeout(() => {
      this.#pendingRespawnTimer = null;
      // Re-check halted in case stop() was called during the backoff
      // window. Without this, a stop() during backoff would still
      // trigger a re-spawn from the timer callback.
      if (this.#halted) return;
      // Clear #closing BEFORE entering #spawnFresh so a close that
      // fires during the new spawn (e.g. immediate subprocess exit)
      // can flip #closing again. Without this clear, a re-close
      // during spawn would be silently dropped.
      this.#closing = false;
      this.#spawnFresh().catch((err: unknown) => {
        // Codex T11b review P1-2: spawn failure during recovery means
        // we have a half-mutated state (broker reattached to a failed
        // client, runtime maybe stale). Halt the supervisor so a future
        // close can't trigger another mixed-state recovery.
        this.#halted = true;
        const message = err instanceof Error ? err.message : String(err);
        this.#opts.audit.emitFatal(`supervisor halted: spawnFresh failed (${message})`);
      });
    }, delayMs);
  }

  /**
   * Compute backoff delay in milliseconds based on the current failure
   * count. Bounded at 8s (`#consecutiveFailures - 1` capped at index
   * 4 — but with halt-at-5 in place, the 8s slot is unreachable in
   * practice; the formula's cap is a defense-in-depth in case the
   * halt threshold ever moves).
   *
   * Sequence: 500ms → 1s → 2s → 4s → 8s.
   */
  #backoff(): number {
    const idx = Math.min(this.#consecutiveFailures - 1, 4);
    return 500 * (1 << idx);
  }

  /**
   * @internal — drives `#onTransportClose` from tests without going
   * through a real transport's onClose subscription. Lets tests
   * exercise close idempotence, backoff timing, and halt-on-cascade
   * without depending on transport-implementation specifics.
   */
  _handleTransportCloseForTest(code: number | null): void {
    this.#onTransportClose(code);
  }
}

/**
 * Halt threshold: number of consecutive transport closes after which
 * the supervisor stops trying to recover and signals fatal. Five is
 * a heuristic — long enough to ride out normal codex restarts, short
 * enough that a permanently-broken codex install gets surfaced.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

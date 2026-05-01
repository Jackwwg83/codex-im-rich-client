// Phase 1 daemon — Supervisor public types (T11a Step 11a.1).
//
// These types are the public surface for callers wiring up a Supervisor
// (the runtime CLI / IM adapter / future production daemon). T11a's
// Supervisor class consumes SupervisorOptions; T11b extends with edge
// behaviors but does not change this surface.

import type {
  AppServerClient,
  AppServerClientOptions,
  Transport,
} from "@codex-im/app-server-client";
import type { CodexRuntime } from "@codex-im/codex-runtime";
import type { ApprovalBroker } from "@codex-im/core";

/**
 * Audit sink for supervisor lifecycle events. Phase 1 callers can pass
 * a no-op stub; T11b's halt-on-cascade emits via `emitFatal` so the
 * host process can react to "supervisor gave up".
 *
 * Two levels:
 *   - emit       — informational (transport closed, spawning fresh, etc.)
 *   - emitFatal  — supervisor halted; needs operator attention.
 *
 * The supervisor itself NEVER calls `process.exit`. Whether a fatal
 * event terminates the host process is the host's decision. Phase 1
 * IM adapters / CLI dev tooling will likely log + alert; production
 * daemon will probably emit to a watchdog.
 */
export interface SupervisorAudit {
  emit(message: string): void;
  emitFatal(message: string): void;
}

/**
 * Construction-time options for the Supervisor.
 *
 * The factory pattern (transportFactory + clientFactory + runtimeFactory)
 * decouples the supervisor from the concrete transport/client/runtime
 * implementations so tests can inject InMemoryTransport without
 * spawning real codex. Production CLI passes a `transportFactory` that
 * spawns `codex app-server` via `StdioTransport`.
 *
 * `broker` is a single ApprovalBroker that survives every quartet swap.
 * Each `#spawnFresh()` call invokes `broker.reattach(newClient)`. The
 * broker's pending Map carries forward (T9b B-clean), so an in-flight
 * approval started on the prior client can still be observed in the
 * new generation's audit logs (T11b prune sweep would clean these up
 * eventually).
 *
 * `performHandshake` is called on every spawn AFTER `client.start()`.
 * Production passes `(c) => performInitializeHandshake(c, clientInfo)`.
 * The supervisor is not in the business of clientInfo discovery —
 * that's the caller's responsibility.
 */
export interface SupervisorOptions {
  /** Spawns a fresh transport on every recovery — supervisor owns the
   *  subprocess lifecycle. Production: `() => new StdioTransport({...})`.
   *  Tests: `() => fake.clientSide` (or factory that returns paired transports). */
  transportFactory: () => Transport;
  /** Constructs an AppServerClient given a transport. Decoupled so tests
   *  can inject without spawning a real process. */
  clientFactory: (transport: Transport, opts?: AppServerClientOptions) => AppServerClient;
  /** Constructs a CodexRuntime given a client. T7's normalizer
   *  subscribes to `client.onNotification` inside the constructor;
   *  the runtime is built per spawn. */
  runtimeFactory: (client: AppServerClient) => CodexRuntime;
  /** Single ApprovalBroker instance — survives quartet swaps. Each
   *  spawn calls `broker.reattach(client)` (T9b B-clean lifecycle).
   *
   *  **PRODUCTION CONTRACT — must be pre-attached.** The supervisor
   *  always calls `broker.reattach(client)` (including for generation
   *  1) because the per-spawn flow doesn't distinguish "first" from
   *  "Nth". `broker.reattach` requires that `broker.attach()` has
   *  already been called against some prior client (T9b throws
   *  "broker has not been attached yet" otherwise). Callers MUST
   *  therefore construct the broker AND call `attach()` before
   *  passing the broker to the supervisor.
   *
   *  Recommended production pattern:
   *  ```ts
   *  const placeholderTransport = new StdioTransport({...});  // not started
   *  const placeholderClient = new AppServerClient(placeholderTransport);
   *  const broker = new ApprovalBroker(placeholderClient);
   *  broker.attach();  // satisfies the reattach precondition
   *  const supervisor = new Supervisor({ ..., broker });
   *  await supervisor.start();  // first-generation reattach swaps off
   *                              // the placeholder onto the real client
   *  ```
   *
   *  Why this contract instead of "if first generation, attach else
   *  reattach": ApprovalBroker.attach() can only attach to the broker's
   *  constructor-time client. The supervisor doesn't construct the
   *  client (clientFactory does). Forcing pre-attach keeps the
   *  client-creation policy in the caller's hands and avoids leaking
   *  generation-tracking state into the supervisor. (Codex T11a
   *  review P1.)
   */
  broker: ApprovalBroker;
  /** Initialize handshake hook. Runs after `client.start()`. */
  performHandshake: (client: AppServerClient) => Promise<unknown>;
  /** Audit sink (lifecycle messages + fatal halt). */
  audit: SupervisorAudit;
}

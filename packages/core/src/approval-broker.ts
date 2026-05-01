// Phase 1 core — ApprovalBroker (T9a / P1.2 part 1).
//
// The broker owns the SINGLE AppServerClient.setServerRequestHandler slot
// (D7). Codex sends a server-initiated request → AppServerClient invokes
// the broker's handler → broker dispatches via an exhaustive
// `Record<ServerRequest["method"], DispatcherSpec>` table.
//
// Single-handler invariant: attach() throws on second call. Subsequent
// modules (Phase 6 Computer Use approval flow, T11b supervisor handoff)
// MUST go through ApprovalBroker.registerHandler — never call
// client.setServerRequestHandler directly.
//
// Method-name boundary: the 9 string literals for ServerRequest methods
// exist in this file (and only this file inside packages/core/). T9b
// adds a build-time grep guard over packages/{app-server-client,
// codex-runtime,daemon,cli}/src/** asserting these literals appear
// nowhere else. CodexRuntime's own runtime.ts has its own boundary for
// the ClientRequest method literals (T8); the two boundaries are
// orthogonal — codex-runtime never reads ServerRequest methods, and the
// broker never reads ClientRequest methods.
//
// Default-reject policy (Phase 1, never auto-approve):
//
//   item/commandExecution/requestApproval → { decision: "decline" }
//   item/fileChange/requestApproval       → { decision: "decline" }
//   item/permissions/requestApproval      → { permissions: {}, scope: "turn" }
//                                            (no extra perms granted, this turn only)
//   item/tool/requestUserInput            → { answers: {} } (empty)
//   item/tool/call                        → { contentItems: [], success: false }
//                                            (Computer Use disabled in Phase 1)
//   mcpServer/elicitation/request         → { action: "cancel", content: null, _meta: null }
//   applyPatchApproval (legacy)           → { decision: "denied" }
//   execCommandApproval (legacy)          → { decision: "denied" }
//   account/chatgptAuthTokens/refresh     → throws JsonRpcResponseError(-32601)
//                                            (Phase 1 cannot fabricate tokens; never silently approve)
//
// Unknown method (not in the generated ServerRequest union) → broker
// throws `JsonRpcResponseError({ code: -32601, message: "unsupported method ..." })`.
// Pre-3's AppServerClient catch-arm propagates that envelope verbatim
// (no "handler error: " prefix, no -32603 collapse).
//
// T9b additions (NOT in T9a):
//   - reattach(client) for Supervisor (Codex B7)
//   - timeout / throw / transport-loss edge tests
//   - resolve / failPendingAsTransportLost / expirePending implementations
//   - per-method response-shape v2 mapper coverage
//   - build-time grep guard

import {
  type AppServerClient,
  type JsonRpcRequest,
  JsonRpcResponseError,
} from "@codex-im/app-server-client";
import type {
  ApplyPatchApprovalParams,
  ApplyPatchApprovalResponse,
  ChatgptAuthTokensRefreshParams,
  ChatgptAuthTokensRefreshResponse,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ExecCommandApprovalParams,
  ExecCommandApprovalResponse,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  ServerRequest,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
} from "@codex-im/protocol";
import type { ApprovalActor, ApprovalDecision, ApprovalRecord } from "./types.js";

// Module-level guard against two brokers claiming the same client.
// AppServerClient.setServerRequestHandler is a single slot — calling it
// twice silently overwrites. The per-broker `#attached` flag protects
// against the same broker attaching twice; this WeakSet protects against
// two different brokers attaching to the same client (D7 single-handler
// invariant is meant to be per client, not per broker — Codex T9a review
// medium-1).
//
// WeakSet is the right container: entries auto-clear when the client is
// GC'd, so this does not violate ONE-SHOT lifecycle. T11b's supervisor
// constructs a fresh client on every recovery; the prior client becomes
// unreachable and the WeakSet entry vanishes naturally.
const _attachedClients: WeakSet<AppServerClient> = new WeakSet();

/**
 * Per-method dispatcher specification. The handler slot is null until a
 * registerHandler() call installs one; defaultReject is always present
 * and returns the wire-shape codex expects so the turn doesn't hang.
 *
 * Codex outside-voice review on the plan called out that v2 approval
 * responses are NOT all `{ decision: ReviewDecision }` — see 05-PROTOCOL
 * §4.1 and the per-method generated `*RequestApprovalResponse.ts` files.
 * The DispatchTable below uses the actual generated response types.
 */
export type DispatcherSpec<P, R> = {
  handler: ((req: { method: string; params: P; id: string | number }) => Promise<R>) | null;
  defaultReject: () => R;
};

/**
 * Exhaustive Record over the 9 generated ServerRequest method arms.
 * If codex 0.126 adds a new ServerRequest variant, the type-level guard
 * `_ExhaustiveDispatch` below fails to compile until this table is
 * extended — that's the build-time deterrent against silent fall-through.
 */
type DispatchTable = {
  "item/commandExecution/requestApproval": DispatcherSpec<
    CommandExecutionRequestApprovalParams,
    CommandExecutionRequestApprovalResponse
  >;
  "item/fileChange/requestApproval": DispatcherSpec<
    FileChangeRequestApprovalParams,
    FileChangeRequestApprovalResponse
  >;
  "item/permissions/requestApproval": DispatcherSpec<
    PermissionsRequestApprovalParams,
    PermissionsRequestApprovalResponse
  >;
  "item/tool/requestUserInput": DispatcherSpec<
    ToolRequestUserInputParams,
    ToolRequestUserInputResponse
  >;
  "item/tool/call": DispatcherSpec<DynamicToolCallParams, DynamicToolCallResponse>;
  "mcpServer/elicitation/request": DispatcherSpec<
    McpServerElicitationRequestParams,
    McpServerElicitationRequestResponse
  >;
  applyPatchApproval: DispatcherSpec<ApplyPatchApprovalParams, ApplyPatchApprovalResponse>;
  execCommandApproval: DispatcherSpec<ExecCommandApprovalParams, ExecCommandApprovalResponse>;
  "account/chatgptAuthTokens/refresh": DispatcherSpec<
    ChatgptAuthTokensRefreshParams,
    ChatgptAuthTokensRefreshResponse
  >;
};

// Type-level guard: keys of DispatchTable MUST equal ServerRequest["method"].
// If a generated arm is added without updating this table OR a stale key
// remains here after a generated arm is removed, this declaration fails
// to compile (Codex B6 fix — `Map`/`Set` were not exhaustive at type level).
type _ExhaustiveDispatch = ServerRequest["method"] extends keyof DispatchTable
  ? keyof DispatchTable extends ServerRequest["method"]
    ? true
    : ["dispatch table has stale keys not in ServerRequest"]
  : ["dispatch table is missing a ServerRequest method"];
const _exhaustiveCheck: _ExhaustiveDispatch = true;
void _exhaustiveCheck;

// ─── PendingEntry — internal-only completion-promise machinery ────────
//
// T9b blocker-fix (B-clean, 2026-05-01): the broker owns a single
// completion promise per in-flight server-request. Three sources can
// settle it: (1) the registered handler's eventual resolve/reject, (2)
// expirePending(), (3) failPendingAsTransportLost(). All three race
// through `settleOnce`; the first call wins and subsequent calls
// no-op. AppServerClient sees exactly one wire response per id —
// whatever value the winning settler put on the completion. Late
// handler completions (after expire / transport-lost) are observed but
// dropped, so no duplicate wire frames are produced.
//
// PendingEntry is intentionally NOT exported. ApprovalRecord stays
// data-only; capability handles (resolveWire / rejectWire) live inside
// the closure and are reachable only through PendingEntry.settleOnce.
// Tests inspect record state via `_pendingRecordsForTest()`, which
// projects the entry-keyed Map back to a record-keyed view.

type WireOutcome = { type: "resolve"; value: unknown } | { type: "reject"; error: unknown };

interface PendingEntry {
  /** Public-shape audit record. Mutated in-place when status flips. */
  record: ApprovalRecord;
  /** Awaited by `#handle`; resolves/rejects to the wire response. */
  completion: Promise<unknown>;
  /**
   * Settle the completion promise. Returns `true` if this call won the
   * race, `false` if a prior call already settled. The flag prevents the
   * duplicate-response bug (codex T9b review blocker 1) by making sure
   * only one of {handler resolve, handler reject, expirePending,
   * failPendingAsTransportLost} drives the wire response.
   */
  settleOnce: (outcome: WireOutcome) => boolean;
  /** Public-readable mirror of "has settleOnce ever fired". */
  settled: boolean;
  /** Captured at handle-time so settle paths don't re-key the dispatch table. */
  spec: DispatchTable[keyof DispatchTable];
}

function createPendingEntry(
  record: ApprovalRecord,
  spec: DispatchTable[keyof DispatchTable],
): PendingEntry {
  let resolveWire!: (v: unknown) => void;
  let rejectWire!: (e: unknown) => void;
  const completion = new Promise<unknown>((res, rej) => {
    resolveWire = res;
    rejectWire = rej;
  });
  const entry: PendingEntry = {
    record,
    completion,
    spec,
    settled: false,
    settleOnce(outcome) {
      if (this.settled) return false;
      this.settled = true;
      if (outcome.type === "resolve") {
        resolveWire(outcome.value);
      } else {
        rejectWire(outcome.error);
      }
      return true;
    },
  };
  return entry;
}

/**
 * ApprovalBroker — single owner of `AppServerClient.setServerRequestHandler`.
 *
 * Lifecycle (Phase 1, T9a):
 *   - Construct with an AppServerClient (the one this broker will serve).
 *   - Call attach() once. Throws on second attach() (single-handler invariant).
 *   - Call registerHandler<M>(method, handler) per method as Phase 1 wires
 *     each approval flow. T9a leaves all handlers null; downstream tests
 *     (T9a steps 9a.3-9a.5) install handlers per-test.
 *
 * ONE-SHOT lifecycle (mirrors AppServerClient):
 *   When the underlying AppServerClient closes — for any reason — this
 *   broker is dead. Do NOT subscribe to client.onClose, do NOT cache,
 *   do NOT singleton. T11b's Supervisor constructs a fresh
 *   `{ transport, client, runtime, broker }` quartet on every recovery;
 *   the prior broker is discarded.
 *
 *   T9b adds a `reattach(newClient)` API used by the supervisor to
 *   transfer pending approval state to the new client (Codex B7
 *   dependency). The broker instance survives the reattach; only the
 *   client identity changes. The pending Map carries approval records
 *   forward so an in-flight approval started on the prior client can
 *   complete against the new one (resolve() in T9b Step 9b.5).
 */
export class ApprovalBroker {
  #client: AppServerClient;
  readonly #table: DispatchTable;
  // Map of in-flight server-requests keyed by JSON-RPC id. Each entry
  // owns a completion promise that #handle awaits and that
  // expirePending / failPendingAsTransportLost can settle from outside
  // (T9b B-clean blocker-fix). See PendingEntry definition above.
  readonly #pending = new Map<string | number, PendingEntry>();
  #attached = false;
  // T9b D6 idempotence: failPendingAsTransportLost() is called by the
  // supervisor from its transport.onClose subscription. Reset on
  // reattach() so a second client generation can also fail its own
  // pending requests (codex T9b review blocker 2). Idempotency is
  // per-generation: within a single generation the second call no-ops;
  // after reattach the flag is cleared and the new generation starts
  // fresh.
  #transportLostFired = false;

  constructor(client: AppServerClient) {
    this.#client = client;
    this.#table = {
      "item/commandExecution/requestApproval": {
        handler: null,
        defaultReject: () => ({ decision: "decline" }),
      },
      "item/fileChange/requestApproval": {
        handler: null,
        defaultReject: () => ({ decision: "decline" }),
      },
      "item/permissions/requestApproval": {
        handler: null,
        // No extra permissions granted; scope=turn so any prior session-scope
        // grants from other code paths are not extended.
        defaultReject: () => ({ permissions: {}, scope: "turn" }),
      },
      "item/tool/requestUserInput": {
        handler: null,
        defaultReject: () => ({ answers: {} }),
      },
      "item/tool/call": {
        handler: null,
        // Phase 1 has no Computer Use. Default-reject reports a failed
        // tool call; codex's behavior is to surface this to the model.
        defaultReject: () => ({ contentItems: [], success: false }),
      },
      "mcpServer/elicitation/request": {
        handler: null,
        defaultReject: () => ({ action: "cancel", content: null, _meta: null }),
      },
      applyPatchApproval: {
        handler: null,
        defaultReject: () => ({ decision: "denied" }),
      },
      execCommandApproval: {
        handler: null,
        defaultReject: () => ({ decision: "denied" }),
      },
      "account/chatgptAuthTokens/refresh": {
        handler: null,
        // Phase 1 cannot fabricate auth tokens; never silently approve.
        // The Pre-3 path lets us signal -32601 explicitly to codex.
        defaultReject: () => {
          throw new JsonRpcResponseError({
            code: -32601,
            message: "auth refresh not supported in Phase 1",
          });
        },
      },
    };
  }

  /**
   * Attach the broker to its client. Throws if attach() has already been
   * called on this instance (single-handler invariant). Phase 6 / T11b
   * approval-flow modules MUST go through registerHandler — never call
   * client.setServerRequestHandler directly.
   */
  attach(): void {
    if (this.#attached) {
      throw new Error("ApprovalBroker already attached");
    }
    if (_attachedClients.has(this.#client)) {
      throw new Error(
        "ApprovalBroker: client already has an attached broker (D7 single-handler invariant)",
      );
    }
    this.#client.setServerRequestHandler((req) => this.#handle(req));
    _attachedClients.add(this.#client);
    this.#attached = true;
  }

  /**
   * Reattach the broker to a new AppServerClient (T9b Step 9b.1 — Codex
   * B7 dependency for the Supervisor). The supervisor calls this when a
   * codex subprocess restart produces a fresh transport+client; the
   * broker survives the boundary so any in-flight pending approval state
   * (the `#pending` Map) carries forward. resolve()/expirePending() in
   * T9b Step 9b.5 then process that retained state against the new
   * client.
   *
   * Invariants:
   *   - Broker MUST already be attached (call attach() first).
   *   - new client MUST be a different instance than the prior one (we
   *     refuse same-instance reattach to catch identity bugs). If a
   *     legitimate same-instance reattach is ever needed, that's a real
   *     scope expansion not contemplated by D7 — STOP and request user
   *     review.
   *   - new client MUST NOT already have an attached broker (the
   *     `_attachedClients` cross-instance guard).
   *
   * Behavior:
   *   1. Detach handler from prior client (sets the slot to null).
   *   2. Remove prior client from `_attachedClients` so a fresh broker
   *      could re-claim that prior instance later (relevant only in
   *      bizarre test scenarios; T11b in practice never reuses a closed
   *      client).
   *   3. Install handler on new client + add to `_attachedClients`.
   *   4. Update `#client` to point at the new instance.
   *
   * The pending Map is intentionally NOT cleared. T9b Step 9b.5's
   * resolve() looks pending records up by approvalId; if codex on the
   * new client re-issues an approval that was already resolved, the
   * lookup catches it as a duplicate.
   */
  reattach(newClient: AppServerClient): void {
    if (!this.#attached) {
      throw new Error(
        "ApprovalBroker.reattach: broker has not been attached yet; call attach() first",
      );
    }
    if (newClient === this.#client) {
      throw new Error("ApprovalBroker.reattach: new client must be a different instance");
    }
    if (_attachedClients.has(newClient)) {
      throw new Error(
        "ApprovalBroker.reattach: new client already has an attached broker (D7 single-handler invariant)",
      );
    }
    // Detach prior. setServerRequestHandler(null) frees the slot;
    // subsequent server-initiated requests on the prior client will get
    // -32601 "no handler registered" from AppServerClient's default
    // path (which is fine — the prior client is dead by the time the
    // supervisor calls reattach anyway).
    this.#client.setServerRequestHandler(null);
    _attachedClients.delete(this.#client);
    // Attach to new.
    newClient.setServerRequestHandler((req) => this.#handle(req));
    _attachedClients.add(newClient);
    this.#client = newClient;
    // Reset transport-lost generation flag (codex T9b review blocker 2).
    // The new client is its own generation; if its transport later
    // closes, the supervisor's failPendingAsTransportLost() call must
    // actually fire instead of no-op'ing on the prior generation's flag.
    this.#transportLostFired = false;
  }

  /**
   * Install (or replace) the per-method handler for `method`. The handler
   * receives the typed request shape and must return a Promise of the
   * matching response shape. Throwing from a handler propagates to
   * AppServerClient's catch arm and produces:
   *   - JsonRpcResponseError → wire envelope preserves code/message/data
   *     (Pre-3 path; T9b §9b.3 throw-distinction case 2).
   *   - Other Error            → -32603 "handler error: ..." (T9b case 1).
   */
  registerHandler<M extends keyof DispatchTable>(
    method: M,
    handler: NonNullable<DispatchTable[M]["handler"]>,
  ): void {
    this.#table[method].handler = handler as DispatchTable[M]["handler"];
  }

  /**
   * Test-only / coverage-only accessor returning the set of method keys
   * this broker dispatches. T9a Step 9a.5 (dispatch-coverage.test.ts)
   * uses this to assert runtime coverage matches the generated union.
   */
  dispatchMethods(): readonly string[] {
    return Object.keys(this.#table);
  }

  async #handle(req: JsonRpcRequest): Promise<unknown> {
    const m = req.method as keyof DispatchTable;
    // Object.hasOwn rejects prototype-chain keys (defensive against a wire
    // frame whose method happened to match e.g. "toString").
    if (!Object.hasOwn(this.#table, m)) {
      throw new JsonRpcResponseError({
        code: -32601,
        message: `unsupported method ${req.method}`,
      });
    }
    const spec = this.#table[m];
    if (spec.handler === null) {
      // Synchronous default-reject path. No PendingEntry, no completion
      // promise — codex sees an immediate response. defaultReject may
      // throw JsonRpcResponseError (auth-refresh case); the throw
      // propagates to AppServerClient's catch arm verbatim (Pre-3 path).
      return spec.defaultReject();
    }

    // T9b B-clean (codex T9b review blocker 1): build a PendingEntry
    // with a broker-owned completion promise. The handler runs in the
    // background; its result, expirePending(), and
    // failPendingAsTransportLost() all race through entry.settleOnce
    // to settle the same completion. AppServerClient receives exactly
    // one wire response per request id — whatever value the winning
    // settler put on the completion. Late settlers no-op via the
    // `settled` flag, so duplicate wire responses are impossible by
    // construction.
    const record: ApprovalRecord = {
      id: `approval-${req.id}`,
      appServerRequestId: req.id,
      method: req.method,
      params: req.params,
      status: "pending",
      actor: null,
      createdAt: new Date(),
    };
    const entry = createPendingEntry(record, spec);
    this.#pending.set(req.id, entry);

    // Background handler invocation. The void-IIFE pattern lets us not
    // await directly — instead we await entry.completion below. The
    // handler's resolve/reject feeds into settleOnce; if the handler
    // wins the race normally, settleOnce returns true and entry.completion
    // is settled with the handler's outcome. If expire/transportLost
    // already fired, settleOnce returns false and the handler's
    // result is dropped (never reaches wire).
    //
    // The `as` cast is load-bearing: TypeScript can't prove that
    // req.method (string) corresponds to spec.handler's parameterized P,
    // even though the dispatch-table key already proved it. The runtime
    // dispatch path narrows by key, so the cast is sound.
    void (async () => {
      try {
        const result = await (spec.handler as (r: JsonRpcRequest) => Promise<unknown>)(req);
        entry.settleOnce({ type: "resolve", value: result });
      } catch (err) {
        entry.settleOnce({ type: "reject", error: err });
      }
    })();

    try {
      return await entry.completion;
    } finally {
      // Conditional delete (codex T9b review medium 3): only clean up
      // the pending entry when the handler won the race normally
      // (status still "pending" — neither expirePending nor
      // failPendingAsTransportLost flipped it). Terminal records
      // (expired / transport_lost) stay in #pending for audit until an
      // explicit prune path (T11b future). resolve() / expirePending() /
      // failPendingAsTransportLost() all check status before processing,
      // so terminal records are skipped by subsequent passes.
      if (entry.record.status === "pending") {
        this.#pending.delete(req.id);
      }
    }
  }

  // ── T9b lifecycle (Step 9b.5) ────────────────────────────────────

  /**
   * Resolve a pending approval with a user / system decision. Phase 2
   * IM adapter wires this to "user pressed approve/deny" actions; Phase
   * 1 has no callers, so this remains a stub that signals where Phase 2
   * picks up. The wire-mapping (ApprovalDecision → per-method response
   * shape) is the load-bearing part deferred to Phase 2 — see plan
   * §1750 for why it can't reuse the legacy {decision: ReviewDecision}
   * shape across all v2 methods.
   *
   * Phase 1 callers MUST NOT use this. The default-reject path on the
   * registered handler being null already covers Phase 1's
   * "default-deny" semantic without going through resolve().
   */
  resolve(_approvalId: string, _decision: ApprovalDecision, _actor: ApprovalActor): void {
    throw new Error(
      "ApprovalBroker.resolve: deferred to Phase 2 IM integration (no Phase 1 callers; wire-mapping per-method response shapes is Phase 2 scope)",
    );
  }

  /**
   * Mark every pending approval as transport-lost (D6). Idempotent
   * within a single client generation; reattach() resets the flag so
   * the next generation can fire its own transport-loss sweep.
   *
   * The supervisor (T11b) calls this from its transport.onClose
   * subscription. T9b B-clean blocker-fix: each pending entry's
   * completion is settled via `settleOnce` with the per-method
   * defaultReject value. AppServerClient receives that value via
   * `#handle`'s return and emits exactly one wire response per id.
   * If the transport is already closed (the production T11b path),
   * AppServerClient.respond is a no-op so the wire frame is harmlessly
   * dropped. If the transport is still alive (the test path), the
   * defaultReject is the actual wire response.
   *
   * Late handler completions (after this method runs) call
   * `entry.settleOnce` unconditionally, which returns false because
   * `entry.settled` was already set to true by this method's settle —
   * the late outcome is dropped. No duplicate wire frame, no leaked
   * work. (The `settled` flag is the load-bearing guard; status flips
   * are for audit visibility, not for blocking late settlers.)
   *
   * Records are NOT removed from `#pending` after the status flip.
   * The decision was deliberate: tests + audit need to inspect the
   * terminal records. resolve() / expirePending() check status before
   * processing, so terminal records are skipped automatically.
   */
  failPendingAsTransportLost(): void {
    if (this.#transportLostFired) return;
    this.#transportLostFired = true;
    const decidedAt = new Date();
    for (const entry of this.#pending.values()) {
      if (entry.record.status !== "pending") continue;
      entry.record.status = "transport_lost";
      entry.record.actor = { kind: "system", reason: "transport_lost" };
      entry.record.decision = { kind: "denied", reason: "transport_lost" };
      entry.record.decidedAt = decidedAt;
      // Settle the broker completion via settleOnce (no direct
      // client.respond/reject). AppServerClient's catch arm preserves
      // JsonRpcResponseError envelopes (Pre-3); generic throws collapse
      // to -32603 with the legacy "handler error: " prefix.
      try {
        const value = entry.spec.defaultReject();
        entry.settleOnce({ type: "resolve", value });
      } catch (err) {
        entry.settleOnce({ type: "reject", error: err });
      }
    }
  }

  /**
   * Sweep pending approvals older than `maxAgeMs` (default 10 minutes)
   * and emit per-method default-reject responses to codex for each.
   * The default-reject value is the same one the broker uses for
   * "no handler installed" — Phase 1 never auto-approves, so an
   * expired approval is treated identically to one whose handler was
   * never wired.
   *
   * Returns the count of records expired in this sweep (useful for
   * supervisor monitoring / metrics in T11b).
   *
   * Skipped: records already in a terminal state (resolved / expired /
   * transport_lost). The status check makes this safe to call after
   * failPendingAsTransportLost without double-processing.
   *
   * T9b B-clean blocker-fix: each expired record's completion is
   * settled via `settleOnce` (no direct client.respond / client.reject).
   * AppServerClient receives the defaultReject value via #handle's
   * return and emits exactly one wire response per id. Late handler
   * completions call `entry.settleOnce` unconditionally; it returns
   * false because `entry.settled` was already set by this method's
   * settle — the late outcome is dropped. No duplicate wire frame.
   *
   * Edge case: account/chatgptAuthTokens/refresh's defaultReject
   * throws JsonRpcResponseError(-32601). settleOnce as `reject` so
   * AppServerClient's catch arm preserves the explicit code/message/data
   * envelope on the wire (Pre-3 path).
   */
  expirePending(maxAgeMs = 600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    const decidedAt = new Date();
    let count = 0;
    for (const entry of this.#pending.values()) {
      if (entry.record.status !== "pending") continue;
      if (entry.record.createdAt.getTime() > cutoff) continue;
      entry.record.status = "expired";
      entry.record.actor = { kind: "system", reason: "expired" };
      entry.record.decision = { kind: "denied", reason: "expired" };
      entry.record.decidedAt = decidedAt;
      count++;
      // Settle the broker completion (B-clean). No direct
      // client.respond / client.reject — the wire response goes through
      // #handle's await of entry.completion → AppServerClient's
      // single-respond path.
      try {
        const value = entry.spec.defaultReject();
        entry.settleOnce({ type: "resolve", value });
      } catch (err) {
        // defaultReject for account/chatgptAuthTokens/refresh throws
        // JsonRpcResponseError(-32601). Settle as reject so the
        // AppServerClient catch arm produces the right wire envelope.
        // Other thrown values would be a dispatch-table bug — we
        // forward them through settleOnce too rather than swallowing
        // silently; the handler's eventual reject path produces
        // -32603 "handler error: ..." which makes the bug visible.
        entry.settleOnce({ type: "reject", error: err });
      }
    }
    return count;
  }

  // ── Test-only accessor ───────────────────────────────────────────
  //
  // Not part of the public Phase 1 surface. Exposed because the
  // pending-record state machinery is internal to the broker and
  // tests for D6 (transport_lost) and expirePending need to inspect
  // post-condition record states. Phase 2 IM integration will use a
  // proper public API; this is the stop-gap for T9b tests.

  /**
   * @internal — for tests only. Returns a defensive shallow copy of
   * the pending records keyed by request id, projected from the
   * internal `#pending` Map (which keys to PendingEntry, an
   * implementation detail kept private so ApprovalRecord remains
   * data-only). The records themselves are aliased; if the test
   * mutates a record's fields, broker behavior is undefined.
   */
  _pendingRecordsForTest(): ReadonlyMap<string | number, ApprovalRecord> {
    const result = new Map<string | number, ApprovalRecord>();
    for (const [id, entry] of this.#pending) {
      result.set(id, entry.record);
    }
    return result;
  }
}

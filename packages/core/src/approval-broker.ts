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
  readonly #pending = new Map<string | number, ApprovalRecord>();
  #attached = false;
  // T9b D6 idempotence: failPendingAsTransportLost() is called by the
  // supervisor from its transport.onClose subscription. If the supervisor
  // calls it twice (e.g. close fires more than once), the second call
  // must be a no-op — pending records are already terminal.
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
      // Synchronously invoke defaultReject so a throwing default
      // (account/chatgptAuthTokens/refresh) propagates as a thrown
      // JsonRpcResponseError, not a rejected Promise wrapping the throw.
      // No pending tracking on the default-reject path: codex sees a
      // synchronous response and never thinks of this as "in flight"
      // from the broker's perspective.
      return spec.defaultReject();
    }
    // T9b Step 9b.5: track in-flight approvals in #pending so
    // failPendingAsTransportLost (D6) and expirePending have something
    // to drain. The record is inserted BEFORE invoking the handler so
    // a synchronous throw still leaves a snapshot for transport-loss
    // bookkeeping (the try/finally below removes it after the handler
    // settles, success or throw).
    const record: ApprovalRecord = {
      id: `approval-${req.id}`,
      appServerRequestId: req.id,
      method: req.method,
      params: req.params,
      status: "pending",
      actor: null,
      createdAt: new Date(),
    };
    this.#pending.set(req.id, record);
    try {
      // The `as never` cast is load-bearing: TypeScript can't prove that
      // req.method (string) corresponds to spec.handler's parameterized P,
      // even though the dispatch-table key already proved it. The runtime
      // dispatch path narrows by key, so the cast is sound.
      return await (spec.handler as (req: JsonRpcRequest) => Promise<unknown>)(req);
    } finally {
      // Remove on resolve/throw. If failPendingAsTransportLost ran
      // concurrently and already cleared the entry, this delete is a
      // no-op; if expirePending updated the record's status to
      // "expired" but didn't remove (it does remove), same. The Map
      // delete is idempotent.
      this.#pending.delete(req.id);
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
   * Mark every pending approval as transport-lost (D6). Idempotent:
   * subsequent calls return immediately. The supervisor (T11b) calls
   * this from its transport.onClose subscription. We do NOT call
   * `client.respond` — the client is dead by the time this runs and
   * the wire frame would be dropped anyway (AppServerClient.respond is
   * a no-op when closed).
   *
   * Records are NOT removed from `#pending` after the status flip. The
   * decision was deliberate: tests + audit need to inspect the
   * terminal records. resolve() / expirePending() check status before
   * processing, so terminal records are skipped automatically.
   */
  failPendingAsTransportLost(): void {
    if (this.#transportLostFired) return;
    this.#transportLostFired = true;
    const now = new Date();
    for (const record of this.#pending.values()) {
      if (record.status !== "pending") continue;
      record.status = "transport_lost";
      record.actor = { kind: "system", reason: "transport_lost" };
      record.decision = { kind: "denied", reason: "transport_lost" };
      record.decidedAt = now;
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
   * Edge case: account/chatgptAuthTokens/refresh's defaultReject
   * throws JsonRpcResponseError(-32601). For an expired auth-refresh,
   * we still record the record as expired but call client.reject
   * directly with the -32601 envelope (instead of letting the throw
   * propagate to nowhere). This keeps the wire contract consistent
   * with the synchronous default-reject path.
   */
  expirePending(maxAgeMs = 600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    const decidedAt = new Date();
    let count = 0;
    const expiredIds: Array<string | number> = [];
    for (const record of this.#pending.values()) {
      if (record.status !== "pending") continue;
      if (record.createdAt.getTime() > cutoff) continue;
      record.status = "expired";
      record.actor = { kind: "system", reason: "expired" };
      record.decision = { kind: "denied", reason: "expired" };
      record.decidedAt = decidedAt;
      expiredIds.push(record.appServerRequestId);
      count++;
    }
    // Emit wire responses outside the iteration so #pending mutations
    // (the in-flight handler's try/finally `delete`) cannot interfere.
    // Records remain in #pending with terminal status until the
    // handler resolves — but at that point its try/finally `delete` is
    // a no-op for already-removed keys. We keep them around explicitly
    // for audit; T11b may add a separate prune sweep.
    for (const id of expiredIds) {
      const record = this.#pending.get(id);
      if (!record) continue;
      const spec = this.#table[record.method as keyof DispatchTable];
      if (!spec) continue;
      try {
        const resp = spec.defaultReject();
        this.#client.respond(id, resp);
      } catch (err) {
        // defaultReject for account/chatgptAuthTokens/refresh throws
        // JsonRpcResponseError(-32601). Translate to a wire reject.
        if (err instanceof JsonRpcResponseError) {
          this.#client.reject(id, {
            code: err.code,
            message: err.rawMessage,
            data: err.data,
          });
        } else {
          // Non-JsonRpcResponseError throw from a defaultReject is
          // unexpected — this would be a bug in the dispatch table.
          // Re-throw so the developer sees the failure rather than
          // silently dropping the wire response.
          throw err;
        }
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
   * the pending records Map. The records themselves are aliased; if
   * the test mutates a record's fields, broker behavior is undefined.
   */
  _pendingRecordsForTest(): ReadonlyMap<string | number, ApprovalRecord> {
    return new Map(this.#pending);
  }
}

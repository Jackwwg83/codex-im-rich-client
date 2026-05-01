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
import { actionToDecision } from "./action-to-decision.js";
import { AuditEmitter, type AuditEventInput } from "./audit.js";
import { mapDecisionForPending } from "./decision-mapper.js";
import type {
  ActorPolicy,
  ApprovalActor,
  ApprovalDecision,
  ApprovalRecord,
  ApprovalUiAction,
  BindResult,
  PendingApprovalSnapshot,
  ResolveApprovalInput,
  ResolveApprovalResult,
  Target,
} from "./types.js";

/**
 * Outcome reported to `onPendingResolved` subscribers when a pending
 * approval settles.
 *
 *   user    — IM-driven resolve() (T11). Actor + decision captured.
 *   handler — Phase 1 / handler-mode auto-resolve via the registered
 *             per-method handler. No IM actor.
 *   system  — broker-driven settle: `expired` or `transport_lost`.
 */
export type ResolvedOutcome =
  | { kind: "user"; decision: ApprovalUiAction; actor: NonNullable<ApprovalActor> }
  | { kind: "handler" }
  | { kind: "system"; reason: "expired" | "transport_lost" };

// T6 type cascade: default TTL for the new ApprovalRecord.expiresAt field.
// 30 minutes matches plan §1 D20's documented default. T8 / T11 will
// parameterize via broker constructor option when in-resolve expiry
// lands; this constant is the placeholder used by Phase 1's #handle
// PendingEntry creation so the type compiles after T6.
const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;

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
  /**
   * Three-mode dispatch (D18). default-reject is the Phase 1 invariant
   * (no IM, no pending state); handler is the Phase 1 background-IIFE
   * path; pending is the Phase 2 IM-driven path that creates a
   * PendingEntry and awaits external resolve / expirePending /
   * failPendingAsTransportLost. registerHandler flips to "handler";
   * enablePendingMode flips to "pending"; disablePendingMode reverts
   * to "default-reject" (and clears handler).
   */
  mode: "default-reject" | "handler" | "pending";
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
 * Field-wise structural equality for two non-null ApprovalActor values.
 * Codex T7-T12 review P1 fix: replaces JSON.stringify-based equality
 * (key-order-sensitive — `{platform, userId}` vs `{userId, platform}`
 * would JSON-stringify differently and produce a false conflict).
 */
function actorEqual(a: NonNullable<ApprovalActor>, b: NonNullable<ApprovalActor>): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "system" && b.kind === "system") {
    return a.reason === b.reason;
  }
  if (a.kind === "im" && b.kind === "im") {
    return (
      a.platform === b.platform &&
      a.userId === b.userId &&
      (a.chatId ?? null) === (b.chatId ?? null)
    );
  }
  return false;
}

/**
 * Deep structural equality for ActorPolicy (T9 / D19). Used by
 * `bindActorPolicy` to decide whether a re-bind is idempotent (same
 * policy → ok) or conflicting (different policy → conflicting_policy).
 * Field-wise so key insertion order doesn't matter.
 */
function policiesEqual(a: ActorPolicy, b: ActorPolicy): boolean {
  if (a.callbackNonce !== b.callbackNonce) return false;
  if (!targetEqual(a.target, b.target)) return false;
  if (a.allowedActors.length !== b.allowedActors.length) return false;
  for (let i = 0; i < a.allowedActors.length; i += 1) {
    const ai = a.allowedActors[i];
    const bi = b.allowedActors[i];
    if (ai === undefined || bi === undefined) return false;
    if (!actorEqual(ai, bi)) return false;
  }
  return true;
}

/**
 * Check whether `actor` is in the policy's allowedActors list (T11 / D19).
 * Deep structural match on platform + userId; chatId on actors is not
 * compared (chatId belongs to the target, not the actor identity).
 */
function actorAllowed(
  allowed: readonly NonNullable<ApprovalActor>[],
  actor: NonNullable<ApprovalActor>,
): boolean {
  for (const a of allowed) {
    if (a.kind !== actor.kind) continue;
    if (a.kind === "system" && actor.kind === "system") {
      if (a.reason === actor.reason) return true;
      continue;
    }
    if (a.kind === "im" && actor.kind === "im") {
      if (a.platform === actor.platform && a.userId === actor.userId) return true;
    }
  }
  return false;
}

/**
 * Strict equality for Target (T11 / D19). All four fields must match;
 * an undefined optional on one side and a defined value on the other
 * is a mismatch (don't widen — clients must include the same scope they
 * received in the bound policy).
 */
function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    a.threadKey === b.threadKey &&
    a.topicId === b.topicId
  );
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
  // T7 (Phase 2 D12 / D15): secondary index keyed by stable approvalId
  // (`approval-${appServerRequestId}`). Inserted in lock-step with
  // `#pending` inside `#handle`; deleted in lock-step in the `finally`
  // block when the handler-mode happy path completes. Terminal records
  // (resolved / expired / transport_lost) stay in BOTH maps until prune.
  // T11's `resolve()` looks up via this map directly (NOT via
  // `getPending` which filters by status) so terminal-state error
  // branches (already_resolved / expired / transport_lost) can fire.
  readonly #pendingById = new Map<string, PendingEntry>();
  // T7 (Phase 2 D12): pending-lifecycle event subscribers. Fired at the
  // `#settleEntry` boundary so observation order matches the wire-
  // response order. `created` fires synchronously in `#handle`; `resolved`
  // fires only on settleOnce-WIN paths (D21: losing settles emit
  // approval.duplicate_attempt audit, NOT this observer).
  readonly #createdHandlers = new Set<(snap: PendingApprovalSnapshot) => void>();
  readonly #resolvedHandlers = new Set<
    (snap: PendingApprovalSnapshot, outcome: ResolvedOutcome) => void
  >();
  // T7: structured audit emission. T5 ships AuditEmitter (in-memory ring
  // + optional logger sink + redact applied at emit). Constructor takes
  // an optional pre-built emitter; default = new no-logger emitter so
  // Phase 1 broker tests still pass.
  readonly #audit: AuditEmitter;
  // T9 (Phase 2 D19): per-approval actor binding. Daemon wire-up calls
  // bindActorPolicy() once before the IM card lands so resolve() (T11)
  // can validate the click came from an allowed actor at the bound
  // target with the bound nonce. Idempotent on identical policy; rejects
  // re-bind with a different policy. Storage only at T9; resolve()-side
  // validation is T11.
  readonly #actorPolicies = new Map<string, ActorPolicy>();
  #attached = false;
  // T9b D6 idempotence: failPendingAsTransportLost() is called by the
  // supervisor from its transport.onClose subscription. Reset on
  // reattach() so a second client generation can also fail its own
  // pending requests (codex T9b review blocker 2). Idempotency is
  // per-generation: within a single generation the second call no-ops;
  // after reattach the flag is cleared and the new generation starts
  // fresh.
  #transportLostFired = false;
  // T11 / D20 / Codex T7-T12 review P2: per-broker TTL applied at
  // PendingEntry creation. Defaults to 30 minutes per plan §1 D20.
  // Constructor option lets tests + supervisor wiring override.
  readonly #approvalTtlMs: number;

  constructor(
    client: AppServerClient,
    opts: { audit?: AuditEmitter; approvalTtlMs?: number } = {},
  ) {
    this.#client = client;
    this.#audit = opts.audit ?? new AuditEmitter();
    if (opts.approvalTtlMs !== undefined) {
      if (!Number.isFinite(opts.approvalTtlMs) || opts.approvalTtlMs <= 0) {
        throw new Error(
          `ApprovalBroker: approvalTtlMs must be a positive finite number (got ${opts.approvalTtlMs})`,
        );
      }
    }
    this.#approvalTtlMs = opts.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.#table = {
      "item/commandExecution/requestApproval": {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ decision: "decline" }),
      },
      "item/fileChange/requestApproval": {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ decision: "decline" }),
      },
      "item/permissions/requestApproval": {
        mode: "default-reject" as const,
        handler: null,
        // No extra permissions granted; scope=turn so any prior session-scope
        // grants from other code paths are not extended.
        defaultReject: () => ({ permissions: {}, scope: "turn" }),
      },
      "item/tool/requestUserInput": {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ answers: {} }),
      },
      "item/tool/call": {
        mode: "default-reject" as const,
        handler: null,
        // Phase 1 has no Computer Use. Default-reject reports a failed
        // tool call; codex's behavior is to surface this to the model.
        defaultReject: () => ({ contentItems: [], success: false }),
      },
      "mcpServer/elicitation/request": {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ action: "cancel", content: null, _meta: null }),
      },
      applyPatchApproval: {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ decision: "denied" }),
      },
      execCommandApproval: {
        mode: "default-reject" as const,
        handler: null,
        defaultReject: () => ({ decision: "denied" }),
      },
      "account/chatgptAuthTokens/refresh": {
        mode: "default-reject" as const,
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
    this.#table[method].mode = "handler";
  }

  /**
   * Switch `method` to pending-mode (D18 / T8). Server-requests for this
   * method create a PendingEntry but the broker does NOT run a handler
   * IIFE — the completion stays open until external resolve() /
   * expirePending() / failPendingAsTransportLost() settles it.
   *
   * Idempotent. Used by the IM wiring (typically the daemon's
   * onPendingCreated subscriber + bindActorPolicy + IM render path).
   * Methods NOT in pending-mode default-reject (Phase 1 invariant).
   */
  enablePendingMode<M extends keyof DispatchTable>(method: M): void {
    this.#table[method].mode = "pending";
  }

  /**
   * Revert `method` to default-reject (T8). Clears the handler slot too;
   * a subsequent enablePendingMode or registerHandler call is required
   * before the method does anything other than default-reject.
   * Mainly for tests / hot-reload teardown.
   */
  disablePendingMode<M extends keyof DispatchTable>(method: M): void {
    this.#table[method].mode = "default-reject";
    this.#table[method].handler = null;
  }

  /**
   * Bind a per-approval actor policy (D19 / T9). Daemon wire-up's
   * onPendingCreated subscriber calls this synchronously BEFORE the IM
   * card hits the user, so the binding exists by the time any user
   * click can race back through resolve().
   *
   * Returns:
   *   {kind: "ok"}                                       — first-bind or
   *                                                        idempotent same-policy rebind.
   *   {kind: "error", error: {kind: "unknown_approval_id"}} — no pending
   *                                                        with that id (caller bug).
   *   {kind: "error", error: {kind: "not_pending"}}        — record is in
   *                                                        a terminal state.
   *   {kind: "error", error: {kind: "conflicting_policy"}} — re-bind with
   *                                                        a different policy.
   *
   * T9 only stores; T11's resolve() consumes the stored policy to fail
   * closed on wrong_actor / wrong_target / stale_callback / binding_required.
   */
  bindActorPolicy(approvalId: string, policy: ActorPolicy): BindResult {
    const entry = this.#pendingById.get(approvalId);
    if (entry === undefined) {
      return { kind: "error", error: { kind: "unknown_approval_id" } };
    }
    if (entry.record.status !== "pending") {
      return { kind: "error", error: { kind: "not_pending" } };
    }
    const existing = this.#actorPolicies.get(approvalId);
    if (existing !== undefined) {
      if (policiesEqual(existing, policy)) {
        return { kind: "ok" };
      }
      return { kind: "error", error: { kind: "conflicting_policy" } };
    }
    this.#actorPolicies.set(approvalId, policy);
    return { kind: "ok" };
  }

  /**
   * Test-only accessor — mirrors `_pendingRecordsForTest`. Returns the
   * stored policy or null. T9 tests use this to assert verbatim storage;
   * T11 will consume the same map internally for validation.
   */
  _actorPolicyForTest(approvalId: string): ActorPolicy | null {
    return this.#actorPolicies.get(approvalId) ?? null;
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
      // Codex T7-T12 review P1: D13 enumerates `approval.unsupported_method`
      // explicitly — emit it before throwing so audit trail records the
      // protocol-drift event (e.g. codex 0.126 added a method we don't
      // dispatch). The throw still propagates -32601 to codex per Pre-3.
      this.#audit.emit({
        kind: "approval.unsupported_method",
        appServerRequestId: req.id,
        metadata: { method: req.method },
      });
      throw new JsonRpcResponseError({
        code: -32601,
        message: `unsupported method ${req.method}`,
      });
    }
    const spec = this.#table[m];
    if (spec.mode === "default-reject") {
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
    // T6 type cascade: ApprovalRecord requires expiresAt: Date (D20).
    // Phase 1 broker has no TTL plumbing — set a 30-minute default here so
    // the type checks. T8 / T11 will parameterize via broker constructor
    // option when resolve() / pending-mode lands; for now this is a
    // defensive placeholder. Actual D20 in-resolve expiry check happens
    // in T11.
    const createdAt = new Date();
    const record: ApprovalRecord = {
      id: `approval-${req.id}`,
      appServerRequestId: req.id,
      method: req.method,
      params: req.params,
      status: "pending",
      actor: null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.#approvalTtlMs),
    };
    const entry = createPendingEntry(record, spec);
    this.#pending.set(req.id, entry);
    // T7: secondary index + audit emit + onPendingCreated observer.
    // Insert order matters: secondary index first so getPending() works
    // immediately; emit-created last so subscribers see consistent state.
    this.#pendingById.set(record.id, entry);
    this.#audit.emit({
      kind: "approval.created",
      approvalId: record.id,
      appServerRequestId: req.id,
      metadata: { method: req.method },
    });
    this.#emitPendingCreated(record);

    // Background handler invocation. The void-IIFE pattern lets us not
    // await directly — instead we await entry.completion below. The
    // handler's resolve/reject feeds into settleOnce; if the handler
    // wins the race normally, settleOnce returns true and entry.completion
    // is settled with the handler's outcome. If expire/transportLost
    // already fired, settleOnce returns false and the handler's
    // result is dropped (never reaches wire).
    //
    // T7: routes through #settleEntry so audit emit + onPendingResolved
    // observer fire at the boundary. settleOnce body itself is byte-for-
    // byte unchanged (D21 / round-2 T3); only the call site is wrapped.
    //
    // The `as` cast is load-bearing: TypeScript can't prove that
    // req.method (string) corresponds to spec.handler's parameterized P,
    // even though the dispatch-table key already proved it. The runtime
    // dispatch path narrows by key, so the cast is sound.
    //
    // T8 / D18: only handler-mode runs the IIFE. Pending-mode awaits
    // entry.completion forever; settle is driven externally by resolve()
    // (T11), expirePending(), or failPendingAsTransportLost().
    if (spec.mode === "handler" && spec.handler !== null) {
      void (async () => {
        try {
          const result = await (spec.handler as (r: JsonRpcRequest) => Promise<unknown>)(req);
          this.#settleEntry(
            entry,
            { type: "resolve", value: result },
            {
              kind: "approval.resolved",
              approvalId: record.id,
              appServerRequestId: req.id,
              metadata: { method: req.method, source: "handler" },
            },
            { kind: "handler" },
          );
        } catch (err) {
          this.#settleEntry(
            entry,
            { type: "reject", error: err },
            {
              kind: "approval.resolved",
              approvalId: record.id,
              appServerRequestId: req.id,
              metadata: { method: req.method, source: "handler-error", error: String(err) },
            },
            { kind: "handler" },
          );
        }
      })();
    }

    try {
      return await entry.completion;
    } finally {
      // Conditional delete (codex T9b review medium 3): only clean up
      // the pending entry when the handler won the race normally
      // (status still "pending" — neither expirePending nor
      // failPendingAsTransportLost flipped it). Terminal records
      // (expired / transport_lost / resolved-via-IM-pending-mode) stay
      // in BOTH maps for audit until an explicit prune path (Phase 3).
      // T7 deletes from BOTH `#pending` AND `#pendingById` lock-step.
      if (entry.record.status === "pending") {
        this.#pending.delete(req.id);
        this.#pendingById.delete(record.id);
      }
    }
  }

  // ── T9b lifecycle (Step 9b.5) ────────────────────────────────────

  /**
   * Resolve a pending approval with a user-driven UI action (T11 / D12 /
   * D19 / D20). The IM rendering layer wires this to "user pressed
   * approve/deny" callbacks. Returns a discriminated `ResolveApprovalResult`
   * describing what happened — `ok` if the wire was settled, or one of
   * 9 `ResolveError` kinds if the broker fail-closed.
   *
   * Validation order (matches D12 step list verbatim):
   *   1. Internal #pendingById lookup → null → unknown_approval_id.
   *   2. Terminal status (resolved → already_resolved with priorDecision;
   *      expired → expired; transport_lost → transport_lost).
   *   3. Wall-clock expiry (Date.now() >= expiresAt) — flip status,
   *      settle defaultReject, return expired. T11.3 / Codex P0-4.
   *   4. Bound policy check: missing → binding_required.
   *   5. Actor membership check → wrong_actor.
   *   6. Target equality check → wrong_target.
   *   7. Nonce equality check → stale_callback.
   *   8. mapDecisionForPending: error → JSON-RPC reject; unsupported →
   *      unsupported_decision (audit + return WITHOUT settling wire).
   *   9. Settle wire via #settleEntry → ok.
   *
   * Wire-response invariant: at most one wire response per request id
   * (B-clean / settleOnce). Validation-error branches (binding /
   * actor / target / nonce / unsupported_decision) DO NOT settle the
   * wire — pending state preserved so a corrected click can race
   * through. Expiry branches (3 + 5 internal-lookup variant) settle
   * with defaultReject.
   */
  async resolve(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const entry = this.#pendingById.get(input.approvalId);
    if (entry === undefined) {
      this.#audit.emit({
        kind: "approval.unknown_approval_id",
        approvalId: input.approvalId,
        metadata: { source: "resolve" },
      });
      return { kind: "error", error: { kind: "unknown_approval_id" } };
    }
    const record = entry.record;

    // Codex T7-T12 review P1: terminal-resolve branches MUST emit
    // approval.duplicate_attempt so a second click after the entry
    // already settled (handler-mode happy path or system-driven
    // expire/transport-lost) leaves an audit trail. The entry's
    // settleOnce flag is already true by the time we get here, so
    // the wire is not double-responded — but the bookkeeping needs
    // to reflect "user clicked, but lost the race". Mirrors the
    // losing-settle audit semantics of #settleEntry (D21).
    const dupAttemptAudit = (attemptedKind: AuditEventInput["kind"]): AuditEventInput => ({
      kind: "approval.duplicate_attempt",
      approvalId: record.id,
      appServerRequestId: record.appServerRequestId,
      actor: input.actor,
      metadata: {
        attemptedKind,
        outcome: "lost-race",
        source: "resolve",
        action: input.decision.kind,
        terminalStatus: record.status,
      },
    });
    if (record.status === "resolved") {
      this.#audit.emit(dupAttemptAudit("approval.resolved"));
      const priorDecision: ApprovalDecision = record.decision ?? actionToDecision(input.decision);
      return {
        kind: "error",
        error: { kind: "already_resolved", priorDecision },
      };
    }
    if (record.status === "expired") {
      this.#audit.emit(dupAttemptAudit("approval.expired"));
      return {
        kind: "error",
        error: {
          kind: "expired",
          createdAt: record.createdAt,
          expiredAt: record.decidedAt ?? record.expiresAt,
        },
      };
    }
    if (record.status === "transport_lost") {
      this.#audit.emit(dupAttemptAudit("approval.transport_lost"));
      return {
        kind: "error",
        error: {
          kind: "transport_lost",
          lostAt: record.decidedAt ?? new Date(),
        },
      };
    }

    // D20: wall-clock expiry. Even with no expirePending() sweep, a
    // resolve() arriving past expiresAt fails closed. Flip status,
    // settle defaultReject, audit "approval.expired" (#settleEntry
    // emits the supplied audit event on win + the duplicate audit
    // on lose).
    const now = new Date();
    if (now.getTime() >= record.expiresAt.getTime()) {
      record.status = "expired";
      record.actor = { kind: "system", reason: "expired" };
      record.decision = { kind: "denied", reason: "expired" };
      record.decidedAt = now;
      const audit: AuditEventInput = {
        kind: "approval.expired",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
        metadata: { source: "resolve" },
      };
      try {
        const value = entry.spec.defaultReject();
        this.#settleEntry(entry, { type: "resolve", value }, audit, {
          kind: "system",
          reason: "expired",
        });
      } catch (err) {
        this.#settleEntry(entry, { type: "reject", error: err }, audit, {
          kind: "system",
          reason: "expired",
        });
      }
      return {
        kind: "error",
        error: { kind: "expired", createdAt: record.createdAt, expiredAt: now },
      };
    }

    // D19 actor binding validation. Missing binding is a daemon-wireup
    // bug (operator must call bindActorPolicy synchronously before the
    // card lands). Mismatching actor / target / nonce all fail closed
    // WITHOUT settling — a corrected click can still race.
    const policy = this.#actorPolicies.get(input.approvalId);
    if (policy === undefined) {
      this.#audit.emit({
        kind: "approval.binding_required",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
      });
      return { kind: "error", error: { kind: "binding_required" } };
    }
    if (!actorAllowed(policy.allowedActors, input.actor)) {
      this.#audit.emit({
        kind: "approval.wrong_actor",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
        actor: input.actor,
      });
      return { kind: "error", error: { kind: "wrong_actor" } };
    }
    if (!targetEqual(policy.target, input.target)) {
      this.#audit.emit({
        kind: "approval.wrong_target",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
        actor: input.actor,
      });
      return { kind: "error", error: { kind: "wrong_target" } };
    }
    if (policy.callbackNonce !== input.callbackNonce) {
      this.#audit.emit({
        kind: "approval.stale_callback",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
        actor: input.actor,
      });
      return { kind: "error", error: { kind: "stale_callback" } };
    }

    // Wire-shape mapping (D11). unsupported → audit + return without
    // settling; error → reject the wire with JSON-RPC error envelope.
    const wire = mapDecisionForPending(record, input.decision);
    if (wire.kind === "unsupported") {
      this.#audit.emit({
        kind: "approval.unsupported_decision",
        approvalId: record.id,
        appServerRequestId: record.appServerRequestId,
        actor: input.actor,
        metadata: { method: record.method, reason: wire.reason },
      });
      return {
        kind: "error",
        error: {
          kind: "unsupported_decision",
          method: record.method,
          reason: wire.reason,
        },
      };
    }
    const decidedAt = new Date();
    const decision = actionToDecision(input.decision);
    const decidedRecord = record;
    decidedRecord.actor = input.actor;
    decidedRecord.decision = decision;
    decidedRecord.decidedAt = decidedAt;
    decidedRecord.status = "resolved";
    const audit: AuditEventInput = {
      kind: "approval.resolved",
      approvalId: record.id,
      appServerRequestId: record.appServerRequestId,
      actor: input.actor,
      metadata: {
        method: record.method,
        source: "resolve",
        action: input.decision.kind,
      },
    };
    const resolvedOutcome = {
      kind: "user" as const,
      decision: input.decision,
      actor: input.actor,
    };
    if (wire.kind === "ok") {
      this.#settleEntry(entry, { type: "resolve", value: wire.value }, audit, resolvedOutcome);
    } else {
      this.#settleEntry(entry, { type: "reject", error: wire.error }, audit, resolvedOutcome);
    }
    return { kind: "ok", appliedAt: decidedAt };
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
      // T7: route settle through #settleEntry so audit emit
      // (`approval.transport_lost`) + onPendingResolved observer fire
      // at the boundary. settleOnce body itself unchanged.
      const audit: AuditEventInput = {
        kind: "approval.transport_lost",
        approvalId: entry.record.id,
        appServerRequestId: entry.record.appServerRequestId,
      };
      const resolved: ResolvedOutcome = { kind: "system", reason: "transport_lost" };
      try {
        const value = entry.spec.defaultReject();
        this.#settleEntry(entry, { type: "resolve", value }, audit, resolved);
      } catch (err) {
        this.#settleEntry(entry, { type: "reject", error: err }, audit, resolved);
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
      // T7: route settle through #settleEntry so audit emit
      // (`approval.expired`) + onPendingResolved observer fire at the
      // boundary. settleOnce body itself unchanged. The wire response
      // goes through #handle's await of entry.completion →
      // AppServerClient's single-respond path.
      const audit: AuditEventInput = {
        kind: "approval.expired",
        approvalId: entry.record.id,
        appServerRequestId: entry.record.appServerRequestId,
      };
      const resolved: ResolvedOutcome = { kind: "system", reason: "expired" };
      try {
        const value = entry.spec.defaultReject();
        this.#settleEntry(entry, { type: "resolve", value }, audit, resolved);
      } catch (err) {
        // defaultReject for account/chatgptAuthTokens/refresh throws
        // JsonRpcResponseError(-32601). Settle as reject so the
        // AppServerClient catch arm produces the right wire envelope.
        // Other thrown values would be a dispatch-table bug — we
        // forward them through settleOnce too rather than swallowing
        // silently; the handler's eventual reject path produces
        // -32603 "handler error: ..." which makes the bug visible.
        this.#settleEntry(entry, { type: "reject", error: err }, audit, resolved);
      }
    }
    return count;
  }

  // ── T7: Phase 2 public surface ─────────────────────────────────────

  /**
   * Whether `attach()` has been called on this broker. Used by
   * Supervisor (T22) to assert the pre-attach contract at `#spawnFresh`
   * head: the broker MUST be attached before clientFactory completes.
   * Round-2 / Codex round-1 D16 + A8.
   */
  isAttached(): boolean {
    return this.#attached;
  }

  /**
   * Read-only snapshot of pending approvals (status === "pending" only).
   * Phase 2 D12. Returns a defensive copy — mutations have no effect on
   * broker state. Terminal records (resolved / expired / transport_lost)
   * are NOT included; for the broker-internal terminal lookup that
   * `resolve()` uses, see `#pendingById` (private).
   *
   * Order: insertion order over the `#pending` Map iteration (oldest
   * first by `#handle` arrival time).
   */
  listPending(): readonly PendingApprovalSnapshot[] {
    const result: PendingApprovalSnapshot[] = [];
    for (const entry of this.#pending.values()) {
      if (entry.record.status !== "pending") continue;
      result.push(this.#toSnapshot(entry.record));
    }
    return result;
  }

  /**
   * Read one pending-approval snapshot by stable approvalId
   * (`approval-${appServerRequestId}`). Returns null for unknown id OR
   * for terminal records (resolved / expired / transport_lost) — the
   * status filter matches `listPending` semantic.
   *
   * Phase 2 D12. T11 `resolve()` does NOT use this method — it uses
   * the internal `#pendingById` lookup directly so it can SEE terminal
   * records and route them to the matching ResolveError kind
   * (already_resolved / expired / transport_lost). The status-filter
   * here is for IM-rendering layers that should NEVER see terminal
   * approvals (D15).
   */
  getPending(approvalId: string): PendingApprovalSnapshot | null {
    const entry = this.#pendingById.get(approvalId);
    if (entry === undefined || entry.record.status !== "pending") return null;
    return this.#toSnapshot(entry.record);
  }

  /**
   * Subscribe to "pending approval created" lifecycle events. Fires
   * synchronously inside `#handle` after the PendingEntry has landed
   * in both `#pending` and `#pendingById` — subscribers see consistent
   * state. Returns an unsubscribe function.
   *
   * Handler exceptions are swallowed (logged-only via audit if needed);
   * broker behavior must not depend on subscriber stability.
   *
   * Phase 2 D12. Used by daemon wire-up to project the snapshot via
   * the renderer and dispatch the resulting `ApprovalCard` to the
   * channel adapter.
   */
  onPendingCreated(handler: (snap: PendingApprovalSnapshot) => void): () => void {
    this.#createdHandlers.add(handler);
    return () => {
      this.#createdHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to "pending approval resolved" lifecycle events. Fires
   * at the `#settleEntry` boundary ONLY when settleOnce wins (D21 —
   * losing late settles emit `approval.duplicate_attempt` audit but
   * do NOT fire this observer). Returns an unsubscribe function.
   *
   * The `outcome` carries the discriminator (user / handler / system).
   *
   * Handler exceptions are swallowed; broker behavior must not depend
   * on subscriber stability.
   */
  onPendingResolved(
    handler: (snap: PendingApprovalSnapshot, outcome: ResolvedOutcome) => void,
  ): () => void {
    this.#resolvedHandlers.add(handler);
    return () => {
      this.#resolvedHandlers.delete(handler);
    };
  }

  // ── T7: Private helpers (snapshot projection + observer dispatch +
  //         single-source-of-truth #settleEntry) ───────────────────────

  /**
   * Project an `ApprovalRecord` into a public `PendingApprovalSnapshot`.
   * Defensive copy: clones `Date` objects (so callers can't `setTime(0)`
   * on the broker-internal `expiresAt` and subvert D20 in-resolve
   * expiry) and `structuredClone`s `params` (so a frozen outer object
   * doesn't leak a mutable inner reference). The outer object is frozen
   * so `snap.expiresAt = ...` also fails. Codex T7-T12 review P0 fix.
   */
  #toSnapshot(record: ApprovalRecord): PendingApprovalSnapshot {
    return Object.freeze({
      id: record.id,
      appServerRequestId: record.appServerRequestId,
      method: record.method,
      params: structuredClone(record.params),
      createdAt: new Date(record.createdAt.getTime()),
      expiresAt: new Date(record.expiresAt.getTime()),
    });
  }

  #emitPendingCreated(record: ApprovalRecord): void {
    const snap = this.#toSnapshot(record);
    for (const h of this.#createdHandlers) {
      try {
        h(snap);
      } catch {
        // Subscribers must not break broker. Swallow.
      }
    }
  }

  #emitPendingResolved(record: ApprovalRecord, outcome: ResolvedOutcome): void {
    const snap = this.#toSnapshot(record);
    for (const h of this.#resolvedHandlers) {
      try {
        h(snap, outcome);
      } catch {
        // Subscribers must not break broker. Swallow.
      }
    }
  }

  /**
   * Single source of truth for routing wire-outcome settlement through
   * the broker. ALL settle call sites (handler IIFE inside `#handle`,
   * `expirePending`, `failPendingAsTransportLost`, and T11's `resolve()`)
   * route through this helper.
   *
   * Behavior (Phase 2 D21):
   *   - Calls `entry.settleOnce(outcome)` — body unchanged from Phase 1
   *     (verified by approval-broker-settle-entry.test.ts byte-identical
   *     check against `phase-1-runtime-complete`).
   *   - On WIN (settleOnce returned `true`): emits the original semantic
   *     audit kind + fires `onPendingResolved` observer.
   *   - On LOSS (settleOnce returned `false` — late settler): emits
   *     `approval.duplicate_attempt` audit (with the original kind +
   *     `outcome: "lost-race"` recorded in metadata for traceability)
   *     + does NOT fire `onPendingResolved` (only winners emit).
   *
   * The losing-settle audit visibility is the load-bearing observability
   * for B-clean races (handler completion racing expirePending,
   * resolve() racing failPendingAsTransportLost, etc.). Without it,
   * concurrent settle attempts would silently drop with no diagnostic.
   */
  #settleEntry(
    entry: PendingEntry,
    outcome: WireOutcome,
    audit: AuditEventInput,
    resolved: ResolvedOutcome,
  ): { won: boolean } {
    const won = entry.settleOnce(outcome);
    if (won) {
      this.#audit.emit(audit);
      this.#emitPendingResolved(entry.record, resolved);
    } else {
      // Late settler: record visibility for the lost race. Original
      // intent (kind: audit.kind) is preserved in metadata so audit
      // consumers can reconstruct what was attempted. exactOptional-
      // PropertyTypes: only include optional fields if defined.
      const dup: AuditEventInput = {
        kind: "approval.duplicate_attempt",
        metadata: {
          ...(audit.metadata ?? {}),
          outcome: "lost-race",
          attemptedKind: audit.kind,
        },
        ...(audit.approvalId !== undefined && { approvalId: audit.approvalId }),
        ...(audit.appServerRequestId !== undefined && {
          appServerRequestId: audit.appServerRequestId,
        }),
        ...(audit.actor !== undefined && { actor: audit.actor }),
      };
      this.#audit.emit(dup);
    }
    return { won };
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

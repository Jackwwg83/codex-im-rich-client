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
 *   T9b will add a `reattach(newClient)` API used by the supervisor to
 *   transfer pending approval state to the new broker (Codex B7
 *   dependency). T9a does NOT include reattach.
 */
export class ApprovalBroker {
  readonly #client: AppServerClient;
  readonly #table: DispatchTable;
  readonly #pending = new Map<string | number, ApprovalRecord>();
  #attached = false;

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
    this.#client.setServerRequestHandler((req) => this.#handle(req));
    this.#attached = true;
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
      return spec.defaultReject();
    }
    // The `as never` cast is load-bearing: TypeScript can't prove that
    // req.method (string) corresponds to spec.handler's parameterized P,
    // even though the dispatch-table key already proved it. The runtime
    // dispatch path narrows by key, so the cast is sound.
    return await (spec.handler as (req: JsonRpcRequest) => Promise<unknown>)(req);
  }

  // ── T9b stubs ────────────────────────────────────────────────────
  // These exist so the public surface is stable for downstream callers
  // (Supervisor T11b, future IM adapter Phase 2). T9b implements them.

  resolve(_approvalId: string, _decision: ApprovalDecision, _actor: ApprovalActor): void {
    throw new Error("ApprovalBroker.resolve: not implemented (T9b)");
  }

  failPendingAsTransportLost(): void {
    throw new Error("ApprovalBroker.failPendingAsTransportLost: not implemented (T9b)");
  }

  expirePending(): void {
    throw new Error("ApprovalBroker.expirePending: not implemented (T9b)");
  }
}

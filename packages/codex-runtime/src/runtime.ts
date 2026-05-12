// Phase 1 codex-runtime — CodexRuntime typed wrappers (T8).
//
// Wraps `client.request<R>(method, params)` for the 9 ClientRequest
// methods Phase 1 needs:
//
//   thread/start, thread/resume, thread/fork, thread/read,
//   turn/start, turn/steer, turn/interrupt, review/start
//
// (Codex outside-voice B8 fix: thread/interrupt is NOT a real method —
// only turn/interrupt is. Earlier plan drafts incorrectly listed both.)
//
// The wrappers are thin: each forwards params verbatim and returns the
// typed response. Types are imported from @codex-im/protocol's facade
// (Pre-2 expansion); method-name string literals exist ONLY in this
// file (and nowhere else in the runtime). T9b's grep guard will
// enforce that boundary across packages/{app-server-client,codex-runtime,
// daemon,cli}/src/**.
//
// Method-name compile-time check (T8 codex review fix): the literals
// live in REQUEST_METHODS, declared `as const satisfies
// Record<string, ClientRequest["method"]>`. AppServerClient.request
// accepts `string`, so without this satisfies-table a typo in any
// wrapper would compile cleanly; with it, a renamed/removed method in
// the generated ClientRequest union immediately raises TS at this file.
//
// runtime.events exposes the EventNormalizer instance directly so
// callers can consume the AsyncIterable AND access the normalizer's
// other surface (e.g. T11b's supervisor calls runtime.events.endOfStream()
// on transport.onClose).
//
// ONE-SHOT lifecycle (mirrors AppServerClient's policy):
//
//   When the underlying AppServerClient closes — for any reason —
//   this CodexRuntime is dead. Every wrapper method on a closed
//   client will reject with TransportClosedError. T11b's supervisor
//   constructs a NEW CodexRuntime on every recovery; nothing is
//   reused across the boundary.
//
//   Do NOT subscribe to client.onClose here, do NOT try to "reset"
//   the runtime, do NOT cache it in a singleton. The supervisor
//   replaces the entire { transport, client, runtime, broker }
//   quartet as a unit.

import type { AppServerClient } from "@codex-im/app-server-client";
import type {
  AppsListParams,
  AppsListResponse,
  ClientRequest,
  GetAccountRateLimitsResponse,
  ListMcpServerStatusParams,
  ListMcpServerStatusResponse,
  McpServerOauthLoginParams,
  McpServerOauthLoginResponse,
  McpServerRefreshResponse,
  ModelListParams,
  ModelListResponse,
  ModelProviderCapabilitiesReadParams,
  ModelProviderCapabilitiesReadResponse,
  PluginListParams,
  PluginListResponse,
  ReviewStartParams,
  ReviewStartResponse,
  SkillsListParams,
  SkillsListResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@codex-im/protocol";
import { EventNormalizer, type NormalizerOptions } from "./event-normalizer.js";

// Method-name table: every literal here is statically validated against
// the generated `ClientRequest["method"]` union. A typo or a method
// renamed in a future codex bump will raise TS at this declaration —
// without this, AppServerClient.request's `string` parameter would
// silently accept the typo. (T8 codex outside-voice review fix.)
const REQUEST_METHODS = {
  threadStart: "thread/start",
  threadResume: "thread/resume",
  threadFork: "thread/fork",
  threadCompactStart: "thread/compact/start",
  threadList: "thread/list",
  threadRead: "thread/read",
  threadSetName: "thread/name/set",
  threadArchive: "thread/archive",
  threadUnarchive: "thread/unarchive",
  skillsList: "skills/list",
  pluginList: "plugin/list",
  appsList: "app/list",
  turnStart: "turn/start",
  turnSteer: "turn/steer",
  turnInterrupt: "turn/interrupt",
  reviewStart: "review/start",
  modelList: "model/list",
  modelProviderCapabilitiesRead: "modelProvider/capabilities/read",
  mcpServerOauthLogin: "mcpServer/oauth/login",
  mcpServerReload: "config/mcpServer/reload",
  mcpServerStatusList: "mcpServerStatus/list",
  accountRateLimitsRead: "account/rateLimits/read",
} as const satisfies Record<string, ClientRequest["method"]>;

export type CodexRuntimeOptions = {
  /** Forwarded to the EventNormalizer constructor. */
  normalizer?: NormalizerOptions;
};

/**
 * Typed wrapper class around AppServerClient. Holds a single
 * EventNormalizer, exposes typed wrappers for the 9 Phase 1 ClientRequest
 * methods, and mirrors AppServerClient's ONE-SHOT lifecycle (see file
 * header).
 */
export class CodexRuntime {
  /**
   * The normalizer instance. Callers consume events via
   * `runtime.events.events()` (returns the cached AsyncIterableIterator).
   * T11b's supervisor calls `runtime.events.endOfStream()` on
   * transport.onClose.
   */
  readonly events: EventNormalizer;

  readonly #client: AppServerClient;

  constructor(client: AppServerClient, opts: CodexRuntimeOptions = {}) {
    this.#client = client;
    this.events = new EventNormalizer(client, opts.normalizer ?? {});
  }

  // ─── thread/* ───────────────────────────────────────────────────

  threadStart(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.#client.request<ThreadStartResponse>(REQUEST_METHODS.threadStart, params);
  }

  threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.#client.request<ThreadResumeResponse>(REQUEST_METHODS.threadResume, params);
  }

  threadFork(params: ThreadForkParams): Promise<ThreadForkResponse> {
    return this.#client.request<ThreadForkResponse>(REQUEST_METHODS.threadFork, params);
  }

  threadCompactStart(params: ThreadCompactStartParams): Promise<ThreadCompactStartResponse> {
    return this.#client.request<ThreadCompactStartResponse>(
      REQUEST_METHODS.threadCompactStart,
      params,
    );
  }

  threadList(params: ThreadListParams): Promise<ThreadListResponse> {
    return this.#client.request<ThreadListResponse>(REQUEST_METHODS.threadList, params);
  }

  threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.#client.request<ThreadReadResponse>(REQUEST_METHODS.threadRead, params);
  }

  threadSetName(params: ThreadSetNameParams): Promise<ThreadSetNameResponse> {
    return this.#client.request<ThreadSetNameResponse>(REQUEST_METHODS.threadSetName, params);
  }

  threadArchive(params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    return this.#client.request<ThreadArchiveResponse>(REQUEST_METHODS.threadArchive, params);
  }

  threadUnarchive(params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse> {
    return this.#client.request<ThreadUnarchiveResponse>(REQUEST_METHODS.threadUnarchive, params);
  }

  // ─── turn/* ─────────────────────────────────────────────────────

  turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.#client.request<TurnStartResponse>(REQUEST_METHODS.turnStart, params);
  }

  turnSteer(params: TurnSteerParams): Promise<TurnSteerResponse> {
    return this.#client.request<TurnSteerResponse>(REQUEST_METHODS.turnSteer, params);
  }

  turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return this.#client.request<TurnInterruptResponse>(REQUEST_METHODS.turnInterrupt, params);
  }

  // ─── review/* ───────────────────────────────────────────────────

  reviewStart(params: ReviewStartParams): Promise<ReviewStartResponse> {
    return this.#client.request<ReviewStartResponse>(REQUEST_METHODS.reviewStart, params);
  }

  // ─── app/native capability surfaces ─────────────────────────────────

  modelList(params: ModelListParams): Promise<ModelListResponse> {
    return this.#client.request<ModelListResponse>(REQUEST_METHODS.modelList, params);
  }

  modelProviderCapabilitiesRead(
    params: ModelProviderCapabilitiesReadParams,
  ): Promise<ModelProviderCapabilitiesReadResponse> {
    return this.#client.request<ModelProviderCapabilitiesReadResponse>(
      REQUEST_METHODS.modelProviderCapabilitiesRead,
      params,
    );
  }

  skillsList(params: SkillsListParams): Promise<SkillsListResponse> {
    return this.#client.request<SkillsListResponse>(REQUEST_METHODS.skillsList, params);
  }

  pluginList(params: PluginListParams): Promise<PluginListResponse> {
    return this.#client.request<PluginListResponse>(REQUEST_METHODS.pluginList, params);
  }

  appsList(params: AppsListParams): Promise<AppsListResponse> {
    return this.#client.request<AppsListResponse>(REQUEST_METHODS.appsList, params);
  }

  mcpServerStatusList(params: ListMcpServerStatusParams): Promise<ListMcpServerStatusResponse> {
    return this.#client.request<ListMcpServerStatusResponse>(
      REQUEST_METHODS.mcpServerStatusList,
      params,
    );
  }

  mcpServerOauthLogin(params: McpServerOauthLoginParams): Promise<McpServerOauthLoginResponse> {
    return this.#client.request<McpServerOauthLoginResponse>(
      REQUEST_METHODS.mcpServerOauthLogin,
      params,
    );
  }

  mcpServerReload(): Promise<McpServerRefreshResponse> {
    return this.#client.request<McpServerRefreshResponse>(REQUEST_METHODS.mcpServerReload);
  }

  accountRateLimitsRead(): Promise<GetAccountRateLimitsResponse> {
    return this.#client.request<GetAccountRateLimitsResponse>(
      REQUEST_METHODS.accountRateLimitsRead,
      undefined,
    );
  }
}

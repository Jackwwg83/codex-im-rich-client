// Phase 1 codex-runtime — CodexRuntime typed wrappers (T8).
//
// Wraps `client.request<R>(method, params)` for the 9 ClientRequest
// methods Phase 1 needs:
//
//   thread/start, thread/resume, thread/fork, thread/turns/list,
//   thread/read, turn/start, turn/steer, turn/interrupt, review/start
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
  ClientRequest,
  ReviewStartParams,
  ReviewStartResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
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
  threadTurnsList: "thread/turns/list",
  threadRead: "thread/read",
  turnStart: "turn/start",
  turnSteer: "turn/steer",
  turnInterrupt: "turn/interrupt",
  reviewStart: "review/start",
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

  threadTurnsList(params: ThreadTurnsListParams): Promise<ThreadTurnsListResponse> {
    return this.#client.request<ThreadTurnsListResponse>(REQUEST_METHODS.threadTurnsList, params);
  }

  threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.#client.request<ThreadReadResponse>(REQUEST_METHODS.threadRead, params);
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
}

// Phase 1 codex-runtime — CodexRuntime typed wrappers (T8).
//
// Wraps `client.request<P, R>(method, params)` for the 9 ClientRequest
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
    return this.#client.request<ThreadStartResponse>("thread/start", params);
  }

  threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.#client.request<ThreadResumeResponse>("thread/resume", params);
  }

  threadFork(params: ThreadForkParams): Promise<ThreadForkResponse> {
    return this.#client.request<ThreadForkResponse>("thread/fork", params);
  }

  threadTurnsList(params: ThreadTurnsListParams): Promise<ThreadTurnsListResponse> {
    return this.#client.request<ThreadTurnsListResponse>("thread/turns/list", params);
  }

  threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.#client.request<ThreadReadResponse>("thread/read", params);
  }

  // ─── turn/* ─────────────────────────────────────────────────────

  turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.#client.request<TurnStartResponse>("turn/start", params);
  }

  turnSteer(params: TurnSteerParams): Promise<TurnSteerResponse> {
    return this.#client.request<TurnSteerResponse>("turn/steer", params);
  }

  turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return this.#client.request<TurnInterruptResponse>("turn/interrupt", params);
  }

  // ─── review/* ───────────────────────────────────────────────────

  reviewStart(params: ReviewStartParams): Promise<ReviewStartResponse> {
    return this.#client.request<ReviewStartResponse>("review/start", params);
  }
}

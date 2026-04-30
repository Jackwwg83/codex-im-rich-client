/**
 * AppServerClient — JSON-RPC lite client for codex App Server.
 *
 * Responsibilities:
 *   - Outbound: client-initiated request (with timeout) and notify.
 *   - Inbound: response correlation by id, notification dispatch,
 *     server-initiated request handling (with default-reject for safety).
 *   - Transport lifecycle: stop() and onClose(exitCode) reject all
 *     pending requests with TransportClosedError.
 *
 * ## Lifecycle policy: ONE-SHOT
 *
 * `AppServerClient` instances are **one-shot**:
 *   - `start()` may be called exactly once, after construction.
 *   - `stop()` is terminal. It sets `closed=true` and unsubscribes from
 *     the transport. There is NO `restart()` — calling `start()` again
 *     after `stop()` is undefined behavior and is NOT supported.
 *   - `onClose(code)` from the transport (e.g. codex subprocess exited)
 *     also flips the client to `closed=true`, rejecting all pending
 *     requests with TransportClosedError.
 *
 * If you need to recover from codex crash / restart:
 *   1. Daemon supervisor observes `client.transport.onClose` (or detects
 *      pending-request rejection with TransportClosedError).
 *   2. Backoff. Spawn a fresh `StdioTransport`.
 *   3. Construct a NEW `AppServerClient(newTransport, opts)`.
 *   4. `await newClient.start()`.
 *   5. Re-run `performInitializeHandshake(newClient, ...)`.
 *   6. Re-attach notification + server-request handlers.
 *   7. Replace the runtime's reference to point at `newClient`.
 *
 * Rationale: a stateful client that tries to "restart in place" hides
 * subtle bugs (stale pending Map, dangling timers, half-applied
 * subscriptions). Constructing a fresh instance forces the supervisor
 * to think about Phase 1 state recovery (re-resolving thread bindings,
 * re-issuing pending operator commands, etc.) explicitly. Closes
 * Codex final review Group 3 #4.
 *
 * Phase 0 design notes:
 *   - We do NOT bake initialize handshake in; that lives in
 *     `performInitializeHandshake` (Section H Task 7.1) so smoke +
 *     CodexRuntime.initialize (Phase 1) share one path.
 *   - We do NOT interpret method names; client treats every server
 *     request as opaque. Phase 1 ApprovalBroker / EventNormalizer
 *     dispatches on method names from the generated schema.
 *   - Default-reject for server requests: if no handler is registered,
 *     reject with -32601 "no handler". This prevents codex turns from
 *     hanging on unanswered approvals (Codex outside-voice finding #5).
 */

import pino, { type Logger } from "pino";
import { JsonRpcResponseError, RequestTimeoutError, TransportClosedError } from "./errors.js";
import {
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcResponse,
  isJsonRpcServerRequest,
} from "./jsonrpc.js";
import type { Transport, Unsubscribe } from "./transport.js";

export interface AppServerClientOptions {
  logger?: Logger;
  /** Default timeout for client-initiated requests (ms). Default 30s. */
  defaultTimeoutMs?: number;
  /** Timeout for server-initiated request handlers (ms). Default 30s. */
  serverRequestHandlerTimeoutMs?: number;
}

export interface RequestOptions {
  /** Override the default timeout for this single request. */
  timeoutMs?: number;
}

export type ServerRequestHandler = (req: JsonRpcRequest) => unknown | Promise<unknown>;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private readonly notificationHandlers = new Set<(n: JsonRpcNotification) => void>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private readonly subs: Unsubscribe[] = [];
  private closed = false;
  private readonly log: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly serverRequestHandlerTimeoutMs: number;

  constructor(
    private readonly transport: Transport,
    opts: AppServerClientOptions = {},
  ) {
    this.log = opts.logger ?? pino({ name: "AppServerClient", level: "warn" });
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.serverRequestHandlerTimeoutMs = opts.serverRequestHandlerTimeoutMs ?? 30_000;
  }

  async start(): Promise<void> {
    await this.transport.start();
    this.subs.push(this.transport.onMessage((m) => this.handleMessage(m)));
    this.subs.push(this.transport.onClose((code) => this.handleClose(code)));
    // Codex final review #2: surface transport errors. Without this, parse
    // errors / spawn errors / IO errors only surfaced as request timeouts.
    this.subs.push(
      this.transport.onError((err) => {
        this.log.warn({ err: err.message }, "AppServerClient: transport error");
      }),
    );
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.subs) u();
    this.subs.length = 0;
    this.rejectAllPending(new TransportClosedError(null));
    await this.transport.stop();
  }

  request<R = unknown>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<R> {
    if (this.closed) {
      return Promise.reject(new TransportClosedError(null));
    }
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const promise = new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
        timer,
      });
      // Codex final review #1: send() may throw synchronously
      // (StdioTransport.send throws TransportClosedError if stopped between
      // closed-check and write). Without this catch, the pending entry +
      // timer leak until timeoutMs.
      try {
        this.transport.send({ id, method, params });
      } catch (err) {
        const entry = this.pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
        }
        reject(err);
      }
    });
    return promise;
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.transport.send({ method, params });
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (this.closed) return;
    this.transport.send({ id, result });
  }

  reject(id: JsonRpcId, error: { code: number; message: string; data?: unknown }): void {
    if (this.closed) return;
    this.transport.send({ id, error });
  }

  onNotification(h: (n: JsonRpcNotification) => void): Unsubscribe {
    this.notificationHandlers.add(h);
    return () => {
      this.notificationHandlers.delete(h);
    };
  }

  setServerRequestHandler(h: ServerRequestHandler | null): void {
    this.serverRequestHandler = h;
  }

  private handleMessage(m: unknown): void {
    if (isJsonRpcResponse(m)) {
      this.completePending(m);
      return;
    }
    if (isJsonRpcServerRequest(m)) {
      void this.dispatchServerRequest(m);
      return;
    }
    if (isJsonRpcNotification(m)) {
      this.dispatchNotification(m);
      return;
    }
    this.log.warn({ payload: m }, "AppServerClient: unknown message shape");
  }

  private completePending(m: unknown): void {
    if (!isJsonRpcResponse(m)) return;
    const id = m.id;
    if (id === null) {
      // Spec allows id=null on parse errors. Nothing to correlate against.
      this.log.warn({ payload: m }, "AppServerClient: response with id=null (parse error)");
      return;
    }
    const entry = this.pending.get(id);
    if (!entry) {
      this.log.warn({ id }, "AppServerClient: orphan response (no pending request)");
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (isJsonRpcErrorResponse(m)) {
      entry.reject(new JsonRpcResponseError(m.error));
    } else {
      entry.resolve((m as { result: unknown }).result);
    }
  }

  private async dispatchServerRequest(m: JsonRpcRequest): Promise<void> {
    const h = this.serverRequestHandler;
    if (!h) {
      this.reject(m.id, {
        code: -32601,
        message: `no handler registered for ${m.method}`,
      });
      this.log.warn(
        { method: m.method, id: m.id },
        "AppServerClient: default-rejected server request (no handler)",
      );
      return;
    }
    // Codex final review #3: clearable timeout. Without explicit clearance,
    // the timer's setTimeout closure stays scheduled even when the handler
    // resolves quickly, retaining a reference to the handler / params for
    // up to serverRequestHandlerTimeoutMs after success.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(h(m)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `server-request handler timeout (${this.serverRequestHandlerTimeoutMs}ms)`,
                ),
              ),
            this.serverRequestHandlerTimeoutMs,
          );
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      this.respond(m.id, result);
    } catch (err) {
      if (timer !== undefined) clearTimeout(timer);
      // T9a addition: handlers MAY throw a `JsonRpcResponseError` to
      // signal a specific JSON-RPC error code/message/data combo (e.g.
      // ApprovalBroker uses this to emit -32601 for an unknown method
      // not in its DispatchTable). Other thrown values still collapse to
      // -32603 with the legacy "handler error: ..." prefix.
      if (err instanceof JsonRpcResponseError) {
        this.reject(m.id, { code: err.code, message: err.rawMessage, data: err.data });
        this.log.warn(
          { method: m.method, id: m.id, code: err.code, error: err.rawMessage },
          "AppServerClient: server-request handler signaled JSON-RPC error",
        );
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.reject(m.id, { code: -32603, message: `handler error: ${message}` });
      this.log.warn(
        { method: m.method, id: m.id, error: message },
        "AppServerClient: default-rejected server request (handler error/timeout)",
      );
    }
  }

  private dispatchNotification(m: JsonRpcNotification): void {
    for (const h of this.notificationHandlers) {
      try {
        h(m);
      } catch (err) {
        this.log.warn({ err }, "AppServerClient: notification handler threw");
      }
    }
  }

  private handleClose(code: number | null): void {
    this.closed = true;
    this.rejectAllPending(new TransportClosedError(code));
  }

  private rejectAllPending(err: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }
}

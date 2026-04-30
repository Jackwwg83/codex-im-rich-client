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
    });
    this.transport.send({ id, method, params });
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
    try {
      const result = await Promise.race([
        Promise.resolve(h(m)),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `server-request handler timeout (${this.serverRequestHandlerTimeoutMs}ms)`,
                ),
              ),
            this.serverRequestHandlerTimeoutMs,
          ),
        ),
      ]);
      this.respond(m.id, result);
    } catch (err) {
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

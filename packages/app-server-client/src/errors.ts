/**
 * Typed error hierarchy for AppServerClient + Transport layer.
 *
 * Each is `instanceof Error`. Use `instanceof <subclass>` for narrowing.
 * Designed so downstream callers can distinguish:
 *   - protocol-level error from codex (JsonRpcResponseError)
 *   - transport closed under us (TransportClosedError, exit code optional)
 *   - malformed wire (TransportProtocolError, optional offending line)
 *   - request timeout (RequestTimeoutError, with method + timeoutMs)
 */

import type { JsonRpcError } from "./jsonrpc.js";

export class JsonRpcResponseError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(err: JsonRpcError) {
    super(`[${err.code}] ${err.message}`);
    this.name = "JsonRpcResponseError";
    this.code = err.code;
    this.data = err.data;
  }
}

export class TransportClosedError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null) {
    super(`transport closed (exit=${exitCode ?? "null"})`);
    this.name = "TransportClosedError";
    this.exitCode = exitCode;
  }
}

export class TransportProtocolError extends Error {
  readonly line: string | undefined;

  constructor(message: string, line?: string) {
    super(message);
    this.name = "TransportProtocolError";
    this.line = line;
  }
}

export class RequestTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`request "${method}" timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

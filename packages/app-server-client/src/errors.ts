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
  /**
   * Wire-level `error.message` from codex, without the `[code] ` prefix that
   * `super()` adds to `Error.message` for human-readable logs. Use this for
   * keyword classification (categorizeJsonRpcError) — `Error.message` would
   * otherwise contain `[-32600] ` and force fragile prefix-stripping. Added
   * Phase 1 T1 (purely additive; predates uses outside this module).
   */
  readonly rawMessage: string;

  constructor(err: JsonRpcError) {
    super(`[${err.code}] ${err.message}`);
    this.name = "JsonRpcResponseError";
    this.code = err.code;
    this.data = err.data;
    this.rawMessage = err.message;
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

/**
 * Discriminated category for `JsonRpcResponseError` instances surfaced by
 * codex 0.125. Used by Phase 1 callers (CodexRuntime / ApprovalBroker) to
 * distinguish the four shapes that codex collapses into `code: -32600`.
 *
 * Keyword set is empirical — see 05-CODEX-APP-SERVER-PROTOCOL.md §1.1 and
 * docs/phase-0/host-environment.md "Wire spike results" cases 3+4.
 *
 * Note: malformed JSON wire frames never reach here — they are stderr-only
 * via StdioTransport.logger.warn (case 5), not a JsonRpcResponseError.
 */
export type ErrorCategory =
  | { category: "method-not-found"; code: number; message: string }
  | { category: "invalid-params"; code: number; message: string }
  | { category: "invalid-request"; code: number; message: string }
  | { category: "internal-error"; code: number; message: string }
  | { category: "unknown"; code: number; message: string };

export function categorizeJsonRpcError(err: JsonRpcResponseError): ErrorCategory {
  const code = err.code;
  // Defensive: `err.rawMessage` is typed as string, but a callsite that
  // hand-builds the error could violate that. Coerce so `.includes` never
  // throws on a non-string.
  const message =
    typeof err.rawMessage === "string" ? err.rawMessage : String(err.rawMessage ?? "");

  if (code === -32600) {
    if (message.includes("unknown variant")) {
      return { category: "method-not-found", code, message };
    }
    if (
      message.includes("missing field") ||
      message.includes("invalid type") ||
      message.includes("unknown field")
    ) {
      return { category: "invalid-params", code, message };
    }
    return { category: "invalid-request", code, message };
  }
  if (code === -32603) {
    return { category: "internal-error", code, message };
  }
  return { category: "unknown", code, message };
}

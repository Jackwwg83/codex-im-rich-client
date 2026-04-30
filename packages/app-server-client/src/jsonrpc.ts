/**
 * JSON-RPC lite envelope types + runtime type guards.
 *
 * The codex App Server uses a JSON-RPC variant that omits the `jsonrpc: "2.0"`
 * field on the wire (confirmed by Phase 0 wire spike — see
 * docs/phase-0/host-environment.md case 1). Our types reflect that: no
 * `jsonrpc` field anywhere.
 *
 * Wire facts from codex 0.125.0:
 *   - id type: server echoes whatever client sent. Both number and string round-trip.
 *     Outgoing client requests use monotonic number; incoming server requests must
 *     accept either form.
 *   - error.data: NOT present on 0.125.0. Defensively typed as optional `?` for
 *     forward-compat.
 *   - error.code -32600 is overloaded for both unknown-method AND invalid-params.
 *     Phase 1 will add a `categorizeJsonRpcError` helper that string-matches
 *     error.message keywords (`unknown variant` vs `missing field` / `invalid type`).
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest<P = unknown> {
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  method: string;
  params?: P;
}

export interface JsonRpcSuccessResponse<R = unknown> {
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  /** Per JSON-RPC spec, id MAY be null when the request id was unparseable. */
  id: JsonRpcId | null;
  error: JsonRpcError;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccessResponse<R> | JsonRpcErrorResponse;

function isObj(m: unknown): m is Record<string, unknown> {
  return typeof m === "object" && m !== null && !Array.isArray(m);
}

function isValidId(v: unknown): v is JsonRpcId {
  return typeof v === "number" || typeof v === "string";
}

function isValidError(v: unknown): v is JsonRpcError {
  if (!isObj(v)) return false;
  return typeof v.code === "number" && typeof v.message === "string";
}

/**
 * True iff `m` is a response envelope: has `id` (number, string, or null
 * only when `error` present), has a well-formed `result` OR `error`, and
 * has no `method`.
 *
 * Codex final review #4: previously this was loose enough that
 * `{id:1, error:undefined}` passed and reached `new JsonRpcResponseError(undefined)`,
 * which would throw inside the message handler. Now we validate the
 * shape strictly.
 */
export function isJsonRpcResponse(m: unknown): m is JsonRpcResponse {
  if (!isObj(m)) return false;
  if (!("id" in m)) return false;
  if ("method" in m) return false;
  const hasResult = "result" in m && m.result !== undefined;
  const hasError = "error" in m && isValidError(m.error);
  if (!hasResult && !hasError) return false;
  // Success response: id must be number or string (NOT null).
  // Error response: id may be null per spec (parse-error case).
  if (hasResult) return isValidId(m.id);
  return m.id === null || isValidId(m.id);
}

/** True iff `m` is a JSON-RPC error response with a well-formed `error` field. */
export function isJsonRpcErrorResponse(m: unknown): m is JsonRpcErrorResponse {
  if (!isObj(m)) return false;
  if (!("id" in m) || "method" in m) return false;
  if (!("error" in m) || !isValidError(m.error)) return false;
  return m.id === null || isValidId(m.id);
}

/**
 * True iff `m` is a server-initiated request (has both `id` and `method`,
 * but no `result` or `error`). These come from codex during a turn —
 * approval requests, tool calls, elicitation, etc.
 */
export function isJsonRpcServerRequest(m: unknown): m is JsonRpcRequest {
  if (!isObj(m)) return false;
  if (!isValidId(m.id) || typeof m.method !== "string") return false;
  if ("result" in m || "error" in m) return false;
  return true;
}

/** True iff `m` is a notification (has `method`, no `id`). */
export function isJsonRpcNotification(m: unknown): m is JsonRpcNotification {
  if (!isObj(m)) return false;
  if ("id" in m) return false;
  return typeof m.method === "string";
}

// @codex-im/app-server-client — public surface.
// Filled in incrementally as Section D / G / H tasks land. Each new
// `export` here is a deliberate code-review checkpoint — internals stay
// internal unless a downstream package needs them.

export type { Transport, Unsubscribe } from "./transport.js";
export type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from "./jsonrpc.js";
export {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcResponse,
  isJsonRpcServerRequest,
} from "./jsonrpc.js";
export { JsonlDecoder, encodeJsonl } from "./jsonl.js";
export {
  JsonRpcResponseError,
  RequestTimeoutError,
  TransportClosedError,
  TransportProtocolError,
} from "./errors.js";
// AppServerClient + StdioTransport + performInitializeHandshake exported
// in their respective tasks (5.1, 6.1, 7.1).

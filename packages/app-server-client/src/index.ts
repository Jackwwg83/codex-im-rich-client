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
export { AppServerClient } from "./client.js";
export type {
  AppServerClientOptions,
  RequestOptions,
  ServerRequestHandler,
} from "./client.js";
export { StdioTransport } from "./stdio-transport.js";
export type { StdioTransportOptions } from "./stdio-transport.js";
export { performInitializeHandshake } from "./handshake.js";
export type { HandshakeOptions } from "./handshake.js";

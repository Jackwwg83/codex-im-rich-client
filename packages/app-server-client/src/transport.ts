/**
 * Transport interface — the seam between `AppServerClient` and the wire.
 *
 *                       AppServerClient
 *                             │ Transport
 *                  ┌──────────┴──────────┐
 *           InMemoryTransport       StdioTransport
 *           (in @codex-im/testkit)   (this package, src/stdio-transport.ts)
 *                  │                       │
 *           FakeAppServer            real `codex app-server`
 *           (testkit)                (--listen stdio:// subprocess)
 *
 * Implementations:
 *   - StdioTransport (this package)         — production: spawn codex subprocess.
 *   - InMemoryTransport (@codex-im/testkit) — tests: paired in-process pipes.
 *
 * Both implementations forward parsed JSON values (objects), not raw bytes.
 * JSONL framing is the implementation's responsibility.
 */

export type Unsubscribe = () => void;

export interface Transport {
  /** Start I/O. For StdioTransport, spawns the child. For InMemoryTransport, marks pair active. */
  start(): Promise<void>;

  /**
   * Stop I/O cleanly. For StdioTransport: closes stdin, waits up to a grace period,
   * then SIGKILL. For InMemoryTransport: marks pair inactive and emits onClose(null).
   */
  stop(): Promise<void>;

  /**
   * Send a single JSON value. The implementation handles JSONL framing
   * (newline-terminate, encode UTF-8, etc.). May throw `TransportClosedError`
   * if called after stop().
   */
  send(message: unknown): void;

  /**
   * Subscribe to inbound messages (parsed JSON objects). Returns an unsubscribe
   * function. Multiple subscribers are supported; each receives every message.
   */
  onMessage(handler: (msg: unknown) => void): Unsubscribe;

  /**
   * Subscribe to transport-level errors that don't kill the connection
   * (e.g. malformed line, intermittent IO error). Connection-fatal errors
   * are reported via onClose with the relevant exit code.
   */
  onError(handler: (err: Error) => void): Unsubscribe;

  /**
   * Subscribe to transport close. `exitCode` is the child process exit code
   * for StdioTransport, or null for InMemoryTransport / non-process transports.
   */
  onClose(handler: (exitCode: number | null) => void): Unsubscribe;
}

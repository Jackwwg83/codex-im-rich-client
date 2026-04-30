/**
 * FakeAppServer — programmable in-process fake of `codex app-server`.
 *
 * Used by AppServerClient unit tests, Phase 1 ApprovalBroker tests,
 * and any downstream package that needs to exercise codex's wire shape
 * without spawning a real subprocess.
 *
 * Features:
 *   - respondTo(method, handler) for client requests
 *   - emitNotification(method, params) for server -> client notifications
 *   - emitServerRequest(method, params, id?) for server-initiated requests
 *     (returns a Promise that resolves with the client's response — used in
 *     ApprovalBroker round-trip tests)
 *   - replayFixture(version, name) for codex 0.125.0 wire fixtures
 *     (Codex outside-voice finding #9 — drift detection)
 *
 * Default initialize handler returns a minimal `InitializeResponse` shape
 * matching the real codex 0.125.0 surface:
 *   { userAgent, codexHome, platformFamily, platformOs }
 */

import type { Transport } from "@codex-im/app-server-client";
import { loadFixture } from "./fixture-replay.js";
import { createInMemoryTransportPair } from "./in-memory-transport.js";

export type FakeRequestHandler = (
  params: unknown,
  id: number | string,
) => unknown | Promise<unknown>;

interface IncomingClientRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

function isClientRequest(m: unknown): m is IncomingClientRequest {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  return (
    "id" in obj &&
    "method" in obj &&
    typeof obj.method === "string" &&
    !("result" in obj) &&
    !("error" in obj)
  );
}

export class FakeAppServer {
  /** Transport for the AppServerClient under test to attach to. */
  readonly clientSide: Transport;

  private readonly serverSide: Transport;
  private readonly handlers = new Map<string, FakeRequestHandler>();

  constructor() {
    const [a, b] = createInMemoryTransportPair();
    this.clientSide = a;
    this.serverSide = b;
    this.serverSide.onMessage((m) => this.dispatch(m));
    void this.serverSide.start();

    // Default initialize handler matches codex 0.125.0 wire spike shape.
    this.respondTo("initialize", () => ({
      userAgent: "fake-app-server/0.0.0 (Mac OS fake; arm64)",
      codexHome: "/fake/.codex",
      platformFamily: "unix",
      platformOs: "macos",
    }));
  }

  /** Register a handler for a client-initiated method. Overrides the default. */
  respondTo(method: string, h: FakeRequestHandler): void {
    this.handlers.set(method, h);
  }

  /** Emit a server -> client notification. */
  emitNotification(method: string, params?: unknown): void {
    this.serverSide.send({ method, params });
  }

  /**
   * Emit a server-initiated request and wait for the client's response.
   * Returns a Promise that resolves to the client's `result` or rejects with
   * the client's `error`.
   */
  async emitServerRequest(
    method: string,
    params?: unknown,
    id: number | string = Math.floor(Math.random() * 1e9),
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const unsub = this.serverSide.onMessage((m) => {
        if (m && typeof m === "object" && "id" in m && (m as { id: unknown }).id === id) {
          unsub();
          const env = m as { result?: unknown; error?: unknown };
          if ("error" in env) reject(env.error);
          else resolve(env.result);
        }
      });
      this.serverSide.send({ id, method, params });
    });
  }

  /**
   * Replay a captured wire fixture (one JSON object per line) by emitting
   * each frame in order. Used for contract tests against codex-X.Y.Z fixtures.
   */
  async replayFixture(version: string, name: string, intervalMs = 0): Promise<void> {
    const messages = loadFixture(version, name);
    for (const m of messages) {
      this.serverSide.send(m);
      if (intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  /** Stop the fake — closes both sides of the transport pair. */
  async stop(): Promise<void> {
    await this.serverSide.stop();
  }

  private async dispatch(m: unknown): Promise<void> {
    if (!isClientRequest(m)) return;
    const handler = this.handlers.get(m.method);
    if (!handler) {
      this.serverSide.send({
        id: m.id,
        error: { code: -32601, message: `unknown method ${m.method}` },
      });
      return;
    }
    try {
      const result = await handler(m.params, m.id);
      this.serverSide.send({ id: m.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.serverSide.send({
        id: m.id,
        error: { code: -32603, message },
      });
    }
  }
}

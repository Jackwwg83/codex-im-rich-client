/**
 * InMemoryTransport — paired in-process Transport for tests.
 *
 * Two `Side` instances are linked; calling `send` on one queues
 * `onMessage` delivery on the other via `queueMicrotask` (so calling
 * code never re-enters synchronously). `stop()` propagates to the
 * peer so both ends emit `onClose(null)` exactly once.
 *
 * Used by:
 *   - AppServerClient unit tests (Section F)
 *   - FakeAppServer (Section I) attaches one side to the fake, exposes
 *     the other side to the client under test
 */

import { EventEmitter } from "node:events";
import type { Transport, Unsubscribe } from "@codex-im/app-server-client";

class Side extends EventEmitter implements Transport {
  private peer: Side | undefined;
  private running = false;

  link(peer: Side): void {
    this.peer = peer;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.emit("close", null);
    if (this.peer?.running) {
      await this.peer.stop();
    }
  }

  send(msg: unknown): void {
    if (!this.running || !this.peer?.running) return;
    const peer = this.peer;
    queueMicrotask(() => peer.emit("message", msg));
  }

  onMessage(h: (m: unknown) => void): Unsubscribe {
    this.on("message", h);
    return () => {
      this.off("message", h);
    };
  }

  onError(h: (e: Error) => void): Unsubscribe {
    this.on("error", h);
    return () => {
      this.off("error", h);
    };
  }

  onClose(h: (c: number | null) => void): Unsubscribe {
    this.on("close", h);
    return () => {
      this.off("close", h);
    };
  }
}

/**
 * Create a paired transport. The two returned `Transport` instances
 * are linked: messages sent on one arrive on the other after a microtask.
 */
export function createInMemoryTransportPair(): [Transport, Transport] {
  const a = new Side();
  const b = new Side();
  a.link(b);
  b.link(a);
  return [a, b];
}

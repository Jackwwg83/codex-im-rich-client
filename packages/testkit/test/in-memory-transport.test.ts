import { describe, expect, it, vi } from "vitest";
import { createInMemoryTransportPair } from "../src/in-memory-transport.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe("InMemoryTransport", () => {
  it("delivers messages bidirectionally", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start();
    await b.start();
    const onB = vi.fn();
    b.onMessage(onB);
    const onA = vi.fn();
    a.onMessage(onA);
    a.send({ x: 1 });
    b.send({ y: 2 });
    await flush();
    expect(onB).toHaveBeenCalledWith({ x: 1 });
    expect(onA).toHaveBeenCalledWith({ y: 2 });
  });

  it("preserves order under burst send", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start();
    await b.start();
    const recv: unknown[] = [];
    b.onMessage((m) => recv.push(m));
    for (let i = 0; i < 10; i++) a.send({ i });
    await flush();
    expect(recv).toEqual(Array.from({ length: 10 }, (_, i) => ({ i })));
  });

  it("calls onClose with null when stopped", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start();
    await b.start();
    const onCloseB = vi.fn();
    b.onClose(onCloseB);
    await a.stop();
    expect(onCloseB).toHaveBeenCalledWith(null);
  });

  it("send after stop is a no-op (does not throw, does not deliver)", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start();
    await b.start();
    const onB = vi.fn();
    b.onMessage(onB);
    await a.stop();
    expect(() => a.send({ x: 1 })).not.toThrow();
    await flush();
    expect(onB).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further deliveries", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start();
    await b.start();
    const handler = vi.fn();
    const unsub = b.onMessage(handler);
    a.send({ first: true });
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    a.send({ second: true });
    await flush();
    expect(handler).toHaveBeenCalledTimes(1); // still 1
  });
});

import { createInMemoryTransportPair } from "@codex-im/testkit";
import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/client.js";
import { JsonRpcResponseError } from "../src/errors.js";
import type { JsonRpcId, JsonRpcRequest } from "../src/jsonrpc.js";
import type { Transport } from "../src/transport.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

/**
 * Minimal echo server that responds to every client request by echoing
 * back its method name. Useful for correlation tests.
 */
function attachEchoServer(server: Transport) {
  server.onMessage((m: unknown) => {
    if (
      m &&
      typeof m === "object" &&
      "id" in m &&
      "method" in m &&
      typeof (m as { method: unknown }).method === "string"
    ) {
      const req = m as { id: JsonRpcId; method: string };
      server.send({ id: req.id, result: { echoed: req.method } });
    }
  });
}

describe("AppServerClient.request — correlation", () => {
  it("correlates a single response by id", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    attachEchoServer(serverT);
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const result = await client.request<{ echoed: string }>("ping");
    expect(result).toEqual({ echoed: "ping" });

    await client.stop();
  });

  it("rejects request when error response received", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    serverT.onMessage((m: unknown) => {
      const req = m as { id: JsonRpcId };
      serverT.send({
        id: req.id,
        error: { code: -32600, message: "Invalid request: unknown variant" },
      });
    });
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    await expect(client.request("does/not/exist")).rejects.toBeInstanceOf(JsonRpcResponseError);

    await client.stop();
  });

  it("handles 5 concurrent requests with reverse-order responses", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const incoming: { id: JsonRpcId; method: string }[] = [];
    serverT.onMessage((m: unknown) => {
      const req = m as { id: JsonRpcId; method: string };
      incoming.push(req);
    });
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const promises = [
      client.request<{ n: number }>("a"),
      client.request<{ n: number }>("b"),
      client.request<{ n: number }>("c"),
      client.request<{ n: number }>("d"),
      client.request<{ n: number }>("e"),
    ];
    await flush();
    expect(incoming).toHaveLength(5);
    // Respond in reverse order.
    for (let i = incoming.length - 1; i >= 0; i--) {
      const req = incoming[i];
      if (!req) continue;
      serverT.send({ id: req.id, result: { n: i } });
    }
    const results = await Promise.all(promises);
    expect(results).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);

    await client.stop();
  });
});

describe("AppServerClient.onNotification", () => {
  it("dispatches notifications to all subscribed handlers", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const h1 = vi.fn();
    const h2 = vi.fn();
    client.onNotification(h1);
    client.onNotification(h2);

    serverT.send({ method: "turn/started", params: { threadId: "t1" } });
    await flush();

    expect(h1).toHaveBeenCalledWith({
      method: "turn/started",
      params: { threadId: "t1" },
    });
    expect(h2).toHaveBeenCalledWith({
      method: "turn/started",
      params: { threadId: "t1" },
    });

    await client.stop();
  });

  it("unsubscribed handler stops receiving notifications", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const h = vi.fn();
    const unsub = client.onNotification(h);
    serverT.send({ method: "turn/started" });
    await flush();
    expect(h).toHaveBeenCalledTimes(1);

    unsub();
    serverT.send({ method: "turn/started" });
    await flush();
    expect(h).toHaveBeenCalledTimes(1);

    await client.stop();
  });
});

describe("AppServerClient.setServerRequestHandler — happy path", () => {
  it("dispatches server-initiated request to handler and forwards response", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    client.setServerRequestHandler(() => ({ decision: "allow_once" }));
    await client.start();

    serverT.send({ id: 42, method: "approval/request", params: { what: "test" } });
    await flush();
    // also let handler resolution happen
    await new Promise((r) => setTimeout(r, 5));

    expect(responses).toContainEqual({ id: 42, result: { decision: "allow_once" } });

    await client.stop();
  });

  it("handler can be async and receives the full request envelope", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    let receivedReq: JsonRpcRequest | null = null;
    client.setServerRequestHandler(async (req) => {
      receivedReq = req;
      await new Promise((r) => setTimeout(r, 1));
      return { ok: true };
    });
    await client.start();

    serverT.send({ id: 7, method: "approval/x", params: { y: 1 } });
    await new Promise((r) => setTimeout(r, 10));

    expect(receivedReq).toEqual({
      id: 7,
      method: "approval/x",
      params: { y: 1 },
    });
    expect(responses).toContainEqual({ id: 7, result: { ok: true } });

    await client.stop();
  });
});

describe("AppServerClient — unknown / malformed message tolerance", () => {
  it("does not throw on bare empty object, weird shapes, or orphan responses", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    // None of these should throw or unhandle-reject anything.
    serverT.send({});
    serverT.send({ foo: "bar" });
    serverT.send({ id: 999, result: {} }); // orphan: no pending id 999
    serverT.send([1, 2, 3] as unknown);
    await flush();

    // Process should still be alive — verify by completing a real request.
    serverT.onMessage((m: unknown) => {
      const req = m as { id: JsonRpcId };
      if ("method" in (m as object)) {
        serverT.send({ id: req.id, result: { ok: true } });
      }
    });
    const r = await client.request<{ ok: true }>("real/ping");
    expect(r).toEqual({ ok: true });

    await client.stop();
  });
});

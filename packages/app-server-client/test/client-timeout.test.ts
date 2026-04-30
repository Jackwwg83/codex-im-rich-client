import { createInMemoryTransportPair } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/client.js";
import { RequestTimeoutError } from "../src/errors.js";

describe("AppServerClient.request — timeout (Test Issue 1, Codex #5 partial)", () => {
  it("rejects with RequestTimeoutError when no response arrives in time", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    // Server intentionally never responds.

    const client = new AppServerClient(clientT, { defaultTimeoutMs: 50 });
    await client.start();

    await expect(client.request("forever")).rejects.toBeInstanceOf(RequestTimeoutError);

    await client.stop();
  });

  it("respects per-call timeoutMs override", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();

    const client = new AppServerClient(clientT, { defaultTimeoutMs: 60_000 });
    await client.start();

    // Override default 60s with 50ms for this single call.
    await expect(client.request("forever", undefined, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );

    await client.stop();
  });

  it("does not affect concurrent requests with their own timeouts", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    serverT.onMessage((m: unknown) => {
      const req = m as { id: number; method: string };
      if (req.method === "fast") {
        // fast resolves quickly
        setTimeout(() => serverT.send({ id: req.id, result: { ok: true } }), 5);
      }
      // "slow" — never respond
    });
    await serverT.start();

    const client = new AppServerClient(clientT, { defaultTimeoutMs: 200 });
    await client.start();

    const fast = client.request<{ ok: true }>("fast");
    const slow = client.request("slow", undefined, { timeoutMs: 50 });

    await expect(fast).resolves.toEqual({ ok: true });
    await expect(slow).rejects.toBeInstanceOf(RequestTimeoutError);

    await client.stop();
  });

  it("RequestTimeoutError carries method + timeoutMs for diagnostic", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT, { defaultTimeoutMs: 50 });
    await client.start();

    try {
      await client.request("turn/start");
      throw new Error("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(RequestTimeoutError);
      const e = err as RequestTimeoutError;
      expect(e.method).toBe("turn/start");
      expect(e.timeoutMs).toBe(50);
    }

    await client.stop();
  });
});

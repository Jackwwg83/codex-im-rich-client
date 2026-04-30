import { createInMemoryTransportPair } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/client.js";
import { TransportClosedError } from "../src/errors.js";

/**
 * Test Issue 2 / Architecture Issue 3: when the transport closes (codex
 * subprocess crashes, manual stop, etc.), every pending request must
 * reject with TransportClosedError. Otherwise the calling code hangs
 * forever waiting on a Promise that will never resolve.
 */
describe("AppServerClient — transport close rejects all pending", () => {
  it("rejects all 3 pending requests when peer transport stops", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    // Server never responds — we want the requests to be pending when transport closes.
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const p1 = client.request("a");
    const p2 = client.request("b");
    const p3 = client.request("c");

    // Stop the server side, which closes the peer (client) transport too.
    await serverT.stop();

    await expect(p1).rejects.toBeInstanceOf(TransportClosedError);
    await expect(p2).rejects.toBeInstanceOf(TransportClosedError);
    await expect(p3).rejects.toBeInstanceOf(TransportClosedError);

    // No need to call client.stop — already closed. But it should be safe.
    await client.stop();
  });

  it("rejects new request initiated after stop()", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();
    await client.stop();

    await expect(client.request("anything")).rejects.toBeInstanceOf(TransportClosedError);
  });

  it("calling stop() with pending requests rejects them", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    const p = client.request("never-responds");
    await client.stop();

    await expect(p).rejects.toBeInstanceOf(TransportClosedError);
  });
});

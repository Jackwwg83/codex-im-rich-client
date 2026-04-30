import { createInMemoryTransportPair } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/client.js";
import { performInitializeHandshake } from "../src/handshake.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe("performInitializeHandshake", () => {
  it("sends initialize, returns typed InitializeResponse, then notifies 'initialized'", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const seen: { method?: string; id?: number; params?: unknown }[] = [];
    serverT.onMessage((m) => {
      const env = m as { method?: string; id?: number; params?: unknown };
      seen.push(env);
      if (env.method === "initialize" && typeof env.id === "number") {
        serverT.send({
          id: env.id,
          result: {
            userAgent: "test-spike/0.0.0 (Mac OS 26.1.0; arm64)",
            codexHome: "/Users/x/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        });
      }
    });
    await serverT.start();

    const client = new AppServerClient(clientT);
    await client.start();

    const result = await performInitializeHandshake(client, {
      name: "test-spike",
      title: null,
      version: "0.0.0",
    });

    // Returned typed response.
    expect(result.codexHome).toBe("/Users/x/.codex");
    expect(result.userAgent).toContain("test-spike/0.0.0");
    expect(result.platformFamily).toBe("unix");
    expect(result.platformOs).toBe("macos");

    // 'initialized' notification was sent (no id, no result).
    await flush();
    const initNotify = seen.find((m) => m.method === "initialized" && m.id === undefined);
    expect(initNotify).toBeDefined();

    await client.stop();
  });

  it("propagates server error (e.g. invalid clientInfo)", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    serverT.onMessage((m) => {
      const env = m as { id?: number; method?: string };
      if (env.method === "initialize" && typeof env.id === "number") {
        serverT.send({
          id: env.id,
          error: { code: -32600, message: "Invalid request: missing field `name`" },
        });
      }
    });
    await serverT.start();

    const client = new AppServerClient(clientT);
    await client.start();

    await expect(
      performInitializeHandshake(client, {
        name: "",
        title: null,
        version: "0.0.0",
      }),
    ).rejects.toThrow(/-32600/);

    await client.stop();
  });
});

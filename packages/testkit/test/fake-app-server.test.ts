import { AppServerClient } from "@codex-im/app-server-client";
import { describe, expect, it } from "vitest";
import { FakeAppServer } from "../src/fake-app-server.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe("FakeAppServer — Task 8.1 (skeleton + default initialize)", () => {
  it("default initialize handler returns codex-0.125-shaped InitializeResponse", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();

    const r = await client.request<Record<string, unknown>>("initialize", {
      clientInfo: { name: "test", title: null, version: "0.0.0" },
    });

    expect(r).toMatchObject({
      userAgent: expect.stringMatching(/fake-app-server/) as unknown as string,
      codexHome: "/fake/.codex",
      platformFamily: "unix",
      platformOs: "macos",
    });

    await client.stop();
    await fake.stop();
  });

  it("respondTo overrides default and uses custom handler", async () => {
    const fake = new FakeAppServer();
    fake.respondTo("thread/start", (params) => ({
      threadId: "t-1",
      receivedParams: params,
    }));
    const client = new AppServerClient(fake.clientSide);
    await client.start();

    const r = await client.request<{ threadId: string; receivedParams: unknown }>("thread/start", {
      workingDir: "/tmp",
    });
    expect(r.threadId).toBe("t-1");
    expect(r.receivedParams).toEqual({ workingDir: "/tmp" });

    await client.stop();
    await fake.stop();
  });

  it("unknown method returns -32601 error", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();

    await expect(client.request("does/not/exist")).rejects.toThrow(/-32601/);

    await client.stop();
    await fake.stop();
  });
});

describe("FakeAppServer — Task 8.2 (emitNotification)", () => {
  it("delivers notifications to the client", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    const seen: { method: string; params?: unknown }[] = [];
    client.onNotification((n) => {
      seen.push({
        method: n.method,
        ...(n.params !== undefined ? { params: n.params } : {}),
      });
    });
    await client.start();

    fake.emitNotification("turn/started", { threadId: "t-1", turnId: "u-1" });
    await flush();

    expect(seen).toContainEqual({
      method: "turn/started",
      params: { threadId: "t-1", turnId: "u-1" },
    });

    await client.stop();
    await fake.stop();
  });
});

describe("FakeAppServer — Task 8.3 (emitServerRequest round-trip)", () => {
  it("client default-rejects when no handler registered", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    await client.start();

    await expect(
      fake.emitServerRequest("approval/request", { what: "rm -rf /" }, 99),
    ).rejects.toMatchObject({ code: -32601 });

    await client.stop();
    await fake.stop();
  });

  it("client handler resolves and fake observes the response", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    client.setServerRequestHandler(() => ({ decision: "allow_once" }));
    await client.start();

    await expect(
      fake.emitServerRequest("approval/request", { what: "pnpm test" }, 100),
    ).resolves.toEqual({ decision: "allow_once" });

    await client.stop();
    await fake.stop();
  });

  it("supports server-initiated request with string id", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClient(fake.clientSide);
    client.setServerRequestHandler(() => ({ ok: true }));
    await client.start();

    await expect(fake.emitServerRequest("approval/request", {}, "approval-abc")).resolves.toEqual({
      ok: true,
    });

    await client.stop();
    await fake.stop();
  });
});

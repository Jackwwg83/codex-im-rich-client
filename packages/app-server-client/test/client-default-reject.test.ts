import { createInMemoryTransportPair } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/client.js";
import { JsonRpcResponseError } from "../src/errors.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

/**
 * Codex outside-voice finding #5: server-initiated requests must always
 * receive a response (no hangs). Test all four paths:
 *   1. No handler registered — reject -32601
 *   2. Handler throws — reject -32603
 *   3. Handler exceeds serverRequestHandlerTimeoutMs — reject -32603
 *   4. Multiple unanswered requests — every one gets a response
 */
describe("AppServerClient — default-reject server requests", () => {
  it("rejects with -32601 when no handler is registered", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    // Note: no setServerRequestHandler call.
    await client.start();

    serverT.send({ id: 100, method: "approval/request", params: {} });
    await flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(responses).toContainEqual({
      id: 100,
      error: {
        code: -32601,
        message: "no handler registered for approval/request",
      },
    });

    await client.stop();
  });

  it("rejects with -32603 when handler throws", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    client.setServerRequestHandler(() => {
      throw new Error("policy denied");
    });
    await client.start();

    serverT.send({ id: 200, method: "approval/request", params: {} });
    await flush();
    await new Promise((r) => setTimeout(r, 10));

    const errResp = responses.find(
      (r): r is { id: number; error: { code: number; message: string } } =>
        typeof r === "object" && r !== null && "error" in r,
    );
    expect(errResp?.id).toBe(200);
    expect(errResp?.error.code).toBe(-32603);
    expect(errResp?.error.message).toContain("policy denied");

    await client.stop();
  });

  it("rejects with -32603 when handler exceeds timeout", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    // Inject a tiny serverRequestHandlerTimeoutMs so the test runs fast.
    const client = new AppServerClient(clientT, {
      serverRequestHandlerTimeoutMs: 30,
    });
    client.setServerRequestHandler(
      () => new Promise((resolve) => setTimeout(() => resolve("never"), 1000)),
    );
    await client.start();

    serverT.send({ id: 300, method: "approval/request", params: {} });
    await new Promise((r) => setTimeout(r, 100));

    const errResp = responses.find(
      (r): r is { id: number; error: { code: number; message: string } } =>
        typeof r === "object" && r !== null && "error" in r,
    );
    expect(errResp?.id).toBe(300);
    expect(errResp?.error.code).toBe(-32603);
    expect(errResp?.error.message).toContain("timeout");

    await client.stop();
  });

  it("honors JsonRpcResponseError thrown from handler (T9a addition — preserves code/message/data)", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    client.setServerRequestHandler(() => {
      throw new JsonRpcResponseError({
        code: -32601,
        message: "unsupported method foo/bar",
        data: { hint: "not in dispatch table" },
      });
    });
    await client.start();

    serverT.send({ id: 400, method: "foo/bar", params: {} });
    await new Promise((r) => setTimeout(r, 10));

    const errResp = responses.find(
      (r): r is { id: number; error: { code: number; message: string; data?: unknown } } =>
        typeof r === "object" && r !== null && "error" in r,
    );
    expect(errResp?.id).toBe(400);
    expect(errResp?.error.code).toBe(-32601);
    expect(errResp?.error.message).toBe("unsupported method foo/bar");
    expect(errResp?.error.message).not.toContain("handler error:");
    expect(errResp?.error.data).toEqual({ hint: "not in dispatch table" });

    await client.stop();
  });

  it("every server request gets exactly one response (no hang)", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const responses: unknown[] = [];
    serverT.onMessage((m) => responses.push(m));
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();

    // Send 3 server requests with no registered handler.
    serverT.send({ id: 1, method: "a/x", params: {} });
    serverT.send({ id: 2, method: "b/x", params: {} });
    serverT.send({ id: 3, method: "c/x", params: {} });
    await new Promise((r) => setTimeout(r, 50));

    const errIds = responses
      .filter(
        (r): r is { id: number; error: { code: number; message: string } } =>
          typeof r === "object" && r !== null && "error" in r,
      )
      .map((r) => r.id);
    expect(errIds.sort()).toEqual([1, 2, 3]);

    await client.stop();
  });
});

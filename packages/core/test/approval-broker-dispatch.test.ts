// T9a Step 9a.3: per-method dispatcher tests (registered-handler path
// + no-handler default-reject path) for all 9 generated ServerRequest
// methods.
//
// Two groups, each with 9 cases (one per method):
//
//   Group A — registered handler is invoked with typed params,
//             response is forwarded verbatim to the wire envelope.
//             (Codex required-test: broker tests for all 9 generated
//             server-request methods.)
//
//   Group B — no handler installed, broker's defaultReject runs:
//             - 8 methods return a typed success response matching the
//               method's generated *Response.ts shape.
//             - 1 method (account/chatgptAuthTokens/refresh) throws
//               JsonRpcResponseError(-32601) — Phase 1 cannot fabricate
//               tokens and must signal explicit error to codex.
//
// Method-name string literals in this file are the dispatch-table keys,
// which IS allowed inside packages/core/. T9b's grep guard enforces
// that approval method literals appear NOWHERE outside packages/core/.
//
// Fixture replay: the captured fixture
// packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-server-request.jsonl
// contains exactly one server-initiated request — item/fileChange/
// requestApproval — captured from a real codex 0.125 turn under
// approval_policy=on-request. Group A's fileChange case uses those
// fixture params to assert the broker's dispatch path matches real
// wire shape. The other 8 cases use synthetic params constructed
// against the generated TypeScript types.

import { AppServerClient } from "@codex-im/app-server-client";
import { FakeAppServer, loadFixture } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  broker: ApprovalBroker;
}

async function harness(): Promise<Harness> {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide);
  await client.start();
  const broker = new ApprovalBroker(client);
  broker.attach();
  return { fake, client, broker };
}

async function teardown(h: Harness): Promise<void> {
  await h.client.stop();
  await h.fake.stop();
}

describe("ApprovalBroker dispatch — registered handler path (T9a Step 9a.3 Group A)", () => {
  it("dispatches item/commandExecution/requestApproval to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("item/commandExecution/requestApproval", async (req) => {
      received = req.params;
      return { decision: "accept" };
    });
    const params = {
      threadId: "t1",
      turnId: "u1",
      itemId: "call_x",
      command: ["echo", "ok"],
      reason: null,
      availableDecisions: null,
    };
    const resp = await h.fake.emitServerRequest("item/commandExecution/requestApproval", params, 1);
    expect(received).toEqual(params);
    expect(resp).toEqual({ decision: "accept" });
    await teardown(h);
  });

  it("dispatches item/fileChange/requestApproval (replays real fixture frame)", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("item/fileChange/requestApproval", async (req) => {
      received = req.params;
      return { decision: "accept" };
    });

    // Pull the fixture frame's params verbatim — this is the only
    // captured server-request in the corpus, so it carries the only
    // ground-truth wire shape we have for this method.
    const fixtureFrames = loadFixture("0.125.0", "phase1-richer-turn-server-request.jsonl");
    const frame = fixtureFrames[0] as { method: string; id: number; params: unknown };
    expect(frame.method).toBe("item/fileChange/requestApproval");

    const resp = await h.fake.emitServerRequest(frame.method, frame.params, 2);
    expect(received).toEqual(frame.params);
    expect(resp).toEqual({ decision: "accept" });
    await teardown(h);
  });

  it("dispatches item/permissions/requestApproval to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("item/permissions/requestApproval", async (req) => {
      received = req.params;
      return {
        permissions: { network: { enabled: true } },
        scope: "session",
      };
    });
    const params = {
      threadId: "t1",
      turnId: "u1",
      itemId: "call_x",
      cwd: "/tmp/work",
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    };
    const resp = await h.fake.emitServerRequest("item/permissions/requestApproval", params, 3);
    expect(received).toEqual(params);
    // toEqual (not toMatchObject) — verbatim forwarding means no extra
    // fields and no mutations (Codex T9a review low-4).
    expect(resp).toEqual({
      permissions: { network: { enabled: true } },
      scope: "session",
    });
    await teardown(h);
  });

  it("dispatches item/tool/requestUserInput to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("item/tool/requestUserInput", async (req) => {
      received = req.params;
      return { answers: { q1: { answers: ["yes"] } } };
    });
    const params = {
      threadId: "t1",
      turnId: "u1",
      itemId: "call_x",
      questions: [],
    };
    const resp = await h.fake.emitServerRequest("item/tool/requestUserInput", params, 4);
    expect(received).toEqual(params);
    expect(resp).toEqual({ answers: { q1: { answers: ["yes"] } } });
    await teardown(h);
  });

  it("dispatches item/tool/call to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("item/tool/call", async (req) => {
      received = req.params;
      return {
        contentItems: [{ type: "inputText", text: "result" }],
        success: true,
      };
    });
    const params = {
      threadId: "t1",
      turnId: "u1",
      callId: "tool-call-1",
      namespace: null,
      tool: "synthetic",
      arguments: {},
    };
    const resp = await h.fake.emitServerRequest("item/tool/call", params, 5);
    expect(received).toEqual(params);
    expect(resp).toEqual({
      contentItems: [{ type: "inputText", text: "result" }],
      success: true,
    });
    await teardown(h);
  });

  it("dispatches mcpServer/elicitation/request to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("mcpServer/elicitation/request", async (req) => {
      received = req.params;
      return { action: "accept", content: { confirmed: true }, _meta: null };
    });
    const params = {
      threadId: "t1",
      turnId: null,
      serverName: "mcp-1",
      mode: "form",
      _meta: null,
      message: "Confirm?",
      requestedSchema: { type: "object", properties: {} },
    };
    const resp = await h.fake.emitServerRequest("mcpServer/elicitation/request", params, 6);
    expect(received).toEqual(params);
    expect(resp).toEqual({ action: "accept", content: { confirmed: true }, _meta: null });
    await teardown(h);
  });

  it("dispatches applyPatchApproval to its registered handler (legacy)", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("applyPatchApproval", async (req) => {
      received = req.params;
      return { decision: "approved" };
    });
    const params = {
      conversationId: "conv-1",
      callId: "patch-1",
      fileChanges: {},
      reason: null,
      grantRoot: null,
    };
    const resp = await h.fake.emitServerRequest("applyPatchApproval", params, 7);
    expect(received).toEqual(params);
    expect(resp).toEqual({ decision: "approved" });
    await teardown(h);
  });

  it("dispatches execCommandApproval to its registered handler (legacy)", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("execCommandApproval", async (req) => {
      received = req.params;
      return { decision: "approved" };
    });
    const params = {
      conversationId: "conv-1",
      callId: "cmd-1",
      approvalId: null,
      command: ["ls"],
      cwd: "/tmp",
      reason: null,
      parsedCmd: [],
    };
    const resp = await h.fake.emitServerRequest("execCommandApproval", params, 8);
    expect(received).toEqual(params);
    expect(resp).toEqual({ decision: "approved" });
    await teardown(h);
  });

  it("dispatches account/chatgptAuthTokens/refresh to its registered handler", async () => {
    const h = await harness();
    let received: unknown;
    h.broker.registerHandler("account/chatgptAuthTokens/refresh", async (req) => {
      received = req.params;
      return {
        accessToken: "new-token",
        chatgptAccountId: "acc-1",
        chatgptPlanType: "pro",
      };
    });
    const params = { reason: "expired" };
    const resp = await h.fake.emitServerRequest("account/chatgptAuthTokens/refresh", params, 9);
    expect(received).toEqual(params);
    expect(resp).toEqual({
      accessToken: "new-token",
      chatgptAccountId: "acc-1",
      chatgptPlanType: "pro",
    });
    await teardown(h);
  });
});

describe("ApprovalBroker dispatch — default-reject path (T9a Step 9a.3 Group B)", () => {
  // 8 methods that return a typed success response with the default-reject
  // shape (Phase 1 never auto-approves; the response shape is whatever
  // codex needs to keep the turn moving without granting access).

  it('default-rejects item/commandExecution/requestApproval as { decision: "decline" }', async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("item/commandExecution/requestApproval", {}, 10);
    expect(resp).toEqual({ decision: "decline" });
    await teardown(h);
  });

  it('default-rejects item/fileChange/requestApproval as { decision: "decline" }', async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("item/fileChange/requestApproval", {}, 11);
    expect(resp).toEqual({ decision: "decline" });
    await teardown(h);
  });

  it('default-rejects item/permissions/requestApproval as { permissions: {}, scope: "turn" }', async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("item/permissions/requestApproval", {}, 12);
    expect(resp).toEqual({ permissions: {}, scope: "turn" });
    await teardown(h);
  });

  it("default-rejects item/tool/requestUserInput as { answers: {} }", async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("item/tool/requestUserInput", {}, 13);
    expect(resp).toEqual({ answers: {} });
    await teardown(h);
  });

  it("default-rejects item/tool/call as { contentItems: [], success: false } (Computer Use disabled in Phase 1)", async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("item/tool/call", {}, 14);
    expect(resp).toEqual({ contentItems: [], success: false });
    await teardown(h);
  });

  it("default-rejects mcpServer/elicitation/request as cancel", async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("mcpServer/elicitation/request", {}, 15);
    expect(resp).toEqual({ action: "cancel", content: null, _meta: null });
    await teardown(h);
  });

  it('default-rejects applyPatchApproval as { decision: "denied" } (legacy)', async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("applyPatchApproval", {}, 16);
    expect(resp).toEqual({ decision: "denied" });
    await teardown(h);
  });

  it('default-rejects execCommandApproval as { decision: "denied" } (legacy)', async () => {
    const h = await harness();
    const resp = await h.fake.emitServerRequest("execCommandApproval", {}, 17);
    expect(resp).toEqual({ decision: "denied" });
    await teardown(h);
  });

  // Auth refresh: cannot fabricate tokens, so the broker signals an
  // explicit JSON-RPC error envelope instead of returning a fake
  // response. Pre-3's AppServerClient catch arm preserves the code.

  it("default-rejects account/chatgptAuthTokens/refresh by signaling -32601 (cannot fabricate tokens)", async () => {
    const h = await harness();
    await expect(
      h.fake.emitServerRequest("account/chatgptAuthTokens/refresh", { reason: "expired" }, 18),
    ).rejects.toMatchObject({
      code: -32601,
      message: expect.stringMatching(/auth refresh not supported/i),
    });
    await teardown(h);
  });
});

// T8 (Phase 1, P1.1): CodexRuntime typed wrappers.
//
// Validates that each ClientRequest method has a typed wrapper:
//   1. forwards params verbatim to client.request<R> (single type arg —
//      the actual signature; older drafts incorrectly said <P, R>)
//   2. returns the typed response shape
//   3. types are sourced from @codex-im/protocol's facade
//      (Pre-2 expansion), never hardcoded
//
// "Verbatim forwarding" is asserted with `toBe` on a representative
// wrapper (threadStart) so a clone-but-preserve-shape transform would
// fail. The remaining wrappers use `toEqual` since the `toBe` check
// already proves the wire path doesn't transform params (T8 codex
// outside-voice review fix).
//
// runtime.events is the EventNormalizer instance — covered by
// event-normalizer.test.ts. Here we exercise the wrappers themselves
// against FakeAppServer.

import { AppServerClient } from "@codex-im/app-server-client";
import type {
  AppsListParams,
  AppsListResponse,
  GetAccountRateLimitsResponse,
  ListMcpServerStatusParams,
  ListMcpServerStatusResponse,
  ModelListParams,
  ModelListResponse,
  ModelProviderCapabilitiesReadResponse,
  PluginListParams,
  PluginListResponse,
  ReviewStartParams,
  ReviewStartResponse,
  SkillsListParams,
  SkillsListResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@codex-im/protocol";
import { FakeAppServer } from "@codex-im/testkit";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../src/runtime.js";

type DynamicToolSpec = {
  readonly namespace?: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly deferLoading?: boolean;
};

const SILENT = pino({ level: "silent" });

interface Harness {
  fake: FakeAppServer;
  client: AppServerClient;
  runtime: CodexRuntime;
}

async function harness(): Promise<Harness> {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide, { logger: SILENT });
  await client.start();
  const runtime = new CodexRuntime(client);
  return { fake, client, runtime };
}

async function teardown(h: Harness): Promise<void> {
  await h.client.stop();
  await h.fake.stop();
}

describe("CodexRuntime — thread/* wrappers (T8)", () => {
  it("threadStart forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/start", (params) => {
      received = params;
      return {
        thread: { id: "thread-1" },
        model: "gpt-X",
        modelProvider: "openai",
        serviceTier: null,
        cwd: "/tmp/x",
        instructionSources: [],
        approvalPolicy: "on-request",
        approvalsReviewer: { type: "default" },
        sandbox: { mode: "read-only" },
        permissionProfile: null,
        reasoningEffort: null,
      } as unknown as ThreadStartResponse;
    });

    // codex 0.128 removed experimentalRawEvents + persistExtendedHistory
    // from ThreadStartParams; swap in two still-extant optional fields
    // to keep the verbatim-forwarding identity check meaningful.
    const params: ThreadStartParams = {
      cwd: "/tmp",
      developerInstructions: "test",
    };
    const r = await h.runtime.threadStart(params);
    // toEqual would pass for a clone-but-preserve-shape transform; toBe
    // proves identity, which is what "verbatim forwarding" means.
    // FakeAppServer / InMemoryTransport pass the params reference through
    // a microtask without serialization (so identity is preserved end to
    // end). One representative wrapper carries the toBe check; the rest
    // use toEqual since the wire path is shared.
    expect(received).toBe(params);
    expect(r.thread.id).toBe("thread-1");

    await teardown(h);
  });

  it("threadStart forwards experimental dynamicTools without rewriting the contract", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/start", (params) => {
      received = params;
      return { thread: { id: "thread-cu" } } as unknown as ThreadStartResponse;
    });

    const dynamicTool: DynamicToolSpec = {
      namespace: "codex_im.computer_use",
      name: "operate",
      description: "Execute one scoped Computer Use step after explicit /cu policy gates.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          app: { type: "string" },
          step: { type: "string" },
          action: { type: "string" },
          sensitivity: { enum: ["normal", "sensitive"] },
        },
        required: ["app", "step", "action"],
      },
    };
    const params: ThreadStartParams & { readonly dynamicTools: readonly DynamicToolSpec[] } = {
      cwd: "/tmp",
      dynamicTools: [dynamicTool],
    };

    await h.runtime.threadStart(params);

    expect(received).toBe(params);
    expect((received as { dynamicTools?: unknown }).dynamicTools).toEqual([dynamicTool]);

    await teardown(h);
  });

  it("threadResume forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/resume", (params) => {
      received = params;
      return { thread: { id: "thread-resumed" } } as unknown as ThreadResumeResponse;
    });

    const params: ThreadResumeParams = {
      threadId: "thread-1",
      persistExtendedHistory: false,
    } as ThreadResumeParams;
    const r = await h.runtime.threadResume(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-resumed");

    await teardown(h);
  });

  it("threadFork forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/fork", (params) => {
      received = params;
      return { thread: { id: "thread-forked" } } as unknown as ThreadForkResponse;
    });

    const params: ThreadForkParams = {
      threadId: "thread-1",
      persistExtendedHistory: false,
    } as ThreadForkParams;
    const r = await h.runtime.threadFork(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-forked");

    await teardown(h);
  });

  it("threadTurnsList forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/turns/list", (params) => {
      received = params;
      return {
        data: [],
        nextCursor: null,
        backwardsCursor: null,
      } as ThreadTurnsListResponse;
    });

    const params: ThreadTurnsListParams = { threadId: "thread-1" };
    const r = await h.runtime.threadTurnsList(params);
    expect(received).toEqual(params);
    expect(r.data).toEqual([]);
    expect(r.nextCursor).toBeNull();

    await teardown(h);
  });

  it("threadRead forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/read", (params) => {
      received = params;
      return { thread: { id: "thread-1" } } as unknown as ThreadReadResponse;
    });

    const params: ThreadReadParams = { threadId: "thread-1", includeTurns: false };
    const r = await h.runtime.threadRead(params);
    expect(received).toEqual(params);
    expect(r.thread.id).toBe("thread-1");

    await teardown(h);
  });

  it("threadList forwards params and returns native Codex threads", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("thread/list", (params) => {
      received = params;
      return {
        data: [
          {
            id: "thread-native",
            preview: "Fix the login test",
            cwd: "/repo/web",
            updatedAt: 1778148600,
            createdAt: 1778148000,
            status: "idle",
            source: { kind: "appServer" },
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      } as unknown as ThreadListResponse;
    });

    const params: ThreadListParams = {
      limit: 20,
      archived: false,
      sortDirection: "desc",
    };
    const r = await h.runtime.threadList(params);
    expect(received).toEqual(params);
    expect(r.data[0]?.id).toBe("thread-native");
    expect(r.data[0]?.cwd).toBe("/repo/web");

    await teardown(h);
  });
});

describe("CodexRuntime — turn/* wrappers (T8)", () => {
  it("turnStart forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("turn/start", (params) => {
      received = params;
      return {
        turn: { id: "turn-1", items: [], status: "inProgress" },
      } as unknown as TurnStartResponse;
    });

    const params: TurnStartParams = {
      threadId: "thread-1",
      input: [{ type: "text", text: "hi", text_elements: [] }],
    } as TurnStartParams;
    const r = await h.runtime.turnStart(params);
    expect(received).toEqual(params);
    expect(r.turn.id).toBe("turn-1");

    await teardown(h);
  });

  it("turnSteer forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("turn/steer", (params) => {
      received = params;
      return { turnId: "turn-1" } as TurnSteerResponse;
    });

    const params: TurnSteerParams = {
      threadId: "thread-1",
      input: [],
      expectedTurnId: "turn-1",
    } as TurnSteerParams;
    const r = await h.runtime.turnSteer(params);
    expect(received).toEqual(params);
    expect(r.turnId).toBe("turn-1");

    await teardown(h);
  });

  it("turnInterrupt forwards params and returns void-shaped response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("turn/interrupt", (params) => {
      received = params;
      return {} as TurnInterruptResponse;
    });

    const params: TurnInterruptParams = { threadId: "thread-1", turnId: "turn-1" };
    const r = await h.runtime.turnInterrupt(params);
    expect(received).toEqual(params);
    expect(r).toEqual({});

    await teardown(h);
  });
});

describe("CodexRuntime — review/* wrappers (T8)", () => {
  it("reviewStart forwards params and returns typed response", async () => {
    const h = await harness();
    let received: unknown;
    h.fake.respondTo("review/start", (params) => {
      received = params;
      return {
        turn: { id: "turn-1", items: [], status: "inProgress" },
        reviewThreadId: "thread-1",
      } as unknown as ReviewStartResponse;
    });

    const params: ReviewStartParams = {
      threadId: "thread-1",
      target: { type: "uncommittedChanges" },
    };
    const r = await h.runtime.reviewStart(params);
    expect(received).toEqual(params);
    expect(r.reviewThreadId).toBe("thread-1");

    await teardown(h);
  });
});

describe("CodexRuntime — native app/capability wrappers", () => {
  it("forwards thread compaction, catalog, tool, MCP, and usage requests", async () => {
    const h = await harness();
    const received = new Map<string, unknown>();

    h.fake.respondTo("thread/compact/start", (params) => {
      received.set("compact", params);
      return {} as ThreadCompactStartResponse;
    });
    h.fake.respondTo("model/list", (params) => {
      received.set("model", params);
      return { data: [], nextCursor: null } as ModelListResponse;
    });
    h.fake.respondTo("modelProvider/capabilities/read", (params) => {
      received.set("capabilities", params);
      return {
        namespaceTools: true,
        imageGeneration: true,
        webSearch: false,
      } as ModelProviderCapabilitiesReadResponse;
    });
    h.fake.respondTo("skills/list", (params) => {
      received.set("skills", params);
      return { data: [] } as SkillsListResponse;
    });
    h.fake.respondTo("plugin/list", (params) => {
      received.set("plugins", params);
      return {
        marketplaces: [],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      } as PluginListResponse;
    });
    h.fake.respondTo("app/list", (params) => {
      received.set("apps", params);
      return { data: [], nextCursor: null } as AppsListResponse;
    });
    h.fake.respondTo("mcpServerStatus/list", (params) => {
      received.set("mcp", params);
      return { data: [], nextCursor: null } as ListMcpServerStatusResponse;
    });
    h.fake.respondTo("account/rateLimits/read", (params) => {
      received.set("usage", params);
      return {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: null,
          secondary: null,
          credits: null,
          planType: null,
          rateLimitReachedType: null,
        },
        rateLimitsByLimitId: null,
      } as GetAccountRateLimitsResponse;
    });

    const compactParams: ThreadCompactStartParams = { threadId: "thread-1" };
    const modelParams: ModelListParams = { limit: 20, includeHidden: false };
    const skillsParams: SkillsListParams = { cwds: ["/tmp/project"] };
    const pluginParams: PluginListParams = { cwds: ["/tmp/project"] };
    const appsParams: AppsListParams = { limit: 20, threadId: "thread-1" };
    const mcpParams: ListMcpServerStatusParams = { limit: 20, detail: "toolsAndAuthOnly" };

    await expect(h.runtime.threadCompactStart(compactParams)).resolves.toEqual({});
    await h.runtime.modelList(modelParams);
    await h.runtime.modelProviderCapabilitiesRead({});
    await h.runtime.skillsList(skillsParams);
    await h.runtime.pluginList(pluginParams);
    await h.runtime.appsList(appsParams);
    await h.runtime.mcpServerStatusList(mcpParams);
    await h.runtime.accountRateLimitsRead();

    expect(received.get("compact")).toEqual(compactParams);
    expect(received.get("model")).toEqual(modelParams);
    expect(received.get("capabilities")).toEqual({});
    expect(received.get("skills")).toEqual(skillsParams);
    expect(received.get("plugins")).toEqual(pluginParams);
    expect(received.get("apps")).toEqual(appsParams);
    expect(received.get("mcp")).toEqual(mcpParams);
    expect(received.get("usage")).toBeUndefined();

    await teardown(h);
  });
});

describe("CodexRuntime — events surface (T8)", () => {
  it("exposes the EventNormalizer's AsyncIterable via runtime.events", async () => {
    const h = await harness();
    expect(h.runtime.events).toBeDefined();
    // The normalizer's events() returns an AsyncIterableIterator.
    const it = h.runtime.events.events();
    expect(typeof it.next).toBe("function");
    expect(typeof it.return).toBe("function");
    expect(typeof it[Symbol.asyncIterator]).toBe("function");
    await teardown(h);
  });

  it("runtime.events emits notifications received via the underlying client", async () => {
    const h = await harness();
    const it = h.runtime.events.events();

    h.fake.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "inProgress" },
    });

    const ev = (await it.next()).value;
    expect(ev?.type).toBe("turn_started");

    await teardown(h);
  });
});

describe("CodexRuntime — request error propagation (T8)", () => {
  it("rejects with JsonRpcResponseError when the server returns a JSON-RPC error", async () => {
    const h = await harness();
    // FakeAppServer's default behavior: handler throwing → maps to
    // -32603. Add an explicit handler that throws.
    h.fake.respondTo("thread/read", () => {
      throw new Error("not found");
    });

    await expect(
      h.runtime.threadRead({ threadId: "missing", includeTurns: false }),
    ).rejects.toThrow(/not found/);

    await teardown(h);
  });

  it("rejects when FakeAppServer returns -32601 for an unhandled method", async () => {
    // NOTE: codex 0.125 actually returns -32600 (Invalid Request) for
    // an unknown method; FakeAppServer uses -32601 (Method Not Found).
    // What this test asserts is the runtime's "JSON-RPC error → reject"
    // behavior, which is identical regardless of code. The wire-level
    // contract against real codex is covered by the cli smoke fixtures.
    const h = await harness();
    // FakeAppServer auto-emits -32601 for unregistered methods.
    await expect(h.runtime.threadRead({ threadId: "x", includeTurns: false })).rejects.toThrow();
    await teardown(h);
  });
});

import type { CodexRichEvent } from "@codex-im/codex-runtime";
import type {
  SecurityPolicySender,
  SessionBindingInput,
  SessionRoute,
  Target,
} from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { Daemon, type DaemonMessageRef, type DaemonOutboundFile } from "../src/index.js";

const TARGET: Target = { platform: "telegram", chatId: "-1001" };
const SENDER: SecurityPolicySender = { userId: "42", displayName: "operator" };

class EventQueue implements AsyncIterableIterator<CodexRichEvent> {
  readonly #queue: CodexRichEvent[] = [];
  readonly #waiters: Array<(value: IteratorResult<CodexRichEvent>) => void> = [];

  push(event: CodexRichEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: event, done: false });
      return;
    }
    this.#queue.push(event);
  }

  next(): Promise<IteratorResult<CodexRichEvent>> {
    const event = this.#queue.shift();
    if (event !== undefined) {
      return Promise.resolve({ value: event, done: false });
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<CodexRichEvent> {
    return this;
  }
}

describe("daemon turn output projection", () => {
  it("falls back to a bot-owned text reply when an inbound command message cannot be edited", async () => {
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-reply-1",
    }));
    const editText = vi.fn(async () => {
      throw new Error("message can't be edited");
    });
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: SessionRoute = { kind: "unbound", target: TARGET };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
      }),
      createSupervisor: () => ({}),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "/use codex-im",
      messageRef: { target: TARGET, messageId: "user-command-1" },
    });

    await waitFor(() => sendText.mock.calls.length === 1);
    expect(editText).toHaveBeenCalledWith(
      { target: TARGET, messageId: "user-command-1" },
      "Using project codex-im",
    );
    expect(sendText).toHaveBeenCalledWith(TARGET, "Using project codex-im");
    expect(route).toMatchObject({ kind: "bound", projectId: "codex-im" });

    await daemon.stop();
  });

  it("sends a bot-owned placeholder and edits it with the terminal Codex text", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
        bindThread: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Reply OK",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);
    expect(route.activeTurnId).toBe("turn-1");

    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      deltaText: "OK",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 2);
    expect(sendText).toHaveBeenCalledWith(TARGET, "Codex is working...");
    expect(editText).toHaveBeenNthCalledWith(
      1,
      { target: TARGET, messageId: "bot-output-1" },
      "OK",
    );
    expect(editText).toHaveBeenLastCalledWith({ target: TARGET, messageId: "bot-output-1" }, "OK");
    expect(route.activeTurnId).toBeUndefined();

    await daemon.stop();
  });

  it("does not progress-edit append-only bot-owned text refs and sends one terminal reply", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: `append-output-${sendText.mock.calls.length}`,
      kind: "text" as const,
      textUpdateMode: "append" as const,
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
        bindThread: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Reply OK",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      deltaText: "OK",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => sendText.mock.calls.length === 2);
    expect(editText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(1, TARGET, "Codex is working...");
    expect(sendText).toHaveBeenNthCalledWith(2, TARGET, "OK");

    await daemon.stop();
  });

  it("appends completed Codex item summaries to terminal IM output", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
        bindThread: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Create a file",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-file-1",
      raw: {
        params: {
          item: {
            type: "fileChange",
            status: "declined",
            changes: [{ path: "<CWD>/hello.txt" }],
          },
        },
      },
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      deltaText: "done",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 2);
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      "done\n\nCodex items:\n- fileChange declined: <CWD>/hello.txt",
    );

    await daemon.stop();
  });

  it("sends completed image-generation artifacts through the adapter file path", async () => {
    const queue = new EventQueue();
    const artifactBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const readArtifactFile = vi.fn(async () => artifactBytes);
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    const sendFile = vi.fn(async (target: Target, _file: DaemonOutboundFile) => ({
      target,
      messageId: "bot-file-1",
      kind: "file" as const,
    }));
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        sendFile,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      readArtifactFile,
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Generate a diagram",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-image-1",
      raw: {
        params: {
          item: {
            type: "imageGeneration",
            status: "completed",
            result: "saved",
            savedPath: "/tmp/codex-im/diagram.png",
          },
        },
      },
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      deltaText: "diagram ready",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => sendFile.mock.calls.length === 1);
    expect(readArtifactFile).toHaveBeenCalledWith("/tmp/codex-im/diagram.png");
    expect(sendFile).toHaveBeenCalledWith(TARGET, {
      filename: "diagram.png",
      bytes: artifactBytes,
      contentType: "image/png",
    });
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      "diagram ready\n\nCodex items:\n- imageGeneration completed: /tmp/codex-im/diagram.png",
    );

    await daemon.stop();
  });

  it("summarizes native development and tool-call Codex items in terminal IM output", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
        bindThread: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Use tools",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-command",
      raw: {
        params: {
          item: {
            type: "commandExecution",
            status: "completed",
            command: "pnpm test",
            exitCode: 0,
            durationMs: 120,
          },
        },
      },
    });
    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-mcp",
      raw: {
        params: {
          item: {
            type: "mcpToolCall",
            status: "completed",
            server: "github",
            tool: "createPullRequest",
          },
        },
      },
    });
    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-dynamic",
      raw: {
        params: {
          item: {
            type: "dynamicToolCall",
            status: "completed",
            namespace: "browser-use",
            tool: "open",
          },
        },
      },
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-agent",
      deltaText: "done",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 2);
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      [
        "done",
        "",
        "Codex items:",
        "- commandExecution completed: pnpm test; exit 0; 120ms",
        "- mcpToolCall completed: github.createPullRequest",
        "- dynamicToolCall completed: browser-use.open",
      ].join("\n"),
    );

    await daemon.stop();
  });

  it("folds Codex lifecycle status notices into the active IM turn output", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Use status-producing tools",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "unknown",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 1234,
            inputTokens: 1000,
            cachedInputTokens: 200,
            outputTokens: 234,
            reasoningOutputTokens: 34,
          },
          last: {
            totalTokens: 56,
            inputTokens: 45,
            cachedInputTokens: 5,
            outputTokens: 11,
            reasoningOutputTokens: 1,
          },
          modelContextWindow: 8000,
        },
      },
    });
    queue.push({
      type: "unknown",
      method: "model/rerouted",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        fromModel: "gpt-old",
        toModel: "gpt-new",
        reason: "capacity",
      },
    });
    queue.push({
      type: "unknown",
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "github",
        status: "ready",
        error: "token-like sk-test-secret should not be shown",
      },
    });
    queue.push({
      type: "unknown",
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [
          { step: "Inspect status projection", status: "completed" },
          { step: "Patch daemon output", status: "in_progress" },
        ],
      },
    });
    queue.push({
      type: "unknown",
      method: "turn/diff/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        diff: {
          files: [
            { path: "packages/daemon/src/daemon.ts" },
            { path: "packages/daemon/test/turn-output.test.ts" },
          ],
          unifiedDiff: "SECRET=abcdefghijklmnopqrstuvwxyz should not be shown",
        },
      },
    });
    queue.push({
      type: "unknown",
      method: "thread/name/updated",
      params: {
        threadId: "thread-1",
        name: "debug ghp_abcdefghijklmnopqrstuvwxyz123456",
      },
    });
    queue.push({
      type: "unknown",
      method: "thread/goal/updated",
      params: {
        threadId: "thread-1",
        goal: { title: "ship IM status projection", status: "active" },
      },
    });
    queue.push({
      type: "unknown",
      method: "thread/goal/cleared",
      params: {
        threadId: "thread-1",
      },
    });
    queue.push({
      type: "unknown",
      method: "skills/changed",
      params: {},
    });
    queue.push({
      type: "unknown",
      method: "app/list/updated",
      params: {},
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-agent",
      deltaText: "done",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 2);
    const lastEdit = editText.mock.calls.at(-1);
    expect(lastEdit).toBeDefined();
    const [, body] = lastEdit as unknown as [DaemonMessageRef, string];
    expect(body).toBe(
      [
        "done",
        "",
        "Codex status:",
        "- token usage: total 1234, last 56, context 15%",
        "- model rerouted: gpt-old -> gpt-new (capacity)",
        "- MCP github: ready",
        "- plan updated: 2 steps, 1 completed, 1 in progress",
        "- diff updated: 2 files",
        "- thread renamed: debug ***REDACTED:github-token***",
        "- goal updated: ship IM status projection (active)",
        "- goal cleared",
        "- skills changed",
        "- apps updated",
      ].join("\n"),
    );
    expect(body).not.toContain("sk-test-secret");
    expect(body).not.toContain("token-like");
    expect(body).not.toContain("SECRET=");
    expect(body).not.toContain("abcdefghijklmnopqrstuvwxyz");

    await daemon.stop();
  });

  it("folds Codex warning and error notices into the active IM turn output", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Trigger runtime warning output",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "warning",
      raw: {
        method: "warning",
        params: {
          message: "near context limit sk-abcdefghijklmnopqrstuvwxyz1234567890",
        },
      },
    });
    queue.push({
      type: "error",
      raw: {
        method: "error",
        params: {
          message: "provider failed",
          code: "E_PROVIDER",
          stack: "SECRET=abcdefghijklmnopqrstuvwxyz should not be shown",
        },
      },
    });
    queue.push({
      type: "unknown",
      method: "configWarning",
      params: {
        message: "deprecated MCP config",
        detail: "Authorization: Bearer should-not-be-shown",
      },
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-agent",
      deltaText: "done",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 2);
    const lastEdit = editText.mock.calls.at(-1);
    expect(lastEdit).toBeDefined();
    const [, body] = lastEdit as unknown as [DaemonMessageRef, string];
    expect(body).toBe(
      [
        "done",
        "",
        "Codex status:",
        "- warning: near context limit ***REDACTED:openai-token***",
        "- error: provider failed (E_PROVIDER)",
        "- config warning: deprecated MCP config",
      ].join("\n"),
    );
    expect(body).not.toContain("SECRET=");
    expect(body).not.toContain("Authorization");
    expect(body).not.toContain("should-not-be-shown");

    await daemon.stop();
  });

  it("includes short command output and sends file-change diffs as IM attachments", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    const sendFile = vi.fn(async (target: Target, _file: DaemonOutboundFile) => ({
      target,
      messageId: "bot-file-1",
      kind: "file" as const,
    }));
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        sendFile,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Run command and edit file",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-command",
      raw: {
        params: {
          item: {
            type: "commandExecution",
            status: "completed",
            command: "npm test",
            aggregatedOutput: "hello from command\n",
            exitCode: 0,
          },
        },
      },
    });
    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-file",
      raw: {
        params: {
          item: {
            id: "item-file",
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "src/app.ts",
                kind: "update",
                diff: "@@\n-old\n+new\n",
              },
            ],
          },
        },
      },
    });
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-agent",
      deltaText: "done",
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => sendFile.mock.calls.length === 1);
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      [
        "done",
        "",
        "Codex items:",
        "- commandExecution completed: npm test; exit 0; output: hello from command",
        "- fileChange completed: src/app.ts",
      ].join("\n"),
    );
    expect(sendFile).toHaveBeenCalledWith(TARGET, {
      filename: "codex-filechange-item-file.patch",
      bytes: expect.any(Uint8Array),
      contentType: "text/x-patch",
    });
    const fileArg = sendFile.mock.calls[0]?.[1];
    expect(fileArg?.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(fileArg?.bytes ?? new Uint8Array())).toContain(
      "@@\n-old\n+new\n",
    );

    await daemon.stop();
  });

  it("attaches failed long command logs and local image-view artifacts", async () => {
    const queue = new EventQueue();
    const screenshotBytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const readArtifactFile = vi.fn(async () => screenshotBytes);
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    const sendFile = vi.fn(async (target: Target, _file: DaemonOutboundFile) => ({
      target,
      messageId: `bot-file-${sendFile.mock.calls.length + 1}`,
      kind: "file" as const,
    }));
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        sendFile,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      readArtifactFile,
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Run a noisy command and inspect an image",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-command",
      raw: {
        params: {
          item: {
            id: "item-command",
            type: "commandExecution",
            status: "failed",
            command: "pnpm test",
            aggregatedOutput: "very noisy output\n".repeat(40),
            exitCode: 1,
          },
        },
      },
    });
    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-image-view",
      raw: {
        params: {
          item: {
            type: "imageView",
            path: "/tmp/codex-im/screenshot.jpg",
          },
        },
      },
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => sendFile.mock.calls.length === 2);
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      [
        "Codex turn completed.",
        "",
        "Codex items:",
        "- commandExecution failed: pnpm test; exit 1; output: attached",
        "- imageView: /tmp/codex-im/screenshot.jpg",
      ].join("\n"),
    );
    expect(sendFile.mock.calls[0]?.[1]).toMatchObject({
      filename: "codex-command-item-command.log",
      contentType: "text/plain",
    });
    const commandLogFile = sendFile.mock.calls[0]?.[1];
    expect(commandLogFile?.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(commandLogFile?.bytes ?? new Uint8Array())).toContain(
      "very noisy output",
    );
    expect(readArtifactFile).toHaveBeenCalledWith("/tmp/codex-im/screenshot.jpg");
    expect(sendFile.mock.calls[1]?.[1]).toEqual({
      filename: "screenshot.jpg",
      bytes: screenshotBytes,
      contentType: "image/jpeg",
    });

    await daemon.stop();
  });

  it("summarizes Computer Use dynamic tool output content without exposing arguments", async () => {
    const queue = new EventQueue();
    const screenshotBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const readArtifactFile = vi.fn(async () => screenshotBytes);
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async (_ref: DaemonMessageRef, _body: string) => undefined);
    const sendFile = vi.fn(async (target: Target, _file: DaemonOutboundFile) => ({
      target,
      messageId: "bot-file-1",
      kind: "file" as const,
    }));
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        sendFile,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      readArtifactFile,
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Use Computer Use",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-computer-use",
      raw: {
        params: {
          item: {
            type: "dynamicToolCall",
            status: "failed",
            namespace: null,
            tool: "computer_use.synthetic",
            arguments: { token: "should-not-render" },
            success: false,
            durationMs: 33,
            contentItems: [
              { type: "inputText", text: "blocked by policy" },
              { type: "inputImage", imageUrl: "/tmp/codex-im/cu.png" },
            ],
          },
        },
      },
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 1);
    const body = editText.mock.calls.at(-1)?.[1];
    expect(body).toContain(
      "- dynamicToolCall failed: Computer Use computer_use.synthetic; success no; 33ms; content 2 text 1 image 1",
    );
    expect(body).not.toContain("should-not-render");
    await waitFor(() => sendFile.mock.calls.length === 1);
    expect(readArtifactFile).toHaveBeenCalledWith("/tmp/codex-im/cu.png");
    expect(sendFile).toHaveBeenCalledWith(TARGET, {
      filename: "cu.png",
      bytes: screenshotBytes,
      contentType: "image/png",
    });

    await daemon.stop();
  });

  it("projects Computer Use dynamic tool calls as Codex-native GUI activity", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: "bot-output-1",
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    const route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Summarize the visible page",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    queue.push({
      type: "item_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-computer-use",
      raw: {
        params: {
          item: {
            type: "dynamicToolCall",
            status: "completed",
            namespace: null,
            tool: "computer_use.synthetic",
          },
        },
      },
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => editText.mock.calls.length >= 1);
    expect(editText).toHaveBeenLastCalledWith(
      { target: TARGET, messageId: "bot-output-1" },
      "Codex turn completed.\n\nCodex items:\n- dynamicToolCall completed: Computer Use computer_use.synthetic",
    );

    await daemon.stop();
  });

  it("splits long terminal Codex output into continuation IM messages", async () => {
    const queue = new EventQueue();
    const sendText = vi.fn(async (target: Target, _body: string) => ({
      target,
      messageId: `bot-output-${sendText.mock.calls.length + 1}`,
    }));
    const editText = vi.fn(async () => undefined);
    let messageHandler: ((message: unknown) => void) | undefined;
    let route: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound",
      target: TARGET,
      projectId: "codex-im",
      cwd: "/tmp/codex-im",
      codexThreadId: "thread-1",
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { "codex-im": { cwd: "/tmp/codex-im" } } }),
      openStorage: () => ({ close: () => undefined }),
      createBroker: () => ({
        attach: () => undefined,
        enablePendingMode: () => undefined,
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: () => ({ kind: "allow" as const }),
        checkProjectAccess: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({
        resolve: () => route,
        bind: (target: Target, input: SessionBindingInput) => {
          route = { kind: "bound", target, ...input };
          return route;
        },
        bindThread: () => route,
      }),
      createSupervisor: () => ({
        currentRuntime: () => ({
          events: { events: () => queue },
          threadStart: async () => ({ thread: { id: "thread-1" } }),
          turnStart: async () => ({ turn: { id: "turn-1" } }),
          turnSteer: async () => undefined,
        }),
      }),
      createAdapter: () => ({
        onAction: () => () => undefined,
        onMessage: (handler) => {
          messageHandler = handler;
          return () => undefined;
        },
        sendText,
        editText,
        start: async () => undefined,
        stop: async () => undefined,
      }),
      schedulePrune: () => () => undefined,
    });

    await daemon.start();
    messageHandler?.({
      target: TARGET,
      sender: SENDER,
      text: "Write a long answer",
      messageRef: { target: TARGET, messageId: "user-message-1" },
    });
    await waitFor(() => sendText.mock.calls.length === 1);

    const longText = "0123456789\n".repeat(450);
    queue.push({
      type: "agent_message_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-agent",
      deltaText: longText,
      raw: {},
    });
    queue.push({
      type: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      raw: {},
      terminal: true,
    });

    await waitFor(() => sendText.mock.calls.length >= 2);
    const [, continuationBody] = sendText.mock.calls[1] as [Target, string];
    expect(continuationBody).toMatch(/^\[continued\]\n/);
    expect(continuationBody).not.toContain("[truncated for IM]");

    await daemon.stop();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out waiting for daemon turn output");
}

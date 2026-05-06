import type { CodexRichEvent } from "@codex-im/codex-runtime";
import type {
  SecurityPolicySender,
  SessionBindingInput,
  SessionRoute,
  Target,
} from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { Daemon } from "../src/index.js";

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
    const sendFile = vi.fn(async (target: Target) => ({
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

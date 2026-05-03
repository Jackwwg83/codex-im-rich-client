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

    await waitFor(() => editText.mock.calls.length === 1);
    expect(sendText).toHaveBeenCalledWith(TARGET, "Codex is working...");
    expect(editText).toHaveBeenCalledWith({ target: TARGET, messageId: "bot-output-1" }, "OK");
    expect(route.activeTurnId).toBeUndefined();

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

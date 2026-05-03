import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type DynamicToolCallHandler,
  FakeComputerUseProvider,
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type SessionRoute,
  SessionRouter,
} from "@codex-im/core";
import type { ApprovalCard } from "@codex-im/render";
import {
  BindingRepository,
  type CallbackTokenInsert,
  type CallbackTokenRecord,
  hashCallbackToken,
  openDatabase,
  runMigrations,
} from "@codex-im/storage-sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  Daemon,
  type DaemonOptions,
  type DaemonSignal,
  type DaemonStatusSnapshot,
} from "../src/index.js";

const SRC_DIR = join(import.meta.dirname, "../src");
const STORAGE_MIGRATIONS_DIR = join(import.meta.dirname, "../../storage-sqlite/src/migrations");

async function flushDaemonHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function readSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...readSourceFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("Daemon skeleton (T14)", () => {
  it("starts and stops as an idempotent no-op skeleton", async () => {
    const daemon = new Daemon();

    expect(daemon.isStarted()).toBe(false);
    await expect(daemon.start()).resolves.toBeUndefined();
    await expect(daemon.start()).resolves.toBeUndefined();
    expect(daemon.isStarted()).toBe(true);

    await expect(daemon.stop()).resolves.toBeUndefined();
    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(daemon.isStarted()).toBe(false);
  });

  it("runs startup steps 1-3 in strict order", async () => {
    const order: string[] = [];
    const config = { dataDir: "/tmp/codex-im" };
    const storage = { path: "/tmp/codex-im/state.db" };
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn(),
    };
    const loadConfig = vi.fn(() => {
      order.push("loadConfig");
      return config;
    });
    const openStorage = vi.fn((receivedConfig: unknown) => {
      order.push("openStorage");
      expect(receivedConfig).toBe(config);
      return storage;
    });
    const createBroker = vi.fn((ctx: { config: unknown; storage: unknown }) => {
      order.push("createBroker");
      expect(ctx).toEqual({ config, storage });
      return broker;
    });
    const options: DaemonOptions = {
      loadConfig,
      openStorage,
      createBroker,
    };

    const daemon = new Daemon(options);
    expect(daemon.options).toBe(options);
    await daemon.start();

    expect(order.slice(0, 4)).toEqual([
      "loadConfig",
      "openStorage",
      "createBroker",
      "broker.attach",
    ]);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openStorage).toHaveBeenCalledTimes(1);
    expect(createBroker).toHaveBeenCalledTimes(1);
    expect(broker.attach).toHaveBeenCalledTimes(1);
  });

  it("enables pending mode for the core IM-routable approval registry after broker attach", async () => {
    const order: string[] = [];
    const broker = {
      enabled: [] as string[],
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
        broker.enabled.push(method);
      }),
    };
    const daemon = new Daemon({
      loadConfig: () => {
        order.push("loadConfig");
        return {};
      },
      openStorage: () => {
        order.push("openStorage");
        return {};
      },
      createBroker: () => {
        order.push("createBroker");
        return broker;
      },
    });

    await daemon.start();

    expect(order.slice(0, 4)).toEqual([
      "loadConfig",
      "openStorage",
      "createBroker",
      "broker.attach",
    ]);
    expect(broker.enabled).toEqual([...IM_ROUTABLE_APPROVAL_METHODS]);
    expect(order.indexOf("broker.attach")).toBeLessThan(
      order.indexOf(`pending:${broker.enabled[0]}`),
    );
  });

  it("revokes stale bound callback tokens before accepting adapter input on startup", async () => {
    const order: string[] = [];
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(() => {
        order.push("adapter.start");
      }),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      revokeBound: vi.fn(() => {
        order.push("callbackTokens.revokeBound");
        return [
          {
            tokenHash: "hash",
            approvalId: "approval-stale",
            action: "allow_once" as const,
            callbackNonce: "nonce",
            target: { platform: "telegram", chatId: "-100123456" },
            actor: { kind: "im" as const },
            status: "revoked" as const,
            createdAt: "2026-05-03T12:12:33.946Z",
            expiresAt: "2026-05-03T12:42:33.946Z",
          },
        ];
      }),
    };
    const audit = {
      insertBestEffort: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createAdapter: () => adapter,
      callbackTokenRepository,
      auditRepository: audit,
    });

    await daemon.start();

    expect(order).toEqual(["callbackTokens.revokeBound", "adapter.start"]);
    expect(audit.insertBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approval.callback_startup_revoked",
        approvalId: "approval-stale",
        result: "revoked",
      }),
    );
  });

  it("writes a local daemon status snapshot after successful startup", async () => {
    const now = new Date("2026-05-02T20:00:00.000Z");
    const target = { platform: "telegram", chatId: "-100status" };
    const snapshots: DaemonStatusSnapshot[] = [];
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      approvalRecordCount: vi.fn(() => 2),
    };
    const sessionRouter = {
      list: vi.fn(() => [
        { kind: "bound", target, projectId: "p1", cwd: "/repo", codexThreadId: "thread-1" },
        { kind: "bound", target, projectId: "p2", cwd: "/repo2" },
        { kind: "unbound", target },
      ]),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      writeStatusSnapshot: vi.fn((snapshot: DaemonStatusSnapshot) => {
        snapshots.push(snapshot);
      }),
      now: () => now,
    });

    await daemon.start();

    expect(snapshots).toEqual([
      {
        pid: process.pid,
        startedAt: "2026-05-02T20:00:00.000Z",
        currentCodexThreadCount: 1,
        pendingApprovalCount: 2,
        lastCodexSpawnAt: null,
        supervisorFailureCount: 0,
        lastFatal: null,
      },
    ]);
  });

  it("constructs SecurityPolicy, SessionRouter, and Supervisor after pending-mode setup", async () => {
    const order: string[] = [];
    const config = { dataDir: "/tmp/codex-im" };
    const storage = { path: "/tmp/codex-im/state.db" };
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
      }),
    };
    const securityPolicy = { kind: "policy" };
    const sessionRouter = { kind: "sessions" };
    const supervisor = { kind: "supervisor" };

    const daemon = new Daemon({
      loadConfig: () => {
        order.push("loadConfig");
        return config;
      },
      openStorage: () => {
        order.push("openStorage");
        return storage;
      },
      createBroker: () => {
        order.push("createBroker");
        return broker;
      },
      createSecurityPolicy: vi.fn((ctx: unknown) => {
        order.push("createSecurityPolicy");
        expect(ctx).toMatchObject({ config, storage, broker });
        return securityPolicy;
      }),
      createSessionRouter: vi.fn((ctx: unknown) => {
        order.push("createSessionRouter");
        expect(ctx).toMatchObject({ config, storage, broker, securityPolicy });
        return sessionRouter;
      }),
      createSupervisor: vi.fn((ctx: unknown) => {
        order.push("createSupervisor");
        expect(ctx).toMatchObject({ config, storage, broker, securityPolicy, sessionRouter });
        return supervisor;
      }),
    });

    await daemon.start();

    const lastPending = order.lastIndexOf(
      `pending:${IM_ROUTABLE_APPROVAL_METHODS[IM_ROUTABLE_APPROVAL_METHODS.length - 1]}`,
    );
    expect(lastPending).toBeGreaterThan(order.indexOf("broker.attach"));
    expect(order.slice(lastPending + 1)).toEqual([
      "createSecurityPolicy",
      "createSessionRouter",
      "createSupervisor",
    ]);
  });

  it("creates the adapter and subscribes pending/action/message wires without starting it", async () => {
    const order: string[] = [];
    const unsubscribers = {
      pending: vi.fn(),
      action: vi.fn(),
      message: vi.fn(),
    };
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
      }),
      onPendingCreated: vi.fn(() => {
        order.push("broker.onPendingCreated");
        return unsubscribers.pending;
      }),
    };
    const adapter = {
      onAction: vi.fn(() => {
        order.push("adapter.onAction");
        return unsubscribers.action;
      }),
      onMessage: vi.fn(() => {
        order.push("adapter.onMessage");
        return unsubscribers.message;
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => {
        order.push("loadConfig");
        return {};
      },
      openStorage: () => {
        order.push("openStorage");
        return {};
      },
      createBroker: () => {
        order.push("createBroker");
        return broker;
      },
      createSecurityPolicy: () => {
        order.push("createSecurityPolicy");
        return {};
      },
      createSessionRouter: () => {
        order.push("createSessionRouter");
        return {};
      },
      createSupervisor: () => {
        order.push("createSupervisor");
        return {};
      },
      createAdapter: vi.fn((ctx: unknown) => {
        order.push("createAdapter");
        expect(ctx).toMatchObject({ broker });
        return adapter;
      }),
    });

    await daemon.start();

    expect(order.slice(-4)).toEqual([
      "createAdapter",
      "broker.onPendingCreated",
      "adapter.onAction",
      "adapter.onMessage",
    ]);
  });

  it("wires onAction before adapter.start so an immediate inbound action reaches the handler", async () => {
    const order: string[] = [];
    const inboundAction = { rawCallbackData: "v1:test-token" };
    let actionHandler: ((action: unknown) => void) | undefined;
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
      }),
      onPendingCreated: vi.fn(() => {
        order.push("broker.onPendingCreated");
        return () => {};
      }),
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        order.push("adapter.onAction");
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => {
        order.push("adapter.onMessage");
        return () => {};
      }),
      start: vi.fn(() => {
        order.push("adapter.start");
        actionHandler?.(inboundAction);
        order.push("action.handler.fired");
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();

    expect(order.indexOf("adapter.onAction")).toBeLessThan(order.indexOf("adapter.start"));
    expect(order).toContain("action.handler.fired");
  });

  it("wires onMessage before adapter.start so an immediate inbound message reaches the handler", async () => {
    const order: string[] = [];
    const inboundMessage = { text: "/status" };
    let messageHandler: ((message: unknown) => void) | undefined;
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
      }),
      onPendingCreated: vi.fn(() => {
        order.push("broker.onPendingCreated");
        return () => {};
      }),
    };
    const adapter = {
      onAction: vi.fn(() => {
        order.push("adapter.onAction");
        return () => {};
      }),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        order.push("adapter.onMessage");
        messageHandler = handler;
        return () => {};
      }),
      start: vi.fn(() => {
        order.push("adapter.start");
        messageHandler?.(inboundMessage);
        order.push("message.handler.fired");
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();

    expect(order.indexOf("adapter.onMessage")).toBeLessThan(order.indexOf("adapter.start"));
    expect(order).toContain("message.handler.fired");
  });

  it("registers signal handlers before returning and starts the adapter last", async () => {
    const order: string[] = [];
    const signalHandlers = new Map<DaemonSignal, () => void>();
    const broker = {
      attach: vi.fn(() => {
        order.push("broker.attach");
      }),
      enablePendingMode: vi.fn((method: string) => {
        order.push(`pending:${method}`);
      }),
      onPendingCreated: vi.fn(() => {
        order.push("broker.onPendingCreated");
        return () => {};
      }),
    };
    const adapter = {
      onAction: vi.fn(() => {
        order.push("adapter.onAction");
        return () => {};
      }),
      onMessage: vi.fn(() => {
        order.push("adapter.onMessage");
        return () => {};
      }),
      start: vi.fn(() => {
        order.push("adapter.start");
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => {
        order.push("loadConfig");
        return {};
      },
      openStorage: () => {
        order.push("openStorage");
        return {};
      },
      createBroker: () => {
        order.push("createBroker");
        return broker;
      },
      createSecurityPolicy: () => {
        order.push("createSecurityPolicy");
        return {};
      },
      createSessionRouter: () => {
        order.push("createSessionRouter");
        return {};
      },
      createSupervisor: () => {
        order.push("createSupervisor");
        return {};
      },
      createAdapter: () => {
        order.push("createAdapter");
        return adapter;
      },
      registerSignalHandler: (signal, handler) => {
        order.push(`signal:${signal}`);
        signalHandlers.set(signal, handler);
        return () => {};
      },
    });

    await daemon.start();

    expect(order.at(-1)).toBe("adapter.start");
    expect(order.indexOf("signal:SIGTERM")).toBeLessThan(order.indexOf("adapter.start"));
    expect(order.indexOf("signal:SIGINT")).toBeLessThan(order.indexOf("adapter.start"));
    expect(signalHandlers.has("SIGTERM")).toBe(true);
    expect(signalHandlers.has("SIGINT")).toBe(true);
    expect(daemon.isStarted()).toBe(true);

    signalHandlers.get("SIGTERM")?.();
    await flushDaemonHandlers();

    expect(daemon.isStarted()).toBe(false);
  });

  it("stops in D37 order: pause inbound, fail pending, drain, supervisor, adapter, storage", async () => {
    const order: string[] = [];
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      failPendingAsTransportLost: vi.fn(() => {
        order.push("broker.failPendingAsTransportLost");
      }),
    };
    const storage = {
      close: vi.fn(() => {
        order.push("storage.close");
      }),
    };
    const supervisor = {
      stop: vi.fn(() => {
        order.push("supervisor.stop");
      }),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      pauseInbound: vi.fn(() => {
        order.push("adapter.pauseInbound");
      }),
      stop: vi.fn(() => {
        order.push("adapter.stop");
      }),
      start: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => storage,
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => supervisor,
      createAdapter: () => adapter,
    });

    await daemon.start();
    await daemon.stop();

    expect(order).toEqual([
      "adapter.pauseInbound",
      "broker.failPendingAsTransportLost",
      "supervisor.stop",
      "adapter.stop",
      "storage.close",
    ]);
    expect(daemon.isStarted()).toBe(false);
  });

  it("routes an allowed bound inbound prompt to runtime.turnStart and records the active turn", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const route = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-1",
      defaultModel: "gpt-test",
    };
    const sessionRouter = {
      resolve: vi.fn(() => route),
      bind: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-1" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "ship the T18 slice",
      messageRef: { target, messageId: "msg-1" },
      receivedAt: new Date("2026-05-02T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(sessionRouter.resolve).toHaveBeenCalledWith(target);
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-1",
      input: [{ type: "text", text: "ship the T18 slice", text_elements: [] }],
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(sessionRouter.bind).toHaveBeenCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-1",
      defaultModel: "gpt-test",
      activeTurnId: "turn-1",
    });
  });

  it("routes an allowed prompt with an active turn to runtime.turnSteer", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-1",
        activeTurnId: "turn-1",
      })),
      bind: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(() => ({ turnId: "turn-1" })),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "continue that",
      messageRef: { target, messageId: "msg-2" },
      receivedAt: new Date("2026-05-02T00:00:01.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.turnSteer).toHaveBeenCalledWith({
      threadId: "thread-1",
      input: [{ type: "text", text: "continue that", text_elements: [] }],
      expectedTurnId: "turn-1",
    });
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(sessionRouter.bind).not.toHaveBeenCalled();
  });

  it("starts a Codex thread before turnStart when the target has no thread binding", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const initialRoute = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
    };
    const threadRoute = {
      ...initialRoute,
      codexThreadId: "thread-created",
    };
    const sessionRouter = {
      resolve: vi.fn(() => initialRoute),
      bindThread: vi.fn(() => threadRoute),
      bind: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(() => ({ thread: { id: "thread-created" } })),
      turnStart: vi.fn(() => ({ turn: { id: "turn-created" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "start fresh",
      messageRef: { target, messageId: "msg-3" },
      receivedAt: new Date("2026-05-02T00:00:02.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.threadStart).toHaveBeenCalledWith({ cwd: "/repo/web" });
    expect(sessionRouter.bindThread).toHaveBeenCalledWith(target, "thread-created");
    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-created",
      input: [{ type: "text", text: "start fresh", text_elements: [] }],
      cwd: "/repo/web",
    });
    expect(sessionRouter.bind).toHaveBeenCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-created",
      activeTurnId: "turn-created",
    });
  });

  it("rebinds a fresh Codex thread when a restored thread cannot start a new turn", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    let currentRoute: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-stale",
      defaultModel: "gpt-test",
    };
    const sessionRouter = {
      resolve: vi.fn(() => currentRoute),
      bindThread: vi.fn((receivedTarget: typeof target, codexThreadId: string) => {
        currentRoute = { ...currentRoute, codexThreadId };
        expect(receivedTarget).toEqual(target);
        return currentRoute;
      }),
      bind: vi.fn(
        (
          receivedTarget: typeof target,
          input: {
            projectId: string;
            cwd: string;
            codexThreadId?: string;
            defaultModel?: string;
            activeTurnId?: string;
          },
        ) => {
          currentRoute = { kind: "bound" as const, target: receivedTarget, ...input };
          return currentRoute;
        },
      ),
    };
    const runtime = {
      threadStart: vi.fn(() => ({ thread: { id: "thread-fresh" } })),
      turnStart: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("thread not found");
        })
        .mockImplementationOnce(() => ({ turn: { id: "turn-fresh" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      sendText: vi.fn(() => ({ target, messageId: "work-1" })),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "summarize git status",
      messageRef: { target, messageId: "msg-stale" },
      receivedAt: new Date("2026-05-02T00:00:03.000Z"),
    });
    await flushDaemonHandlers();

    const input = [{ type: "text" as const, text: "summarize git status", text_elements: [] }];
    expect(runtime.turnStart).toHaveBeenNthCalledWith(1, {
      threadId: "thread-stale",
      input,
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(runtime.threadStart).toHaveBeenCalledWith({ cwd: "/repo/web", model: "gpt-test" });
    expect(sessionRouter.bindThread).toHaveBeenCalledWith(target, "thread-fresh");
    expect(runtime.turnStart).toHaveBeenNthCalledWith(2, {
      threadId: "thread-fresh",
      input,
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(sessionRouter.bind).toHaveBeenCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-fresh",
      defaultModel: "gpt-test",
      activeTurnId: "turn-fresh",
    });
    expect(adapter.sendText).toHaveBeenCalledWith(target, "Codex is working...");
  });

  it("fails closed before routing when SecurityPolicy denies the inbound sender", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-denied" };
    const sender = { userId: "u-mallory" };
    const sessionRouter = { resolve: vi.fn() };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "deny" as const, reason: "user_not_allowed" })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "should not route",
      messageRef: { target, messageId: "msg-denied" },
      receivedAt: new Date("2026-05-02T00:00:03.000Z"),
    });
    await flushDaemonHandlers();

    expect(sessionRouter.resolve).not.toHaveBeenCalled();
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(runtime.turnSteer).not.toHaveBeenCalled();
  });

  it("routes explicit /cu through prompt wrapping, session creation, audit, and broker tool gate", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    let dynamicToolHandler: DynamicToolCallHandler | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const route = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-cu",
    };
    const sessionRouter = {
      resolve: vi.fn(() => route),
      bind: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-cu" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const auditInserts: unknown[] = [];
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        computerUse: {
          enabled: true,
          defaultApp: "Google Chrome",
          allowedApps: ["Google Chrome"],
          denyApps: ["Keychain Access"],
          requireApprovalKeywords: ["login", "token"],
          liveSmokeEnabled: false,
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        registerDynamicToolCallHandler: vi.fn((handler: DynamicToolCallHandler) => {
          dynamicToolHandler = handler;
        }),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      auditRepository: { insertBestEffort: vi.fn((input) => auditInserts.push(input)) },
      computerUseProvider: new FakeComputerUseProvider({
        contentItems: [{ type: "inputText", text: "fake-cu-result" }],
        success: true,
      }),
      generateComputerUseSessionId: () => "cu-session-1",
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/cu summarize the visible page",
      messageRef: { target, messageId: "msg-cu" },
      receivedAt: new Date("2026-05-02T00:00:04.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-cu",
      input: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Computer Use was explicitly requested with /cu."),
        }),
      ],
      cwd: "/repo/web",
    });
    expect(runtime.turnSteer).not.toHaveBeenCalled();
    expect(sessionRouter.bind).toHaveBeenCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-cu",
      activeTurnId: "turn-cu",
    });
    expect(auditInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "computer_use.intent_created" }),
        expect.objectContaining({ action: "computer_use.prompt_wrapped" }),
      ]),
    );

    await expect(
      dynamicToolHandler?.({
        method: "item/tool/call",
        id: 1,
        params: {
          threadId: "thread-cu",
          turnId: "turn-cu",
          callId: "tool-call-cu",
          namespace: null,
          tool: "computer_use.synthetic",
          arguments: { action: "observe" },
        },
      }),
    ).resolves.toEqual({
      contentItems: [{ type: "inputText", text: "fake-cu-result" }],
      success: true,
    });
  });

  it("routes /cu status to a safe policy summary without starting Codex work", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        computerUse: {
          enabled: true,
          defaultApp: "Google Chrome",
          allowedApps: ["Google Chrome"],
          denyApps: ["Keychain Access"],
          requireApprovalKeywords: ["login", "token"],
          liveSmokeEnabled: false,
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({ resolve: vi.fn() }),
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/cu status",
      messageRef: { target, messageId: "msg-cu-status" },
      receivedAt: new Date("2026-05-02T00:00:05.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-cu-status" },
      expect.stringContaining("Computer Use: enabled"),
    );
    expect(JSON.stringify(adapter.editText.mock.calls)).toContain("Google Chrome");
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(runtime.turnSteer).not.toHaveBeenCalled();
  });

  it("preserves default Computer Use sensitive keywords when daemon receives partial config", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const route = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-cu",
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        computerUse: {
          enabled: true,
          defaultApp: "Google Chrome",
          allowedApps: ["Google Chrome"],
          liveSmokeEnabled: false,
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({ resolve: vi.fn(() => route) }),
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/cu click the login button",
      messageRef: { target, messageId: "msg-cu-sensitive" },
      receivedAt: new Date("2026-05-03T00:00:01.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-cu-sensitive" },
      expect.stringContaining("sensitive step"),
    );
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(runtime.turnSteer).not.toHaveBeenCalled();
  });

  it("does not wrap desktop-looking normal prompts as Computer Use", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const route = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-1",
    };
    const sessionRouter = {
      resolve: vi.fn(() => route),
      bind: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-normal" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "open Chrome and click the login button",
      messageRef: { target, messageId: "msg-normal-desktop" },
      receivedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-1",
      input: [
        {
          type: "text",
          text: "open Chrome and click the login button",
          text_elements: [],
        },
      ],
      cwd: "/repo/web",
    });
    expect(JSON.stringify(runtime.turnStart.mock.calls)).not.toContain(
      "Computer Use was explicitly requested",
    );
  });

  for (const [commandName, text] of [
    ["use", "/use web"],
    ["new", "/new release check"],
    ["switch", "/switch 1"],
    ["fork", "/fork"],
  ] as const) {
    it(`refuses /${commandName} while the IM target has an active turn`, async () => {
      let messageHandler: ((message: unknown) => void) | undefined;
      const target = { platform: "telegram", chatId: "-allowed" };
      const sender = { userId: "u-alice" };
      const sessionRouter = {
        resolve: vi.fn(() => ({
          kind: "bound" as const,
          target,
          projectId: "web",
          cwd: "/repo/web",
          codexThreadId: "thread-1",
          activeTurnId: "turn-1",
        })),
        bind: vi.fn(),
        bindThread: vi.fn(),
      };
      const runtime = {
        threadStart: vi.fn(),
        turnStart: vi.fn(),
        turnSteer: vi.fn(),
        turnInterrupt: vi.fn(),
      };
      const adapter = {
        onAction: vi.fn(() => () => {}),
        onMessage: vi.fn((handler: (message: unknown) => void) => {
          messageHandler = handler;
          return () => {};
        }),
        editText: vi.fn(),
      };

      const daemon = new Daemon({
        loadConfig: () => ({
          projects: {
            web: { cwd: "/repo/web" },
          },
        }),
        openStorage: () => ({}),
        createBroker: () => ({
          attach: vi.fn(),
          enablePendingMode: vi.fn(),
          listPending: vi.fn(() => []),
        }),
        createSecurityPolicy: () => ({
          checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
          checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
        }),
        createSessionRouter: () => sessionRouter,
        createSupervisor: () => ({ currentRuntime: () => runtime }),
        createAdapter: () => adapter,
      });

      await daemon.start();
      messageHandler?.({
        target,
        sender,
        text,
        messageRef: { target, messageId: `msg-${commandName}-active` },
        receivedAt: new Date("2026-05-03T00:00:00.000Z"),
      });
      await flushDaemonHandlers();

      expect(adapter.editText).toHaveBeenCalledWith(
        { target, messageId: `msg-${commandName}-active` },
        "Cannot change project or thread while a Codex turn is active. Send /stop first or wait for it to finish.",
      );
      expect(sessionRouter.bind).not.toHaveBeenCalled();
      expect(sessionRouter.bindThread).not.toHaveBeenCalled();
      expect(runtime.threadStart).not.toHaveBeenCalled();
      expect(runtime.turnStart).not.toHaveBeenCalled();
      expect(runtime.turnSteer).not.toHaveBeenCalled();
    });

    it(`refuses /${commandName} while any approval is pending`, async () => {
      let messageHandler: ((message: unknown) => void) | undefined;
      const target = { platform: "telegram", chatId: "-allowed" };
      const sender = { userId: "u-alice" };
      const pending: PendingApprovalSnapshot = {
        id: "approval-1",
        appServerRequestId: 1,
        method: "item/commandExecution/requestApproval",
        params: { command: "touch /tmp/file" },
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        expiresAt: new Date("2026-05-03T00:10:00.000Z"),
      };
      const sessionRouter = {
        resolve: vi.fn(() => ({
          kind: "bound" as const,
          target,
          projectId: "web",
          cwd: "/repo/web",
          codexThreadId: "thread-1",
        })),
        bind: vi.fn(),
        bindThread: vi.fn(),
      };
      const runtime = {
        threadStart: vi.fn(),
        turnStart: vi.fn(),
        turnSteer: vi.fn(),
        turnInterrupt: vi.fn(),
      };
      const adapter = {
        onAction: vi.fn(() => () => {}),
        onMessage: vi.fn((handler: (message: unknown) => void) => {
          messageHandler = handler;
          return () => {};
        }),
        editText: vi.fn(),
      };

      const daemon = new Daemon({
        loadConfig: () => ({
          projects: {
            web: { cwd: "/repo/web" },
          },
        }),
        openStorage: () => ({}),
        createBroker: () => ({
          attach: vi.fn(),
          enablePendingMode: vi.fn(),
          listPending: vi.fn(() => [pending]),
        }),
        createSecurityPolicy: () => ({
          checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
          checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
        }),
        createSessionRouter: () => sessionRouter,
        createSupervisor: () => ({ currentRuntime: () => runtime }),
        createAdapter: () => adapter,
      });

      await daemon.start();
      messageHandler?.({
        target,
        sender,
        text,
        messageRef: { target, messageId: `msg-${commandName}-pending` },
        receivedAt: new Date("2026-05-03T00:00:00.000Z"),
      });
      await flushDaemonHandlers();

      expect(adapter.editText).toHaveBeenCalledWith(
        { target, messageId: `msg-${commandName}-pending` },
        "Cannot change project or thread while an approval is pending. Resolve or decline the approval first.",
      );
      expect(sessionRouter.bind).not.toHaveBeenCalled();
      expect(sessionRouter.bindThread).not.toHaveBeenCalled();
      expect(runtime.threadStart).not.toHaveBeenCalled();
      expect(runtime.turnStart).not.toHaveBeenCalled();
      expect(runtime.turnSteer).not.toHaveBeenCalled();
    });
  }

  it("routes /help to the currently implemented IM control commands", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-100secret-chat" };
    const sender = { userId: "u-secret-user" };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          web: { cwd: "/Users/alice/private/project", defaultModel: "gpt-test" },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({ resolve: vi.fn(() => ({ kind: "unbound" as const, target })) }),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/help",
      messageRef: { target, messageId: "msg-help" },
      receivedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(body).toContain("/projects");
    expect(body).toContain("/use <project>");
    expect(body).toContain("/status");
    expect(body).toContain("/new [title]");
    expect(body).toContain("/threads [project]");
    expect(body).toContain("/switch <thread>");
    expect(body).toContain("/alias <title>");
    expect(body).toContain("/stop");
    expect(body).not.toContain("/fork");
    expect(body).not.toContain("-100secret-chat");
    expect(body).not.toContain("u-secret-user");
    expect(body).not.toContain("/Users/alice/private/project");
  });

  it("routes /projects to accessible configured projects without leaking local paths", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/Users/alice/private/web",
        codexThreadId: "thread-1",
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          web: { cwd: "/Users/alice/private/web", defaultModel: "gpt-test" },
          ops: { cwd: "/Users/alice/private/ops" },
          hidden: { cwd: "/Users/alice/private/hidden" },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn((projectId: string) =>
          projectId === "hidden"
            ? { kind: "deny" as const, reason: "project_not_allowed" }
            : { kind: "allow" as const },
        ),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/projects",
      messageRef: { target, messageId: "msg-projects" },
      receivedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-projects" },
      ["Projects:", "  ops", "* web (model gpt-test)"].join("\n"),
    );
    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(body).not.toContain("hidden");
    expect(body).not.toContain("/Users/alice/private");
    expect(body).not.toContain("-allowed");
  });

  it("routes /status to the current binding without leaking raw target or path data", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-100secret-chat", threadKey: "topic-secret" };
    const sender = { userId: "u-secret-user" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/Users/alice/private/web",
        codexThreadId: "thread-abcdefghijklmnopqrstuvwxyz",
        activeTurnId: "turn-1234567890abcdef",
      })),
    };
    const pending: PendingApprovalSnapshot = {
      id: "approval-1",
      appServerRequestId: 1,
      method: "item/commandExecution/requestApproval",
      params: { command: "touch /tmp/file" },
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      expiresAt: new Date("2026-05-03T00:10:00.000Z"),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => [pending, pending]),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/status",
      messageRef: { target, messageId: "msg-status" },
      receivedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(body).toContain("target: telegram thread");
    expect(body).toContain("binding: bound");
    expect(body).toContain("project: web");
    expect(body).toContain("thread: thread-abcde...");
    expect(body).toContain("active turn: turn-1234567...");
    expect(body).toContain("pending approvals: 2");
    expect(body).not.toContain("-100secret-chat");
    expect(body).not.toContain("u-secret-user");
    expect(body).not.toContain("/Users/alice/private/web");
    expect(body).not.toContain("thread-abcdefghijklmnopqrstuvwxyz");
    expect(body).not.toContain("turn-1234567890abcdef");
  });

  it("routes /status for an unbound target", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-100secret-chat" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({ kind: "unbound" as const, target })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        approvalRecordCount: vi.fn(() => 1),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/status",
      messageRef: { target, messageId: "msg-unbound-status" },
      receivedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    await flushDaemonHandlers();

    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(body).toContain("target: telegram chat");
    expect(body).toContain("binding: unbound");
    expect(body).toContain("pending approvals: 1");
    expect(body).not.toContain("-100secret-chat");
  });

  it("routes /status with the current thread alias when available", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-100secret-chat" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/Users/alice/private/web",
        codexThreadId: "thread-with-title-abcdefghijklmnopqrstuvwxyz",
      })),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      findByTargetAndThread: vi.fn(() => ({
        id: "ts-title",
        target,
        projectId: "web",
        codexThreadId: "thread-with-title-abcdefghijklmnopqrstuvwxyz",
        title: "Release\nstatus",
        status: "open" as const,
        createdAt: "2026-05-03T10:00:00.000Z",
        updatedAt: "2026-05-03T11:00:00.000Z",
        lastUsedAt: "2026-05-03T11:00:00.000Z",
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/status",
      messageRef: { target, messageId: "msg-status-title" },
      receivedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    await flushDaemonHandlers();

    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(threadSessionRepository.findByTargetAndThread).toHaveBeenCalledWith(
      target,
      "thread-with-title-abcdefghijklmnopqrstuvwxyz",
    );
    expect(body).toContain("title: Release status");
    expect(body).not.toContain("Release\nstatus");
    expect(body).not.toContain("thread-with-title-abcdefghijklmnopqrstuvwxyz");
    expect(body).not.toContain("/Users/alice/private/web");
  });

  it("routes /new to threadStart, durable thread session upsert, and current binding update", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const now = new Date("2026-05-03T12:00:00.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        defaultModel: "gpt-test",
        codexThreadId: "thread-old",
      })),
      bindThread: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        defaultModel: "gpt-test",
        codexThreadId: "thread-created-1234567890",
      })),
    };
    const runtime = {
      threadStart: vi.fn(() => ({ thread: { id: "thread-created-1234567890" } })),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(() => ({
        id: "ts-created",
        target,
        projectId: "web",
        codexThreadId: "thread-created-1234567890",
        title: "Release check",
        status: "open" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => now,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/new Release check",
      messageRef: { target, messageId: "msg-new" },
      receivedAt: now,
    });
    await flushDaemonHandlers();

    expect(runtime.threadStart).toHaveBeenCalledWith({
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(threadSessionRepository.upsert).toHaveBeenCalledWith({
      target,
      projectId: "web",
      codexThreadId: "thread-created-1234567890",
      title: "Release check",
      now: "2026-05-03T12:00:00.000Z",
    });
    expect(sessionRouter.bindThread).toHaveBeenCalledWith(target, "thread-created-1234567890");
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-new" },
      "New Codex thread thread-creat... - Release check",
    );
  });

  it("refuses /new before the target is bound to a project", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({ kind: "unbound" as const, target })),
      bindThread: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = { upsert: vi.fn() };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/new",
      messageRef: { target, messageId: "msg-new-unbound" },
      receivedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-new-unbound" },
      "No project selected. Send /use <project> first.",
    );
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(threadSessionRepository.upsert).not.toHaveBeenCalled();
    expect(sessionRouter.bindThread).not.toHaveBeenCalled();
  });

  it("does not change current binding when /new thread session persistence fails", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
      })),
      bindThread: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(() => ({ thread: { id: "thread-created" } })),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(() => {
        throw new Error("sqlite busy");
      }),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/new",
      messageRef: { target, messageId: "msg-new-save-fail" },
      receivedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.threadStart).toHaveBeenCalledTimes(1);
    expect(threadSessionRepository.upsert).toHaveBeenCalledTimes(1);
    expect(sessionRouter.bindThread).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-new-save-fail" },
      "Codex thread failed to save.",
    );
  });

  it("best-effort records auto-created prompt threads when storage is available", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const now = new Date("2026-05-03T12:15:00.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const initialRoute = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
    };
    const sessionRouter = {
      resolve: vi.fn(() => initialRoute),
      bind: vi.fn(),
      bindThread: vi.fn(() => ({
        ...initialRoute,
        codexThreadId: "thread-created",
      })),
    };
    const runtime = {
      threadStart: vi.fn(() => ({ thread: { id: "thread-created" } })),
      turnStart: vi.fn(() => ({ turn: { id: "turn-created" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(() => ({
        id: "ts-created",
        target,
        projectId: "web",
        codexThreadId: "thread-created",
        status: "open" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => now,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "start the next task",
      messageRef: { target, messageId: "msg-prompt-new-thread" },
      receivedAt: now,
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.upsert).toHaveBeenCalledWith({
      target,
      projectId: "web",
      codexThreadId: "thread-created",
      now: "2026-05-03T12:15:00.000Z",
    });
    expect(sessionRouter.bindThread).toHaveBeenCalledWith(target, "thread-created");
    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-created",
      input: [{ type: "text", text: "start the next task", text_elements: [] }],
      cwd: "/repo/web",
    });
  });

  it("routes /threads to redacted known Codex thread selectors", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-100secret-chat" };
    const sender = { userId: "u-secret-user" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/Users/alice/private/web",
        codexThreadId: "thread-current-abcdefghijklmnopqrstuvwxyz",
      })),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      listForTarget: vi.fn(() => [
        {
          id: "ts-current",
          target,
          projectId: "web",
          codexThreadId: "thread-current-abcdefghijklmnopqrstuvwxyz",
          title: "Release \n check",
          status: "open" as const,
          createdAt: "2026-05-03T10:00:00.000Z",
          updatedAt: "2026-05-03T10:00:00.000Z",
          lastUsedAt: "2026-05-03T12:00:00.000Z",
        },
        {
          id: "ts-api",
          target,
          projectId: "api",
          codexThreadId: "thread-api-abcdefghijklmnopqrstuvwxyz",
          status: "open" as const,
          createdAt: "2026-05-03T09:00:00.000Z",
          updatedAt: "2026-05-03T09:00:00.000Z",
          lastUsedAt: "2026-05-03T11:00:00.000Z",
        },
        {
          id: "ts-hidden",
          target,
          projectId: "hidden",
          codexThreadId: "thread-hidden-abcdefghijklmnopqrstuvwxyz",
          status: "open" as const,
          createdAt: "2026-05-03T08:00:00.000Z",
          updatedAt: "2026-05-03T08:00:00.000Z",
          lastUsedAt: "2026-05-03T10:00:00.000Z",
        },
      ]),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn((projectId: string) =>
          projectId === "hidden"
            ? { kind: "deny" as const, reason: "project_not_allowed" }
            : { kind: "allow" as const },
        ),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/threads",
      messageRef: { target, messageId: "msg-threads" },
      receivedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.listForTarget).toHaveBeenCalledWith(target, {
      limit: 20,
    });
    const [, body] = adapter.editText.mock.calls[0] as [unknown, string];
    expect(body).toContain("Threads:");
    expect(body).toContain("* 1 web Release check (thread-curre...) last 2026-05-03T12:00:00.000Z");
    expect(body).toContain("  2 api (thread-api-a...) last 2026-05-03T11:00:00.000Z");
    expect(body).not.toContain("hidden");
    expect(body).not.toContain("-100secret-chat");
    expect(body).not.toContain("u-secret-user");
    expect(body).not.toContain("/Users/alice/private/web");
    expect(body).not.toContain("thread-current-abcdefghijklmnopqrstuvwxyz");
    expect(body).not.toContain("thread-api-abcdefghijklmnopqrstuvwxyz");
  });

  it("routes /threads with a project filter through project access policy", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const threadSessionRepository = {
      upsert: vi.fn(),
      listForTarget: vi.fn(() => []),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({
          kind: "deny" as const,
          reason: "project_not_allowed",
        })),
      }),
      createSessionRouter: () => ({ resolve: vi.fn(() => ({ kind: "unbound" as const, target })) }),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/threads hidden",
      messageRef: { target, messageId: "msg-threads-denied" },
      receivedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-threads-denied" },
      "Project access denied",
    );
    expect(threadSessionRepository.listForTarget).not.toHaveBeenCalled();
  });

  it("routes /switch through threadResume before atomic storage switch and cache update", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const order: string[] = [];
    const now = new Date("2026-05-03T12:30:00.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const selectedThread = {
      id: "ts-selected",
      target,
      projectId: "web",
      codexThreadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
      title: "Selected thread",
      status: "open" as const,
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-03T11:00:00.000Z",
      lastUsedAt: "2026-05-03T11:00:00.000Z",
    };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-old",
      })),
      replaceCachedBinding: vi.fn(() => {
        order.push("cache.replace");
        return {
          kind: "bound" as const,
          target,
          projectId: "web",
          cwd: "/repo/web",
          defaultModel: "gpt-test",
          codexThreadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
        };
      }),
    };
    const runtime = {
      threadStart: vi.fn(),
      threadResume: vi.fn(() => {
        order.push("runtime.resume");
        return { thread: { id: "thread-selected-abcdefghijklmnopqrstuvwxyz" } };
      }),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      listForTarget: vi.fn(() => [selectedThread]),
      switchCurrent: vi.fn(() => {
        order.push("storage.switch");
        return {
          binding: {
            id: "tb-selected",
            target,
            projectId: "web",
            cwd: "/repo/web",
            defaultModel: "gpt-test",
            codexThreadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
          session: {
            ...selectedThread,
            lastUsedAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        };
      }),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          web: { cwd: "/repo/web", defaultModel: "gpt-test" },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => now,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/switch 1",
      messageRef: { target, messageId: "msg-switch" },
      receivedAt: now,
    });
    await flushDaemonHandlers();

    expect(order).toEqual(["runtime.resume", "storage.switch", "cache.replace"]);
    expect(runtime.threadResume).toHaveBeenCalledWith({
      threadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
      cwd: "/repo/web",
      model: "gpt-test",
      excludeTurns: true,
    });
    expect(threadSessionRepository.switchCurrent).toHaveBeenCalledWith({
      target,
      projectId: "web",
      codexThreadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
      cwd: "/repo/web",
      defaultModel: "gpt-test",
      now: "2026-05-03T12:30:00.000Z",
    });
    expect(sessionRouter.replaceCachedBinding).toHaveBeenCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-selected-abcdefghijklmnopqrstuvwxyz",
      defaultModel: "gpt-test",
    });
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-switch" },
      "Switched to 1 web (thread-selec...)",
    );
  });

  it("keeps current binding unchanged when /switch threadResume fails", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const selectedThread = {
      id: "ts-selected",
      target,
      projectId: "web",
      codexThreadId: "thread-selected",
      status: "open" as const,
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-03T11:00:00.000Z",
      lastUsedAt: "2026-05-03T11:00:00.000Z",
    };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-old",
      })),
      replaceCachedBinding: vi.fn(),
    };
    const runtime = {
      threadStart: vi.fn(),
      threadResume: vi.fn(() => {
        throw new Error("not found");
      }),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      listForTarget: vi.fn(() => [selectedThread]),
      switchCurrent: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          web: { cwd: "/repo/web" },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/switch 1",
      messageRef: { target, messageId: "msg-switch-fail" },
      receivedAt: new Date("2026-05-03T12:30:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.switchCurrent).not.toHaveBeenCalled();
    expect(sessionRouter.replaceCachedBinding).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-switch-fail" },
      "Codex thread failed to resume.",
    );
  });

  it("rejects ambiguous /switch thread id prefixes", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const records = ["thread-same-1", "thread-same-2"].map((codexThreadId, index) => ({
      id: `ts-${index}`,
      target,
      projectId: "web",
      codexThreadId,
      status: "open" as const,
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-03T11:00:00.000Z",
      lastUsedAt: "2026-05-03T11:00:00.000Z",
    }));
    const runtime = {
      threadStart: vi.fn(),
      threadResume: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      listForTarget: vi.fn(() => records),
      switchCurrent: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({
        projects: {
          web: { cwd: "/repo/web" },
        },
      }),
      openStorage: () => ({}),
      createBroker: () => ({
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        listPending: vi.fn(() => []),
      }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({
        resolve: vi.fn(() => ({ kind: "unbound" as const, target })),
        replaceCachedBinding: vi.fn(),
      }),
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/switch thread-same",
      messageRef: { target, messageId: "msg-switch-ambiguous" },
      receivedAt: new Date("2026-05-03T12:30:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.threadResume).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-switch-ambiguous" },
      "Ambiguous thread selector. Use the number from /threads.",
    );
  });

  it("routes /alias to local thread-session metadata only", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const now = new Date("2026-05-03T13:00:00.000Z");
    const target = { platform: "telegram", chatId: "-100secret-chat" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/Users/alice/private/web",
        codexThreadId: "thread-current-abcdefghijklmnopqrstuvwxyz",
      })),
    };
    const runtime = {
      threadStart: vi.fn(),
      threadResume: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const threadSessionRepository = {
      upsert: vi.fn(),
      rename: vi.fn(() => ({
        id: "ts-current",
        target,
        projectId: "web",
        codexThreadId: "thread-current-abcdefghijklmnopqrstuvwxyz",
        title: "Release alias",
        status: "open" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => now,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/alias Release\nalias",
      messageRef: { target, messageId: "msg-alias" },
      receivedAt: now,
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.rename).toHaveBeenCalledWith(
      target,
      "thread-current-abcdefghijklmnopqrstuvwxyz",
      "Release alias",
      "2026-05-03T13:00:00.000Z",
    );
    expect(threadSessionRepository.upsert).not.toHaveBeenCalled();
    expect(runtime.threadStart).not.toHaveBeenCalled();
    expect(runtime.threadResume).not.toHaveBeenCalled();
    expect(runtime.turnStart).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-alias" },
      "Thread alias set: Release alias",
    );
  });

  it("upserts /alias metadata when the current thread was not in thread_sessions yet", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const now = new Date("2026-05-03T13:05:00.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-current",
      })),
    };
    const threadSessionRepository = {
      rename: vi.fn(() => undefined),
      upsert: vi.fn(() => ({
        id: "ts-current",
        target,
        projectId: "web",
        codexThreadId: "thread-current",
        title: "Recovered alias",
        status: "open" as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      threadSessionRepository,
      now: () => now,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/alias Recovered alias",
      messageRef: { target, messageId: "msg-alias-upsert" },
      receivedAt: now,
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.upsert).toHaveBeenCalledWith({
      target,
      projectId: "web",
      codexThreadId: "thread-current",
      title: "Recovered alias",
      now: "2026-05-03T13:05:00.000Z",
    });
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-alias-upsert" },
      "Thread alias set: Recovered alias",
    );
  });

  it("refuses /alias without a current Codex thread", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const threadSessionRepository = {
      upsert: vi.fn(),
      rename: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({
        resolve: vi.fn(() => ({ kind: "unbound" as const, target })),
      }),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      threadSessionRepository,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/alias Missing",
      messageRef: { target, messageId: "msg-alias-missing" },
      receivedAt: new Date("2026-05-03T13:10:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(threadSessionRepository.rename).not.toHaveBeenCalled();
    expect(threadSessionRepository.upsert).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-alias-missing" },
      "No current Codex thread.",
    );
  });

  it("routes /stop to turnInterrupt when the session has an active turn", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    let currentRoute: Extract<SessionRoute, { kind: "bound" }> = {
      kind: "bound" as const,
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-1",
    };
    const sessionRouter = {
      resolve: vi.fn(() => currentRoute),
      bind: vi.fn(
        (
          receivedTarget: typeof target,
          input: {
            projectId: string;
            cwd: string;
            codexThreadId?: string;
            defaultModel?: string;
            activeTurnId?: string;
          },
        ) => {
          currentRoute = { kind: "bound" as const, target: receivedTarget, ...input };
          return currentRoute;
        },
      ),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-1" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(() => ({})),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      sendText: vi.fn(() => ({ target, messageId: "work-1" })),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "run a long task",
      messageRef: { target, messageId: "msg-start" },
      receivedAt: new Date("2026-05-02T00:00:04.000Z"),
    });
    await flushDaemonHandlers();

    expect(adapter.sendText).toHaveBeenCalledWith(target, "Codex is working...");

    messageHandler?.({
      target,
      sender,
      text: "/stop",
      messageRef: { target, messageId: "msg-stop" },
      receivedAt: new Date("2026-05-02T00:00:05.000Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.turnInterrupt).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
    });
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "work-1" },
      "Codex turn interrupted.",
    );
    expect(sessionRouter.bind).toHaveBeenLastCalledWith(target, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-1",
    });
    expect(runtime.turnStart).toHaveBeenCalledTimes(1);
    expect(runtime.turnSteer).not.toHaveBeenCalled();
  });

  it("replies clearly when /stop has no active Codex turn", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-1",
      })),
    };
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/stop",
      messageRef: { target, messageId: "msg-stop-idle" },
      receivedAt: new Date("2026-05-02T00:00:05.500Z"),
    });
    await flushDaemonHandlers();

    expect(runtime.turnInterrupt).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(
      { target, messageId: "msg-stop-idle" },
      "No active Codex turn.",
    );
  });

  it("rebuilds the default SessionRouter from SQLite bindings during daemon startup", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const db = openDatabase(":memory:");
    runMigrations(db, STORAGE_MIGRATIONS_DIR);
    new BindingRepository(db).upsert({
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-restored",
    });
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-restored" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
    };

    try {
      const daemon = new Daemon({
        loadConfig: () => ({ projects: { web: { cwd: "/repo/web" } } }),
        openStorage: () => db,
        createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
        createSecurityPolicy: () => ({
          checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        }),
        createSupervisor: () => ({ currentRuntime: () => runtime }),
        createAdapter: () => adapter,
      });

      await daemon.start();
      messageHandler?.({
        target,
        sender,
        text: "continue after restart",
        messageRef: { target, messageId: "msg-restored" },
        receivedAt: new Date("2026-05-02T00:00:06.000Z"),
      });
      await flushDaemonHandlers();

      expect(runtime.threadStart).not.toHaveBeenCalled();
      expect(runtime.turnStart).toHaveBeenCalledWith({
        threadId: "thread-restored",
        input: [{ type: "text", text: "continue after restart", text_elements: [] }],
        cwd: "/repo/web",
      });
    } finally {
      db.close();
    }
  });

  it("does not route prompts from restored bindings when project ACL denies the target", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const db = openDatabase(":memory:");
    runMigrations(db, STORAGE_MIGRATIONS_DIR);
    new BindingRepository(db).upsert({
      target,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-restored",
    });
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    try {
      const daemon = new Daemon({
        loadConfig: () => ({ projects: { web: { cwd: "/repo/web" } } }),
        openStorage: () => db,
        createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
        createSecurityPolicy: () => ({
          checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
          checkProjectAccess: vi.fn(() => ({
            kind: "deny" as const,
            reason: "project_user_not_allowed",
          })),
        }),
        createSupervisor: () => ({ currentRuntime: () => runtime }),
        createAdapter: () => adapter,
      });

      await daemon.start();
      messageHandler?.({
        target,
        sender,
        text: "continue after restart",
        messageRef: { target, messageId: "msg-restored" },
        receivedAt: new Date("2026-05-02T00:00:06.000Z"),
      });
      await flushDaemonHandlers();

      expect(runtime.threadStart).not.toHaveBeenCalled();
      expect(runtime.turnStart).not.toHaveBeenCalled();
      expect(runtime.turnSteer).not.toHaveBeenCalled();
      expect(adapter.editText).toHaveBeenCalledWith(
        { target, messageId: "msg-restored" },
        "Project access denied",
      );
    } finally {
      db.close();
    }
  });

  it("binds /use to a configured project before acknowledging the inbound message", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const messageRef = { target, messageId: "msg-use" };
    const bindings = {
      upsert: vi.fn((input) => ({
        id: "binding-use",
        target: input.target,
        projectId: input.projectId,
        cwd: input.cwd,
        createdAt: "2026-05-02T00:00:07.000Z",
        updatedAt: "2026-05-02T00:00:07.000Z",
      })),
      findByTarget: vi.fn(),
    };
    const sessionRouter = new SessionRouter({ bindings });
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { web: { cwd: "/repo/web" } } }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => undefined }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/use web",
      messageRef,
      receivedAt: new Date("2026-05-02T00:00:07.000Z"),
    });
    await flushDaemonHandlers();

    expect(bindings.upsert).toHaveBeenCalledWith({
      target,
      projectId: "web",
      cwd: "/repo/web",
    });
    expect(adapter.editText).toHaveBeenCalledWith(messageRef, "Using project web");
    expect(sessionRouter.resolve(target)).toMatchObject({
      kind: "bound",
      target,
      projectId: "web",
      cwd: "/repo/web",
    });
  });

  it("does not bind /use when project ACL denies a globally allowed user/chat", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const messageRef = { target, messageId: "msg-use-denied" };
    const bindings = {
      upsert: vi.fn(),
      findByTarget: vi.fn(),
    };
    const sessionRouter = new SessionRouter({ bindings });
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { web: { cwd: "/repo/web" } } }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        checkProjectAccess: vi.fn(() => ({
          kind: "deny" as const,
          reason: "project_chat_not_allowed",
        })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => undefined }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/use web",
      messageRef,
      receivedAt: new Date("2026-05-02T00:00:07.000Z"),
    });
    await flushDaemonHandlers();

    expect(bindings.upsert).not.toHaveBeenCalled();
    expect(adapter.editText).toHaveBeenCalledWith(messageRef, "Project access denied");
    expect(sessionRouter.resolve(target)).toEqual({ kind: "unbound", target });
  });

  it("reports /use storage write failure without optimistic SessionRouter cache update", async () => {
    let messageHandler: ((message: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const messageRef = { target, messageId: "msg-use-fail" };
    const bindings = {
      upsert: vi.fn(() => {
        throw new Error("disk full");
      }),
      findByTarget: vi.fn(() => undefined),
    };
    const sessionRouter = new SessionRouter({ bindings });
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: (message: unknown) => void) => {
        messageHandler = handler;
        return () => {};
      }),
      editText: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({ projects: { web: { cwd: "/repo/web" } } }),
      openStorage: () => ({}),
      createBroker: () => ({ attach: vi.fn(), enablePendingMode: vi.fn() }),
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => undefined }),
      createAdapter: () => adapter,
    });

    await daemon.start();
    messageHandler?.({
      target,
      sender,
      text: "/use web",
      messageRef,
      receivedAt: new Date("2026-05-02T00:00:08.000Z"),
    });
    await flushDaemonHandlers();

    expect(bindings.upsert).toHaveBeenCalledWith({
      target,
      projectId: "web",
      cwd: "/repo/web",
    });
    expect(adapter.editText).toHaveBeenCalledWith(
      messageRef,
      "Failed to bind project web: storage write failed",
    );
    expect(sessionRouter.resolve(target)).toEqual({ kind: "unbound", target });
  });

  it("auto-declines policy-denied pending approvals through broker.resolve after binding", async () => {
    const order: string[] = [];
    const target = { platform: "telegram", chatId: "-denied" };
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-denied",
      appServerRequestId: 9001,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    let bound = false;
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => {
        order.push("bindActorPolicy");
        bound = true;
        return { kind: "ok" as const };
      }),
      resolve: vi.fn(async () => {
        order.push(bound ? "resolve.bound" : "resolve.binding_required");
        return { kind: "ok" as const, appliedAt: new Date("2026-05-02T00:00:01.000Z") };
      }),
    };
    const securityPolicy = {
      checkApprovalDestination: vi.fn(() => ({
        kind: "auto_decline" as const,
        reason: "approval_destination_denied",
      })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => securityPolicy,
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      generateCallbackNonce: () => "nonce-policy-decline",
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(securityPolicy.checkApprovalDestination).toHaveBeenCalledWith(snapshot, target);
    expect(broker.bindActorPolicy).toHaveBeenCalledWith(snapshot.id, {
      allowedActors: [{ kind: "system", reason: "policy_auto_decline" }],
      target,
      callbackNonce: "nonce-policy-decline",
    });
    expect(broker.resolve).toHaveBeenCalledWith({
      approvalId: snapshot.id,
      decision: { kind: "decline" },
      actor: { kind: "system", reason: "policy_auto_decline" },
      target,
      callbackNonce: "nonce-policy-decline",
    });
    expect(order).toEqual(["bindActorPolicy", "resolve.bound"]);
  });

  it("leaves allowed pending approvals for the later tokenized send-card flow", async () => {
    const target = { platform: "telegram", chatId: "-allowed" };
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-allowed",
      appServerRequestId: 9002,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(),
      resolve: vi.fn(),
    };
    const securityPolicy = {
      checkApprovalDestination: vi.fn(() => ({ kind: "allow" as const })),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => securityPolicy,
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => ({
        onAction: () => () => {},
        onMessage: () => () => {},
      }),
      resolveApprovalTarget: vi.fn(() => target),
      generateCallbackNonce: () => "unused-for-allow",
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(securityPolicy.checkApprovalDestination).toHaveBeenCalledWith(snapshot, target);
    expect(broker.bindActorPolicy).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("auto-declines deny-pattern command approvals before token issue or rendering", async () => {
    const target = { platform: "telegram", chatId: "-allowed" };
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-command-denied",
      appServerRequestId: 9003,
      method: "item/commandExecution/requestApproval",
      params: { command: "rm -rf /tmp/project", cwd: "/repo/web" },
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => ({ kind: "ok" as const })),
      resolve: vi.fn(() => ({ kind: "ok" as const, appliedAt: new Date() })),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      casUpdate: vi.fn(),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      sendCard: vi.fn(),
    };
    const securityPolicy = {
      checkApprovalDestination: vi.fn(() => ({ kind: "allow" as const })),
      checkCommand: vi.fn(() => ({ kind: "deny" as const, reason: "command_denied" })),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => securityPolicy,
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalAllowedActors: vi.fn(() => [
        { kind: "im" as const, platform: "telegram", userId: "u" },
      ]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-command-denied",
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(securityPolicy.checkApprovalDestination).toHaveBeenCalledWith(snapshot, target);
    expect(securityPolicy.checkCommand).toHaveBeenCalledWith("rm -rf /tmp/project", "/repo/web");
    expect(broker.bindActorPolicy).toHaveBeenCalledWith(snapshot.id, {
      allowedActors: [{ kind: "system", reason: "security_policy_command_denied" }],
      target,
      callbackNonce: "nonce-command-denied",
    });
    expect(broker.resolve).toHaveBeenCalledWith({
      approvalId: snapshot.id,
      decision: { kind: "decline" },
      actor: { kind: "system", reason: "security_policy_command_denied" },
      target,
      callbackNonce: "nonce-command-denied",
    });
    expect(callbackTokenRepository.insert).not.toHaveBeenCalled();
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(adapter.sendCard).not.toHaveBeenCalled();
  });

  it("issues hash-only callback token rows for allowed approval actions before remote send", async () => {
    const order: string[] = [];
    const inserted: CallbackTokenInsert[] = [];
    const target = { platform: "telegram", chatId: "-allowed" };
    const rawTokens = [
      "ABCDEFGHIJKLMNOP",
      "QRSTUVWXYZ234567",
      "ABCDEFGH234567AA",
      "QRSTUVWXABCDEFGH",
    ];
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-tokenized",
      appServerRequestId: 9003,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(),
      resolve: vi.fn(),
    };
    const securityPolicy = {
      checkApprovalDestination: vi.fn(() => ({ kind: "allow" as const })),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
      sendCard: vi.fn(() => {
        order.push("sendCard");
        return { messageRef: { target, messageId: "msg-tokenized" }, callbackNonce: "legacy" };
      }),
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => {
        order.push(`insert:${input.action}`);
        inserted.push(input);
        return { ...input, status: input.status ?? "issued" };
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => securityPolicy,
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalActions: vi.fn(() => ["allow_once", "decline"] as const),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-issued",
      generateRawCallbackToken: () => rawTokens.shift() as string,
      now: () => new Date("2026-05-02T00:00:02.000Z"),
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["insert:allow_once", "insert:decline"]);
    expect(inserted).toEqual([
      {
        tokenHash: hashCallbackToken("ABCDEFGHIJKLMNOP"),
        approvalId: snapshot.id,
        action: "allow_once",
        callbackNonce: "nonce-issued",
        target,
        actor: { kind: "im" },
        status: "issued",
        createdAt: "2026-05-02T00:00:02.000Z",
        expiresAt: "2026-05-02T00:30:00.000Z",
      },
      {
        tokenHash: hashCallbackToken("QRSTUVWXYZ234567"),
        approvalId: snapshot.id,
        action: "decline",
        callbackNonce: "nonce-issued",
        target,
        actor: { kind: "im" },
        status: "issued",
        createdAt: "2026-05-02T00:00:02.000Z",
        expiresAt: "2026-05-02T00:30:00.000Z",
      },
    ]);
    expect(JSON.stringify(inserted)).not.toContain("ABCDEFGHIJKLMNOP");
    expect(JSON.stringify(inserted)).not.toContain("QRSTUVWXYZ234567");
    expect(adapter.sendCard).not.toHaveBeenCalled();
    expect(broker.bindActorPolicy).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("binds actor policy after token issue and before any remote send", async () => {
    const order: string[] = [];
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-bind-before-send",
      appServerRequestId: 9004,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
      sendCard: vi.fn(() => {
        order.push("sendCard");
        return {
          messageRef: { target, messageId: "msg-bind-before-send" },
          callbackNonce: "legacy",
        };
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => {
        order.push("bindActorPolicy");
        expect(adapter.sendCard).not.toHaveBeenCalled();
        return { kind: "ok" as const };
      }),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => {
        order.push(`insert:${input.action}`);
        return { ...input, status: input.status ?? "issued" };
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalActions: vi.fn(() => ["allow_once", "decline"] as const),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-bind-before-send",
      generateRawCallbackToken: () => "ABCDEFGHIJKLMNOP",
      now: () => new Date("2026-05-02T00:00:02.000Z"),
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["insert:allow_once", "insert:decline", "bindActorPolicy", "sendCard"]);
    expect(broker.bindActorPolicy).toHaveBeenCalledWith(snapshot.id, {
      allowedActors: [actor],
      target,
      callbackNonce: "nonce-bind-before-send",
    });
    expect(adapter.sendCard).toHaveBeenCalledTimes(1);
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("renders approval card actions with v1 wirePayload values from issued raw tokens", async () => {
    const order: string[] = [];
    const readyCards: Array<{ target: { platform: string; chatId: string }; card: ApprovalCard }> =
      [];
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const rawTokens = [
      "ABCDEFGHIJKLMNOP",
      "QRSTUVWXYZ234567",
      "ABCDEFGH234567AA",
      "QRSTUVWXABCDEFGH",
    ];
    const inserted: CallbackTokenInsert[] = [];
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-wire-payload",
      appServerRequestId: 9005,
      method: "item/fileChange/requestApproval",
      params: { changes: [{ path: "src/app.ts" }] },
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
      sendCard: vi.fn(() => {
        order.push("sendCard");
        return { messageRef: { target, messageId: "msg-wire-payload" }, callbackNonce: "legacy" };
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => {
        order.push("bindActorPolicy");
        return { kind: "ok" as const };
      }),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => {
        order.push(`insert:${input.action}`);
        inserted.push(input);
        return { ...input, status: input.status ?? "issued" };
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-wire-payload",
      generateRawCallbackToken: () => rawTokens.shift() as string,
      now: () => new Date("2026-05-02T00:00:02.000Z"),
      onApprovalCardReady: vi.fn((cardTarget, card) => {
        order.push("cardReady");
        expect(adapter.sendCard).not.toHaveBeenCalled();
        readyCards.push({ target: cardTarget, card });
      }),
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual([
      "insert:allow_once",
      "insert:allow_session",
      "insert:decline",
      "insert:abort",
      "bindActorPolicy",
      "cardReady",
      "sendCard",
    ]);
    expect(readyCards).toHaveLength(1);
    expect(readyCards[0]?.target).toEqual(target);
    expect(readyCards[0]?.card.actions).toEqual([
      { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
      { kind: "allow_session", wirePayload: "v1:QRSTUVWXYZ234567" },
      { kind: "decline", wirePayload: "v1:ABCDEFGH234567AA" },
      { kind: "abort", wirePayload: "v1:QRSTUVWXABCDEFGH" },
    ]);
    expect(inserted.map((row) => row.tokenHash)).toEqual([
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
      hashCallbackToken("QRSTUVWXYZ234567"),
      hashCallbackToken("ABCDEFGH234567AA"),
      hashCallbackToken("QRSTUVWXABCDEFGH"),
    ]);
    expect(JSON.stringify(inserted)).not.toContain("ABCDEFGHIJKLMNOP");
    expect(JSON.stringify(inserted)).not.toContain("QRSTUVWXYZ234567");
    expect(JSON.stringify(inserted)).not.toContain("ABCDEFGH234567AA");
    expect(JSON.stringify(inserted)).not.toContain("QRSTUVWXABCDEFGH");
    expect(adapter.sendCard).toHaveBeenCalledWith(target, readyCards[0]?.card);
  });

  it("sends the rendered card and binds issued token rows to the returned message ref", async () => {
    const order: string[] = [];
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const rawTokens = [
      "ABCDEFGHIJKLMNOP",
      "QRSTUVWXYZ234567",
      "ABCDEFGH234567AA",
      "QRSTUVWXABCDEFGH",
    ];
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-send-and-bind",
      appServerRequestId: 9006,
      method: "item/fileChange/requestApproval",
      params: { changes: [{ path: "src/app.ts" }] },
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
      sendCard: vi.fn((_cardTarget: typeof target, card: ApprovalCard) => {
        order.push("sendCard");
        expect(card.actions.every((action) => action.wirePayload?.startsWith("v1:"))).toBe(true);
        return {
          messageRef: { target, messageId: "msg-send-and-bind" },
          callbackNonce: "legacy-adapter-nonce",
        };
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => {
        order.push("bindActorPolicy");
        expect(adapter.sendCard).not.toHaveBeenCalled();
        return { kind: "ok" as const };
      }),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => {
        order.push(`insert:${input.action}`);
        return { ...input, status: input.status ?? "issued" };
      }),
      casUpdate: vi.fn(
        (tokenHash: string, fromStatus: string, toStatus: string, fields: unknown) => {
          order.push(`cas:${tokenHash}:${fromStatus}->${toStatus}`);
          return { tokenHash, status: toStatus, fields };
        },
      ),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-send-and-bind",
      generateRawCallbackToken: () => rawTokens.shift() as string,
      now: () => new Date("2026-05-02T00:00:02.000Z"),
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    const tokenHashes = [
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
      hashCallbackToken("QRSTUVWXYZ234567"),
      hashCallbackToken("ABCDEFGH234567AA"),
      hashCallbackToken("QRSTUVWXABCDEFGH"),
    ];
    expect(order).toEqual([
      "insert:allow_once",
      "insert:allow_session",
      "insert:decline",
      "insert:abort",
      "bindActorPolicy",
      "sendCard",
      `cas:${tokenHashes[0]}:issued->bound`,
      `cas:${tokenHashes[1]}:issued->bound`,
      `cas:${tokenHashes[2]}:issued->bound`,
      `cas:${tokenHashes[3]}:issued->bound`,
    ]);
    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledTimes(4);
    for (const tokenHash of tokenHashes) {
      expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(tokenHash, "issued", "bound", {
        messageRef: { chatId: target.chatId, messageId: "msg-send-and-bind" },
      });
    }
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("leaves issued token rows untouched when sendCard throws", async () => {
    const order: string[] = [];
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const rawTokens = ["ABCDEFGHIJKLMNOP", "QRSTUVWXYZ234567"];
    const snapshot: PendingApprovalSnapshot = {
      id: "approval-send-failure",
      appServerRequestId: 9007,
      method: "item/execCommand/requestApproval",
      params: {},
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      expiresAt: new Date("2026-05-02T00:30:00.000Z"),
    };
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      start: vi.fn(),
      sendCard: vi.fn(() => {
        order.push("sendCard");
        throw new Error("remote send failed");
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => {
        order.push("bindActorPolicy");
        return { kind: "ok" as const };
      }),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => {
        order.push(`insert:${input.action}`);
        return { ...input, status: input.status ?? "issued" };
      }),
      casUpdate: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalActions: vi.fn(() => ["allow_once", "decline"] as const),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-send-failure",
      generateRawCallbackToken: () => rawTokens.shift() as string,
      now: () => new Date("2026-05-02T00:00:02.000Z"),
    });

    await daemon.start();
    pendingHandler?.(snapshot);
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["insert:allow_once", "insert:decline", "bindActorPolicy", "sendCard"]);
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "malformed callback payload",
      rawCallbackData: "legacy-nonce",
      record: undefined,
      expectedLookup: false,
      expectedMessage: "stale or unknown",
    },
    {
      name: "unknown callback token",
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      record: undefined,
      expectedLookup: true,
      expectedMessage: "stale or unknown",
    },
    {
      name: "expired callback token",
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      record: { status: "expired" },
      expectedLookup: true,
      expectedMessage: "expired",
    },
    {
      name: "revoked callback token",
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      record: { status: "revoked" },
      expectedLookup: true,
      expectedMessage: "stale token",
    },
    {
      name: "used callback token",
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      record: { status: "used" },
      expectedLookup: true,
      expectedMessage: "already resolved",
    },
    {
      name: "issued callback token",
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      record: { status: "issued" },
      expectedLookup: true,
      expectedMessage: "binding not ready",
    },
  ])(
    "fails closed for $name before broker.resolve",
    async ({ rawCallbackData, record, expectedLookup, expectedMessage }) => {
      let actionHandler: ((action: unknown) => void) | undefined;
      const adapter = {
        onAction: vi.fn((handler: (action: unknown) => void) => {
          actionHandler = handler;
          return () => {};
        }),
        onMessage: vi.fn(() => () => {}),
        answerAction: vi.fn(),
      };
      const broker = {
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        onPendingCreated: vi.fn(() => () => {}),
        resolve: vi.fn(),
      };
      const callbackTokenRepository = {
        insert: vi.fn(),
        findByHash: vi.fn(() => record),
      };

      const daemon = new Daemon({
        loadConfig: () => ({}),
        openStorage: () => ({}),
        createBroker: () => broker,
        createSecurityPolicy: () => ({}),
        createSessionRouter: () => ({}),
        createSupervisor: () => ({}),
        createAdapter: () => adapter,
        callbackTokenRepository,
      });

      await daemon.start();
      actionHandler?.({ rawCallbackData, callbackHandle: "callback-handle-1" });
      await new Promise((resolve) => setImmediate(resolve));

      if (expectedLookup) {
        expect(callbackTokenRepository.findByHash).toHaveBeenCalledWith(
          hashCallbackToken("ABCDEFGHIJKLMNOP"),
        );
      } else {
        expect(callbackTokenRepository.findByHash).not.toHaveBeenCalled();
      }
      expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
        ok: false,
        userMessage: expectedMessage,
      });
      expect(broker.resolve).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "unknown inbound messageRef",
      actionMessageRef: {
        target: { platform: "telegram", chatId: "-allowed" },
        messageId: "<unknown>",
      },
      recordMessageRef: { chatId: "-allowed", messageId: "msg-bound" },
      expectedMessage: "stale message (cannot validate)",
    },
    {
      name: "stale inbound messageRef",
      actionMessageRef: {
        target: { platform: "telegram", chatId: "-allowed" },
        messageId: "msg-stale",
      },
      recordMessageRef: { chatId: "-allowed", messageId: "msg-bound" },
      expectedMessage: "stale message",
    },
    {
      name: "wrong chat messageRef",
      actionMessageRef: {
        target: { platform: "telegram", chatId: "-other" },
        messageId: "msg-bound",
      },
      recordMessageRef: { chatId: "-allowed", messageId: "msg-bound" },
      expectedMessage: "stale message",
    },
  ])(
    "fails closed for $name before broker.resolve",
    async ({ actionMessageRef, recordMessageRef, expectedMessage }) => {
      let actionHandler: ((action: unknown) => void) | undefined;
      const adapter = {
        onAction: vi.fn((handler: (action: unknown) => void) => {
          actionHandler = handler;
          return () => {};
        }),
        onMessage: vi.fn(() => () => {}),
        answerAction: vi.fn(),
      };
      const broker = {
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        onPendingCreated: vi.fn(() => () => {}),
        resolve: vi.fn(),
      };
      const callbackTokenRepository = {
        insert: vi.fn(),
        findByHash: vi.fn(() => ({ status: "bound", messageRef: recordMessageRef })),
        casUpdate: vi.fn(),
      };

      const daemon = new Daemon({
        loadConfig: () => ({}),
        openStorage: () => ({}),
        createBroker: () => broker,
        createSecurityPolicy: () => ({}),
        createSessionRouter: () => ({}),
        createSupervisor: () => ({}),
        createAdapter: () => adapter,
        callbackTokenRepository,
      });

      await daemon.start();
      actionHandler?.({
        rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
        callbackHandle: "callback-handle-1",
        messageRef: actionMessageRef,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
        ok: false,
        userMessage: expectedMessage,
      });
      expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
      expect(broker.resolve).not.toHaveBeenCalled();
    },
  );

  it("continues past matching messageRef to the policy gate and fails closed without sender", async () => {
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => ({
        status: "bound",
        messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      })),
      casUpdate: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
      ok: false,
      userMessage: "unauthorized",
    });
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it("fails closed without broker.resolve when SecurityPolicy denies an inbound action", async () => {
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-denied" };
    const record: CallbackTokenRecord = {
      tokenHash: hashCallbackToken("ABCDEFGHIJKLMNOP"),
      approvalId: "approval-policy-deny",
      action: "allow_once",
      callbackNonce: "nonce-policy-deny",
      target,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      createdAt: "2026-05-02T00:00:02.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => record),
      casUpdate: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "deny" as const, reason: "user_not_allowed" })),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      target,
      sender,
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
      ok: false,
      userMessage: "unauthorized",
    });
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      "platform",
      { platform: "lark", chatId: "-allowed", threadKey: "thread-a", topicId: "topic-a" },
    ],
    [
      "threadKey",
      { platform: "telegram", chatId: "-allowed", threadKey: "thread-b", topicId: "topic-a" },
    ],
    [
      "topicId",
      { platform: "telegram", chatId: "-allowed", threadKey: "thread-a", topicId: "topic-b" },
    ],
  ] as const)(
    "fails closed before broker.resolve when callback target %s differs from the token record",
    async (_field, inboundTarget) => {
      let actionHandler: ((action: unknown) => void) | undefined;
      const recordTarget = {
        platform: "telegram",
        chatId: "-allowed",
        threadKey: "thread-a",
        topicId: "topic-a",
      };
      const sender = { userId: "u-alice" };
      const record: CallbackTokenRecord = {
        tokenHash: hashCallbackToken("ABCDEFGHIJKLMNOP"),
        approvalId: "approval-target-mismatch",
        action: "allow_once",
        callbackNonce: "nonce-target-mismatch",
        target: recordTarget,
        actor: { kind: "im" },
        status: "bound",
        messageRef: { chatId: recordTarget.chatId, messageId: "msg-bound" },
        createdAt: "2026-05-02T00:00:02.000Z",
        expiresAt: "2026-05-02T00:30:00.000Z",
      };
      const adapter = {
        onAction: vi.fn((handler: (action: unknown) => void) => {
          actionHandler = handler;
          return () => {};
        }),
        onMessage: vi.fn(() => () => {}),
        answerAction: vi.fn(),
      };
      const broker = {
        attach: vi.fn(),
        enablePendingMode: vi.fn(),
        onPendingCreated: vi.fn(() => () => {}),
        resolve: vi.fn(),
      };
      const callbackTokenRepository = {
        insert: vi.fn(),
        findByHash: vi.fn(() => record),
        casUpdate: vi.fn(),
      };
      const auditRepository = {
        insertBestEffort: vi.fn(),
      };

      const daemon = new Daemon({
        loadConfig: () => ({}),
        openStorage: () => ({}),
        createBroker: () => broker,
        createSecurityPolicy: () => ({
          checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
        }),
        createSessionRouter: () => ({}),
        createSupervisor: () => ({}),
        createAdapter: () => adapter,
        callbackTokenRepository,
        auditRepository,
        generateAuditId: () => "audit-target-mismatch",
        now: () => new Date("2026-05-02T00:00:04.000Z"),
      });

      await daemon.start();
      actionHandler?.({
        rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
        callbackHandle: "callback-handle-1",
        target: inboundTarget,
        sender,
        messageRef: { target: inboundTarget, messageId: "msg-bound" },
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
        ok: false,
        userMessage: "wrong target",
      });
      expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
      expect(broker.resolve).not.toHaveBeenCalled();
      expect(auditRepository.insertBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "audit-target-mismatch",
          action: "approval.callback_target_mismatch",
          approvalId: record.approvalId,
          result: "failed",
        }),
      );
    },
  );

  it("resolves a valid callback, marks the token used, updates the card, and revokes siblings", async () => {
    const order: string[] = [];
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice", displayName: "Alice" };
    const tokenHash = hashCallbackToken("ABCDEFGHIJKLMNOP");
    const record: CallbackTokenRecord = {
      tokenHash,
      approvalId: "approval-ok",
      action: "allow_once",
      callbackNonce: "nonce-ok",
      target,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      createdAt: "2026-05-02T00:00:02.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const terminalCard: ApprovalCard = {
      schemaVersion: "approval-card.v1",
      kind: "file_change",
      approvalId: record.approvalId,
      summary: "Decision recorded",
      target: { riskLevel: "moderate" },
      actions: [],
      status: "resolved",
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(() => {
        order.push("answerAction");
      }),
      updateCard: vi.fn(() => {
        order.push("updateCard");
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(() => {
        order.push("broker.resolve");
        return { kind: "ok" as const, appliedAt: new Date("2026-05-02T00:00:03.000Z") };
      }),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => record),
      casUpdate: vi.fn(() => {
        order.push("cas:used");
        return { ...record, status: "used" as const };
      }),
      forceMarkUsed: vi.fn(),
      revokeBoundSiblings: vi.fn(() => {
        order.push("revokeSiblings");
        return [];
      }),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => {
          order.push("policy");
          return { kind: "allow" as const };
        }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
      renderResolvedApprovalCard: vi.fn(() => terminalCard),
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      target,
      sender,
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual([
      "policy",
      "broker.resolve",
      "cas:used",
      "answerAction",
      "updateCard",
      "revokeSiblings",
    ]);
    expect(broker.resolve).toHaveBeenCalledWith({
      approvalId: record.approvalId,
      decision: { kind: "allow_once" },
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
      target: record.target,
      callbackNonce: record.callbackNonce,
    });
    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(tokenHash, "bound", "used", {
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
    });
    expect(callbackTokenRepository.forceMarkUsed).not.toHaveBeenCalled();
    expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
      ok: true,
      userMessage: "decision recorded",
    });
    expect(adapter.updateCard).toHaveBeenCalledWith(
      { target, messageId: "msg-bound" },
      terminalCard,
    );
    expect(callbackTokenRepository.revokeBoundSiblings).toHaveBeenCalledWith(
      record.approvalId,
      tokenHash,
    );
  });

  it("still answers success and forces used when the post-resolve CAS returns no row", async () => {
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const tokenHash = hashCallbackToken("ABCDEFGHIJKLMNOP");
    const record: CallbackTokenRecord = {
      tokenHash,
      approvalId: "approval-cas-zero",
      action: "decline",
      callbackNonce: "nonce-cas-zero",
      target,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      createdAt: "2026-05-02T00:00:02.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const terminalCard: ApprovalCard = {
      schemaVersion: "approval-card.v1",
      kind: "file_change",
      approvalId: record.approvalId,
      summary: "Decision recorded",
      target: { riskLevel: "moderate" },
      actions: [],
      status: "resolved",
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(),
      updateCard: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(() => ({ kind: "ok" as const, appliedAt: new Date() })),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => record),
      casUpdate: vi.fn(() => undefined),
      forceMarkUsed: vi.fn(() => ({ ...record, status: "used" as const })),
      revokeBoundSiblings: vi.fn(() => []),
    };
    const auditRepository = {
      insertBestEffort: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
      auditRepository,
      generateAuditId: () => "audit-cas-zero",
      now: () => new Date("2026-05-02T00:00:04.000Z"),
      renderResolvedApprovalCard: vi.fn(() => terminalCard),
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      target,
      sender,
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(tokenHash, "bound", "used", {
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
    });
    expect(callbackTokenRepository.forceMarkUsed).toHaveBeenCalledWith(tokenHash, {
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
    });
    expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
      ok: true,
      userMessage: "decision recorded",
    });
    expect(adapter.updateCard).toHaveBeenCalledWith(
      { target, messageId: "msg-bound" },
      terminalCard,
    );
    expect(callbackTokenRepository.revokeBoundSiblings).toHaveBeenCalledWith(
      record.approvalId,
      tokenHash,
    );
    expect(auditRepository.insertBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-cas-zero",
        action: "audit.cas_unreachable_after_resolve",
        approvalId: record.approvalId,
        result: "forced_used",
      }),
    );
  });

  it("contains post-resolve callback delivery failures and still revokes siblings", async () => {
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const tokenHash = hashCallbackToken("ABCDEFGHIJKLMNOP");
    const record: CallbackTokenRecord = {
      tokenHash,
      approvalId: "approval-post-resolve-failure",
      action: "allow_once",
      callbackNonce: "nonce-post-resolve-failure",
      target,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      createdAt: "2026-05-02T00:00:02.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const terminalCard: ApprovalCard = {
      schemaVersion: "approval-card.v1",
      kind: "file_change",
      approvalId: record.approvalId,
      summary: "Decision recorded",
      target: { riskLevel: "moderate" },
      actions: [],
      status: "resolved",
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(() => {
        throw new Error("ack failed");
      }),
      updateCard: vi.fn(() => {
        throw new Error("edit failed");
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(() => ({ kind: "ok" as const, appliedAt: new Date() })),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => record),
      casUpdate: vi.fn(() => ({ ...record, status: "used" as const })),
      forceMarkUsed: vi.fn(),
      revokeBoundSiblings: vi.fn(() => []),
    };
    const auditRepository = {
      insertBestEffort: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
      auditRepository,
      generateAuditId: () => "audit-post-resolve",
      now: () => new Date("2026-05-02T00:00:04.000Z"),
      renderResolvedApprovalCard: vi.fn(() => terminalCard),
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      target,
      sender,
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(broker.resolve).toHaveBeenCalled();
    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(tokenHash, "bound", "used", {
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
    });
    expect(callbackTokenRepository.revokeBoundSiblings).toHaveBeenCalledWith(
      record.approvalId,
      tokenHash,
    );
    expect(auditRepository.insertBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approval.callback_ack_failed" }),
    );
    expect(auditRepository.insertBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approval.callback_update_failed" }),
    );
  });

  it.each([
    [{ kind: "wrong_actor" }, "wrong actor"],
    [{ kind: "stale_callback" }, "stale nonce"],
    [{ kind: "wrong_target" }, "wrong target"],
    [
      {
        kind: "expired",
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
        expiredAt: new Date("2026-05-02T00:30:00.000Z"),
      },
      "expired",
    ],
    [
      { kind: "transport_lost", lostAt: new Date("2026-05-02T00:05:00.000Z") },
      "codex restarted, retry",
    ],
    [{ kind: "binding_required" }, "internal: missing bind"],
    [
      { kind: "already_resolved", priorDecision: { kind: "approved" as const } },
      "already resolved (decision: approved)",
    ],
    [
      { kind: "unsupported_decision", method: "synthetic", reason: "not supported" },
      "invalid action",
    ],
    [{ kind: "unknown_approval_id" }, "approval not found"],
  ] as const)("answers %s without mutating token state", async (error, expectedMessage) => {
    let actionHandler: ((action: unknown) => void) | undefined;
    const target = { platform: "telegram", chatId: "-allowed" };
    const sender = { userId: "u-alice" };
    const tokenHash = hashCallbackToken("ABCDEFGHIJKLMNOP");
    const record: CallbackTokenRecord = {
      tokenHash,
      approvalId: "approval-error",
      action: "allow_once",
      callbackNonce: "nonce-error",
      target,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: target.chatId, messageId: "msg-bound" },
      createdAt: "2026-05-02T00:00:02.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const adapter = {
      onAction: vi.fn((handler: (action: unknown) => void) => {
        actionHandler = handler;
        return () => {};
      }),
      onMessage: vi.fn(() => () => {}),
      answerAction: vi.fn(),
      updateCard: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(() => ({ kind: "error" as const, error })),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => record),
      casUpdate: vi.fn(),
      forceMarkUsed: vi.fn(),
      revokeBoundSiblings: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      callbackTokenRepository,
    });

    await daemon.start();
    actionHandler?.({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackHandle: "callback-handle-1",
      target,
      sender,
      messageRef: { target, messageId: "msg-bound" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(adapter.answerAction).toHaveBeenCalledWith("callback-handle-1", {
      ok: false,
      userMessage: expectedMessage,
    });
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(callbackTokenRepository.forceMarkUsed).not.toHaveBeenCalled();
    expect(callbackTokenRepository.revokeBoundSiblings).not.toHaveBeenCalled();
    expect(adapter.updateCard).not.toHaveBeenCalled();
  });

  it("runs prune sweeps on the interval trigger and eager high-water trigger", async () => {
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    let scheduled: { handler: () => void; intervalMs: number } | undefined;
    const now = new Date("2026-05-02T19:00:00.000Z");
    const callbackTokenRepository = {
      insert: vi.fn(),
      pruneExpired: vi.fn(),
      revokeStuckIssued: vi.fn(() => []),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
      approvalRecordCount: vi.fn(() => 8),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => ({
        onAction: vi.fn(() => () => {}),
        onMessage: vi.fn(() => () => {}),
        start: vi.fn(),
      }),
      callbackTokenRepository,
      schedulePrune: (handler, intervalMs) => {
        scheduled = { handler, intervalMs };
        return () => {};
      },
      terminalRecordMaxCount: 10,
      terminalRecordMaxAgeMs: 123_000,
      pruneBatchSize: 7,
      now: () => now,
    });

    await daemon.start();
    expect(scheduled?.intervalMs).toBe(60_000);

    scheduled?.handler();
    expect(callbackTokenRepository.pruneExpired).toHaveBeenCalledWith(now.toISOString(), 7);
    expect(broker.expirePending).toHaveBeenCalledTimes(1);
    expect(broker.pruneTerminalRecords).toHaveBeenCalledWith({
      maxAgeMs: 123_000,
      maxCount: 10,
      batchSize: 7,
      now,
    });

    vi.clearAllMocks();
    pendingHandler?.({
      id: "approval-eager-prune",
      appServerRequestId: 9901,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: now,
      expiresAt: new Date("2026-05-02T19:30:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(broker.approvalRecordCount).toHaveBeenCalled();
    expect(callbackTokenRepository.pruneExpired).toHaveBeenCalledWith(now.toISOString(), 7);
    expect(broker.pruneTerminalRecords).toHaveBeenCalledTimes(1);
  });

  it("contains prune sweep failures and emits daemon audit", async () => {
    let scheduled: { handler: () => void; intervalMs: number } | undefined;
    const auditRepository = {
      insertBestEffort: vi.fn(),
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      pruneExpired: vi.fn(() => {
        throw new Error("sqlite busy");
      }),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({}),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => ({
        onAction: vi.fn(() => () => {}),
        onMessage: vi.fn(() => () => {}),
      }),
      callbackTokenRepository,
      auditRepository,
      schedulePrune: (handler, intervalMs) => {
        scheduled = { handler, intervalMs };
        return () => {};
      },
      generateAuditId: () => "audit-prune-failed",
      now: () => new Date("2026-05-02T19:05:00.000Z"),
    });

    await daemon.start();

    expect(() => scheduled?.handler()).not.toThrow();
    expect(auditRepository.insertBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-prune-failed",
        action: "approval.prune_sweep_failed",
        result: "failed",
      }),
    );
    expect(broker.expirePending).not.toHaveBeenCalled();
  });

  it("revokes stuck issued callback tokens and fails only the flagged approval as transport_lost", async () => {
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    let scheduled: { handler: () => void; intervalMs: number } | undefined;
    let currentNow = new Date("2026-05-02T19:10:02.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const tokenHash = hashCallbackToken("ABCDEFGHIJKLMNOP");
    const revokedRecord: CallbackTokenRecord = {
      tokenHash,
      approvalId: "approval-stuck-issued",
      action: "allow_once",
      callbackNonce: "nonce-stuck-issued",
      target,
      actor: { kind: "im" },
      status: "revoked",
      createdAt: "2026-05-02T19:10:02.000Z",
      expiresAt: "2026-05-02T19:40:00.000Z",
    };
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => ({ ...input, status: input.status })),
      casUpdate: vi.fn(() => undefined),
      pruneExpired: vi.fn(),
      revokeStuckIssued: vi.fn(() => [revokedRecord]),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      sendCard: vi.fn(() => ({
        messageRef: { target, messageId: "msg-stuck-issued" },
        callbackNonce: "legacy",
      })),
      start: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => ({ kind: "ok" as const })),
      failPendingApprovalAsTransportLost: vi.fn(),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalActions: vi.fn(() => ["allow_once"] as const),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-stuck-issued",
      generateRawCallbackToken: () => "ABCDEFGHIJKLMNOP",
      schedulePrune: (handler, intervalMs) => {
        scheduled = { handler, intervalMs };
        return () => {};
      },
      bindIssuedRetryDelaysMs: [],
      now: () => currentNow,
    });

    await daemon.start();
    pendingHandler?.({
      id: "approval-stuck-issued",
      appServerRequestId: 9902,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: currentNow,
      expiresAt: new Date("2026-05-02T19:40:00.000Z"),
    });
    await flushDaemonHandlers();

    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(tokenHash, "issued", "bound", {
      messageRef: { chatId: target.chatId, messageId: "msg-stuck-issued" },
    });

    currentNow = new Date("2026-05-02T19:10:08.000Z");
    scheduled?.handler();

    expect(callbackTokenRepository.revokeStuckIssued).toHaveBeenCalledWith(
      "2026-05-02T19:10:03.000Z",
      ["approval-stuck-issued"],
      100,
    );
    expect(broker.failPendingApprovalAsTransportLost).toHaveBeenCalledWith("approval-stuck-issued");
  });

  it("keeps stuck-issued approvals flagged across bounded revoke batches", async () => {
    let pendingHandler: ((snap: PendingApprovalSnapshot) => void) | undefined;
    let scheduled: { handler: () => void; intervalMs: number } | undefined;
    let currentNow = new Date("2026-05-02T19:20:02.000Z");
    const target = { platform: "telegram", chatId: "-allowed" };
    const actor = { kind: "im" as const, platform: "telegram", userId: "u-alice" };
    const tokenHashes = [
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
      hashCallbackToken("QRSTUVWXYZ234567"),
    ];
    const revokedRecords: CallbackTokenRecord[] = tokenHashes.map((tokenHash, index) => ({
      tokenHash,
      approvalId: "approval-stuck-issued-batch",
      action: index === 0 ? "allow_once" : "decline",
      callbackNonce: "nonce-stuck-issued-batch",
      target,
      actor: { kind: "im" },
      status: "revoked",
      createdAt: "2026-05-02T19:20:02.000Z",
      expiresAt: "2026-05-02T19:50:00.000Z",
    }));
    const callbackTokenRepository = {
      insert: vi.fn((input: CallbackTokenInsert) => ({ ...input, status: input.status })),
      casUpdate: vi.fn(() => undefined),
      pruneExpired: vi.fn(),
      revokeStuckIssued: vi
        .fn()
        .mockReturnValueOnce([revokedRecords[0]])
        .mockReturnValueOnce([revokedRecords[1]])
        .mockReturnValueOnce([]),
    };
    const adapter = {
      onAction: vi.fn(() => () => {}),
      onMessage: vi.fn(() => () => {}),
      sendCard: vi.fn(() => ({
        messageRef: { target, messageId: "msg-stuck-issued-batch" },
        callbackNonce: "legacy",
      })),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn((handler: (snap: PendingApprovalSnapshot) => void) => {
        pendingHandler = handler;
        return () => {};
      }),
      bindActorPolicy: vi.fn(() => ({ kind: "ok" as const })),
      failPendingApprovalAsTransportLost: vi.fn(),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkApprovalDestination: () => ({ kind: "allow" as const }),
      }),
      createSessionRouter: () => ({}),
      createSupervisor: () => ({}),
      createAdapter: () => adapter,
      resolveApprovalTarget: vi.fn(() => target),
      resolveApprovalActions: vi.fn(() => ["allow_once", "decline"] as const),
      resolveApprovalAllowedActors: vi.fn(() => [actor]),
      callbackTokenRepository,
      generateCallbackNonce: () => "nonce-stuck-issued-batch",
      generateRawCallbackToken: vi
        .fn()
        .mockReturnValueOnce("ABCDEFGHIJKLMNOP")
        .mockReturnValueOnce("QRSTUVWXYZ234567"),
      schedulePrune: (handler, intervalMs) => {
        scheduled = { handler, intervalMs };
        return () => {};
      },
      bindIssuedRetryDelaysMs: [],
      pruneBatchSize: 1,
      now: () => currentNow,
    });

    await daemon.start();
    pendingHandler?.({
      id: "approval-stuck-issued-batch",
      appServerRequestId: 9903,
      method: "item/fileChange/requestApproval",
      params: {},
      createdAt: currentNow,
      expiresAt: new Date("2026-05-02T19:50:00.000Z"),
    });
    await flushDaemonHandlers();

    currentNow = new Date("2026-05-02T19:20:08.000Z");
    scheduled?.handler();
    scheduled?.handler();
    scheduled?.handler();

    expect(callbackTokenRepository.revokeStuckIssued).toHaveBeenCalledTimes(3);
    expect(broker.failPendingApprovalAsTransportLost).toHaveBeenCalledTimes(1);
    expect(broker.failPendingApprovalAsTransportLost).toHaveBeenCalledWith(
      "approval-stuck-issued-batch",
    );
  });

  it.each([
    ["loadConfig", []],
    ["openStorage", []],
    ["createBroker", ["storage.close"]],
    ["broker.attach", ["storage.close"]],
    ["enablePendingMode", ["storage.close"]],
    ["createSecurityPolicy", ["storage.close"]],
    ["createSessionRouter", ["storage.close"]],
    ["createSupervisor", ["storage.close"]],
    ["createAdapter", ["supervisor.stop", "storage.close"]],
    ["broker.onPendingCreated", ["adapter.stop", "supervisor.stop", "storage.close"]],
    [
      "adapter.onAction",
      ["pending.unsubscribe", "adapter.stop", "supervisor.stop", "storage.close"],
    ],
    [
      "adapter.onMessage",
      [
        "action.unsubscribe",
        "pending.unsubscribe",
        "adapter.stop",
        "supervisor.stop",
        "storage.close",
      ],
    ],
    [
      "adapter.start",
      [
        "message.unsubscribe",
        "action.unsubscribe",
        "pending.unsubscribe",
        "adapter.stop",
        "supervisor.stop",
        "storage.close",
      ],
    ],
  ] as const)(
    "cleans partial startup state when %s fails",
    async (failureStep, expectedCleanupTail) => {
      const expectedCleanup = expectedCleanupTail as readonly string[];
      const order: string[] = [];
      const failure = new Error(`${failureStep} failed`);
      const failAt = (step: string): void => {
        order.push(step);
        if (step === failureStep) {
          throw failure;
        }
      };
      const storage = {
        close: vi.fn(() => {
          order.push("storage.close");
        }),
      };
      const supervisor = {
        stop: vi.fn(() => {
          order.push("supervisor.stop");
        }),
      };
      const broker = {
        attach: vi.fn(() => {
          failAt("broker.attach");
        }),
        enablePendingMode: vi.fn(() => {
          failAt("enablePendingMode");
        }),
        onPendingCreated: vi.fn(() => {
          failAt("broker.onPendingCreated");
          return () => {
            order.push("pending.unsubscribe");
          };
        }),
      };
      const adapter = {
        onAction: vi.fn(() => {
          failAt("adapter.onAction");
          return () => {
            order.push("action.unsubscribe");
          };
        }),
        onMessage: vi.fn(() => {
          failAt("adapter.onMessage");
          return () => {
            order.push("message.unsubscribe");
          };
        }),
        start: vi.fn(() => {
          failAt("adapter.start");
        }),
        stop: vi.fn(() => {
          order.push("adapter.stop");
        }),
      };

      const daemon = new Daemon({
        loadConfig: () => {
          failAt("loadConfig");
          return {};
        },
        openStorage: () => {
          failAt("openStorage");
          return storage;
        },
        createBroker: () => {
          failAt("createBroker");
          return broker;
        },
        createSecurityPolicy: () => {
          failAt("createSecurityPolicy");
          return {};
        },
        createSessionRouter: () => {
          failAt("createSessionRouter");
          return {};
        },
        createSupervisor: () => {
          failAt("createSupervisor");
          return supervisor;
        },
        createAdapter: () => {
          failAt("createAdapter");
          return adapter;
        },
      });

      await expect(daemon.start()).rejects.toBe(failure);

      expect(daemon.isStarted()).toBe(false);
      if (expectedCleanup.length > 0) {
        expect(order.slice(-expectedCleanup.length)).toEqual(expectedCleanup);
      }
      if (!expectedCleanup.includes("storage.close")) {
        expect(storage.close).not.toHaveBeenCalled();
      }
      if (!expectedCleanup.includes("supervisor.stop")) {
        expect(supervisor.stop).not.toHaveBeenCalled();
      }
      if (!expectedCleanup.includes("adapter.stop")) {
        expect(adapter.stop).not.toHaveBeenCalled();
      }
    },
  );

  it("does not introduce a public listener surface", () => {
    const source = readSourceFiles(SRC_DIR)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/\bcreateServer\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Server\s*\(/);
    expect(source).not.toMatch(/\.listen\s*\(/);
  });
});

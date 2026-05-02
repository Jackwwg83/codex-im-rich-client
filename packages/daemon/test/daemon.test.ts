import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IM_ROUTABLE_APPROVAL_METHODS, type PendingApprovalSnapshot } from "@codex-im/core";
import type { ApprovalCard } from "@codex-im/render";
import { type CallbackTokenInsert, hashCallbackToken } from "@codex-im/storage-sqlite";
import { describe, expect, it, vi } from "vitest";
import { Daemon, type DaemonOptions, type DaemonSignal } from "../src/index.js";

const SRC_DIR = join(import.meta.dirname, "../src");

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

    expect(daemon.isStarted()).toBe(false);
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

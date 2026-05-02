import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IM_ROUTABLE_APPROVAL_METHODS } from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import { Daemon, type DaemonOptions } from "../src/index.js";

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

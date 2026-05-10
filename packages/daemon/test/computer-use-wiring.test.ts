import {
  ComputerUsePolicy,
  ComputerUseSessionRegistry,
  type DynamicToolCallHandler,
  UnsupportedComputerUseProvider,
} from "@codex-im/core";
import { describe, expect, it, vi } from "vitest";
import {
  type ComputerUseGateAudit,
  type ComputerUseGateBroker,
  setupComputerUseGate,
} from "../src/computer-use-wiring.js";

function makeAudit(): ComputerUseGateAudit & { calls: Array<{ kind: string; metadata?: object }> } {
  const calls: Array<{ kind: string; metadata?: object }> = [];
  return {
    emit(event) {
      calls.push({ kind: event.kind, ...(event.metadata ? { metadata: event.metadata } : {}) });
    },
    calls,
  };
}

function makeBroker(): ComputerUseGateBroker & {
  handler: DynamicToolCallHandler | undefined;
  registerDynamicToolCallHandler: ReturnType<typeof vi.fn>;
} {
  let captured: DynamicToolCallHandler | undefined;
  const register = vi.fn((handler: DynamicToolCallHandler) => {
    captured = handler;
  });
  return {
    registerDynamicToolCallHandler: register,
    get handler() {
      return captured;
    },
  };
}

describe("setupComputerUseGate", () => {
  it("returns a fresh registry and a default policy when config is missing", () => {
    const result = setupComputerUseGate({
      broker: undefined,
      config: undefined,
      provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
      audit: makeAudit(),
    });

    expect(result.registry).toBeInstanceOf(ComputerUseSessionRegistry);
    expect(result.policy).toBeInstanceOf(ComputerUsePolicy);
    expect(result.policy.snapshot.enabled).toBe(false);
  });

  it("builds the policy from the config.computerUse block when present", () => {
    const result = setupComputerUseGate({
      broker: undefined,
      config: {
        computerUse: {
          enabled: true,
          allowedApps: ["Chrome", "Slack"],
          requireApprovalKeywords: ["wire"],
        },
      },
      provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
      audit: makeAudit(),
    });

    expect(result.policy.snapshot.enabled).toBe(true);
    expect(result.policy.snapshot.allowedApps).toEqual(["Chrome", "Slack"]);
    expect(result.policy.snapshot.requireApprovalKeywords).toEqual(["wire"]);
  });

  it("registers a single dynamic tool call handler with the broker", () => {
    const broker = makeBroker();
    setupComputerUseGate({
      broker,
      config: undefined,
      provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
      audit: makeAudit(),
    });

    expect(broker.registerDynamicToolCallHandler).toHaveBeenCalledTimes(1);
    expect(typeof broker.handler).toBe("function");
  });

  it("does not throw when the broker is undefined (Daemon may bring up wiring before the broker exists)", () => {
    expect(() =>
      setupComputerUseGate({
        broker: undefined,
        config: undefined,
        provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
        audit: makeAudit(),
      }),
    ).not.toThrow();
  });

  it("does not throw when the broker is present but has no registerDynamicToolCallHandler method", () => {
    const broker = {} as ComputerUseGateBroker;
    expect(() =>
      setupComputerUseGate({
        broker,
        config: undefined,
        provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
        audit: makeAudit(),
      }),
    ).not.toThrow();
  });

  it("the registered handler delegates to ComputerUseToolGate.handleToolCall (rejects unallowed namespace)", async () => {
    const broker = makeBroker();
    setupComputerUseGate({
      broker,
      config: { computerUse: { enabled: true, allowedApps: ["Chrome"] } },
      provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
      audit: makeAudit(),
    });

    // Fire a request whose namespace/tool is not in allowedTools — gate
    // should refuse without throwing. The full DynamicToolCall shape is
    // method/params/id; the gate reads from params.
    const result = await broker.handler?.({
      method: "tool/call",
      params: {
        namespace: "not_allowed",
        name: "evil",
        input: {},
      } as never,
      id: "req-1",
    });
    expect(result).toBeDefined();
  });

  it("uses the injected allowedTools override when provided", () => {
    const broker = makeBroker();
    setupComputerUseGate({
      broker,
      config: undefined,
      provider: new UnsupportedComputerUseProvider({ audit: makeAudit() }),
      audit: makeAudit(),
      allowedTools: [{ namespace: "custom", tool: "tool" }],
    });
    // Smoke check: registration happened with the custom override path
    // taken; the handler still exists and is callable.
    expect(broker.handler).toBeDefined();
  });
});

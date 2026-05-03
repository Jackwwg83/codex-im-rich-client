import { describe, expect, it } from "vitest";
import { AuditEmitter } from "../src/audit.js";
import { ComputerUsePolicy } from "../src/computer-use-policy.js";
import { FakeComputerUseProvider } from "../src/computer-use-provider.js";
import {
  COMPUTER_USE_SENSITIVE_STEP_ACTIONS,
  ComputerUseSessionRegistry,
  ComputerUseToolGate,
} from "../src/computer-use-session.js";

const PARAMS = {
  threadId: "thread-1",
  turnId: "turn-1",
  callId: "call-1",
  namespace: null,
  tool: "computer_use.synthetic",
  arguments: { action: "click" },
};

function makePolicy() {
  return new ComputerUsePolicy({
    enabled: true,
    allowedApps: ["Google Chrome"],
    denyApps: ["Keychain Access"],
    requireApprovalKeywords: ["login", "password", "token"],
  });
}

describe("ComputerUseSessionRegistry and ComputerUseToolGate (Phase 6 JAC-97)", () => {
  it("fails closed and audits when no active /cu session exists", async () => {
    const audit = new AuditEmitter();
    const provider = new FakeComputerUseProvider({
      contentItems: [{ type: "inputText", text: "should-not-run" }],
      success: true,
    });
    const gate = new ComputerUseToolGate({
      registry: new ComputerUseSessionRegistry(),
      policy: makePolicy(),
      provider,
      audit,
      allowedTools: [{ namespace: null, tool: "computer_use.synthetic" }],
    });

    await expect(
      gate.handle({
        targetKey: "telegram:-allowed",
        actorKey: "telegram:u-alice",
        app: "Google Chrome",
        params: PARAMS,
      }),
    ).resolves.toEqual({ contentItems: [], success: false });
    expect(provider.calls()).toEqual([]);
    expect(audit.recent({ kind: "computer_use.tool_denied", limit: 1 })[0]?.metadata).toMatchObject(
      {
        reason: "no_active_session",
        callId: "call-1",
      },
    );
  });

  it("denies apps before provider execution", async () => {
    const registry = new ComputerUseSessionRegistry();
    registry.start({
      sessionId: "cu-1",
      targetKey: "telegram:-allowed",
      actorKey: "telegram:u-alice",
      projectId: "web",
      threadId: "thread-1",
      turnId: "turn-1",
      app: "Keychain Access",
      task: "open Keychain Access",
    });
    const provider = new FakeComputerUseProvider({
      contentItems: [{ type: "inputText", text: "should-not-run" }],
      success: true,
    });
    const gate = new ComputerUseToolGate({
      registry,
      policy: makePolicy(),
      provider,
      allowedTools: [{ namespace: null, tool: "computer_use.synthetic" }],
    });

    await expect(
      gate.handle({
        targetKey: "telegram:-allowed",
        actorKey: "telegram:u-alice",
        app: "Keychain Access",
        params: PARAMS,
      }),
    ).resolves.toEqual({ contentItems: [], success: false });
    expect(provider.calls()).toEqual([]);
  });

  it("blocks sensitive steps and exposes no allow_session action", async () => {
    const audit = new AuditEmitter();
    const registry = new ComputerUseSessionRegistry();
    registry.start({
      sessionId: "cu-1",
      targetKey: "telegram:-allowed",
      actorKey: "telegram:u-alice",
      projectId: "web",
      threadId: "thread-1",
      turnId: "turn-1",
      app: "Google Chrome",
      task: "login with token",
    });
    const provider = new FakeComputerUseProvider({
      contentItems: [{ type: "inputText", text: "should-not-run" }],
      success: true,
    });
    const gate = new ComputerUseToolGate({
      registry,
      policy: makePolicy(),
      provider,
      audit,
      allowedTools: [{ namespace: null, tool: "computer_use.synthetic" }],
    });

    await expect(
      gate.handle({
        targetKey: "telegram:-allowed",
        actorKey: "telegram:u-alice",
        app: "Google Chrome",
        params: PARAMS,
      }),
    ).resolves.toEqual({ contentItems: [], success: false });
    expect(provider.calls()).toEqual([]);
    expect(COMPUTER_USE_SENSITIVE_STEP_ACTIONS).toEqual(["allow_once", "decline"]);
    expect(COMPUTER_USE_SENSITIVE_STEP_ACTIONS).not.toContain("allow_session");
    expect(
      audit.recent({ kind: "computer_use.sensitive_step_blocked", limit: 1 })[0]?.metadata,
    ).toMatchObject({
      app: "Google Chrome",
      callId: "call-1",
      reasons: ["keyword:login", "keyword:token"],
    });
  });

  it("lets safe active sessions reach the fake provider", async () => {
    const registry = new ComputerUseSessionRegistry();
    registry.start({
      sessionId: "cu-1",
      targetKey: "telegram:-allowed",
      actorKey: "telegram:u-alice",
      projectId: "web",
      threadId: "thread-1",
      turnId: "turn-1",
      app: "Google Chrome",
      task: "summarize the visible page",
    });
    const provider = new FakeComputerUseProvider({
      contentItems: [{ type: "inputText", text: "fake-result" }],
      success: true,
    });
    const gate = new ComputerUseToolGate({
      registry,
      policy: makePolicy(),
      provider,
      allowedTools: [{ namespace: null, tool: "computer_use.synthetic" }],
    });

    await expect(
      gate.handle({
        targetKey: "telegram:-allowed",
        actorKey: "telegram:u-alice",
        app: "Google Chrome",
        params: PARAMS,
      }),
    ).resolves.toEqual({
      contentItems: [{ type: "inputText", text: "fake-result" }],
      success: true,
    });
    expect(provider.calls()).toEqual([{ app: "Google Chrome", params: PARAMS }]);
  });
});

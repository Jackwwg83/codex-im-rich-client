import { describe, expect, it } from "vitest";
import { AuditEmitter } from "../src/audit.js";
import {
  FakeComputerUseProvider,
  UnsupportedComputerUseProvider,
} from "../src/computer-use-provider.js";

const PARAMS = {
  threadId: "thread-1",
  turnId: "turn-1",
  callId: "call-1",
  namespace: null,
  tool: "computer_use.synthetic",
  arguments: { secret: "sk-testsecret1234567890", action: "click" },
};

describe("ComputerUseProvider boundary (Phase 6 JAC-163)", () => {
  it("unsupported provider fails closed and audits provider_unavailable without arguments", async () => {
    const audit = new AuditEmitter();
    const provider = new UnsupportedComputerUseProvider({ audit });

    await expect(provider.execute({ app: "Google Chrome", params: PARAMS })).resolves.toEqual({
      contentItems: [],
      success: false,
    });

    const [event] = audit.recent({
      kind: "computer_use.provider_unavailable",
      limit: 1,
    });
    expect(event?.metadata).toEqual({
      app: "Google Chrome",
      callId: "call-1",
      namespace: null,
      tool: "computer_use.synthetic",
    });
    expect(JSON.stringify(event)).not.toContain("sk-testsecret1234567890");
    expect(JSON.stringify(event)).not.toContain("arguments");
  });

  it("fake provider returns a deterministic response for tests without live desktop access", async () => {
    const provider = new FakeComputerUseProvider({
      contentItems: [{ type: "inputText", text: "fake-result" }],
      success: true,
    });

    await expect(provider.execute({ app: "Google Chrome", params: PARAMS })).resolves.toEqual({
      contentItems: [{ type: "inputText", text: "fake-result" }],
      success: true,
    });
    expect(provider.calls()).toEqual([{ app: "Google Chrome", params: PARAMS }]);
  });
});

import { describe, expect, it } from "vitest";
import { AuditEmitter } from "../src/audit.js";
import { emitComputerUseTriggerAudit } from "../src/computer-use-audit.js";

describe("Computer Use audit helpers (Phase 6 JAC-98)", () => {
  it("emits a redacted explicit /cu trigger audit event without target/chat/user ids", () => {
    const audit = new AuditEmitter();

    emitComputerUseTriggerAudit({
      audit,
      intent: {
        kind: "computer_use",
        action: "start",
        task: "login with token sk-testsecret1234567890",
        rawText: "/cu login with token sk-testsecret1234567890",
      },
      policyDecision: {
        kind: "allow",
        app: "Google Chrome",
        requiresApproval: true,
        approvalReasons: ["keyword:login", "keyword:token"],
      },
    });

    const event = audit.recent({ kind: "computer_use.intent_created", limit: 1 })[0];
    expect(event?.metadata).toEqual({
      action: "start",
      task: "login with token ***REDACTED:openai-token***",
      app: "Google Chrome",
      requiresApproval: true,
      approvalReasons: ["keyword:login", "keyword:token"],
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("sk-testsecret1234567890");
    expect(serialized).not.toContain("telegram:");
    expect(serialized).not.toContain("chatId");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("rawText");
  });
});

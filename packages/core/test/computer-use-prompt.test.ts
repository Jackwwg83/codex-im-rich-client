import { describe, expect, it } from "vitest";
import { wrapComputerUsePrompt } from "../src/computer-use-prompt.js";

describe("wrapComputerUsePrompt (Phase 6 JAC-95)", () => {
  it("includes the allowed app, stop conditions, and sanitized task", () => {
    const wrapped = wrapComputerUsePrompt(
      {
        kind: "computer_use",
        action: "start",
        task: "open Chrome and login with token sk-testsecret1234567890",
        rawText: "/cu open Chrome and login with token sk-testsecret1234567890",
      },
      {
        kind: "allow",
        app: "Google Chrome",
        requiresApproval: true,
        approvalReasons: ["keyword:login", "keyword:token"],
      },
    );

    expect(wrapped.kind).toBe("computer_use_prompt");
    expect(wrapped.app).toBe("Google Chrome");
    expect(wrapped.task).toContain("open Chrome and login with token");
    expect(wrapped.task).not.toContain("sk-testsecret1234567890");
    expect(wrapped.prompt).toContain("Allowed app: Google Chrome");
    expect(wrapped.prompt).toContain("Do not submit credentials");
    expect(wrapped.prompt).toContain("Stop before any sensitive step");
    expect(wrapped.prompt).not.toContain("sk-testsecret1234567890");
    expect(wrapped.approvalReasons).toEqual(["keyword:login", "keyword:token"]);
  });

  it("does not include target ids, sender ids, or chat ids in the wrapper contract", () => {
    const wrapped = wrapComputerUsePrompt(
      {
        kind: "computer_use",
        action: "start",
        task: "summarize the visible page",
        rawText: "/cu summarize the visible page",
      },
      {
        kind: "allow",
        app: "Google Chrome",
        requiresApproval: false,
        approvalReasons: [],
      },
    );

    expect(Object.keys(wrapped).sort()).toEqual([
      "app",
      "approvalReasons",
      "kind",
      "prompt",
      "requiresApproval",
      "task",
    ]);
    expect(wrapped.prompt).not.toContain("telegram:");
    expect(wrapped.prompt).not.toContain("chatId");
    expect(wrapped.prompt).not.toContain("userId");
  });
});

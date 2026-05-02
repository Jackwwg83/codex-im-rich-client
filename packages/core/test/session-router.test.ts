import { describe, expect, it } from "vitest";
import { type SessionRoute, SessionRouter } from "../src/session-router.js";
import type { Target } from "../src/types.js";

const TARGET: Target = { platform: "telegram", chatId: "-1001" };

describe("SessionRouter skeleton (T13a / D38)", () => {
  it("resolves an unknown target to an explicit unbound route", () => {
    const router = new SessionRouter();
    expect(router.resolve(TARGET)).toEqual({
      kind: "unbound",
      target: TARGET,
    } satisfies SessionRoute);
  });

  it("declares bound route shape for project and Codex thread bindings", () => {
    const route: SessionRoute = {
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
      defaultModel: "gpt-5.5",
      activeTurnId: "turn_abc",
    };
    expect(route.projectId).toBe("web");
    expect(route.codexThreadId).toBe("thread_123");
  });
});

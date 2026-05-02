import { describe, expect, it } from "vitest";
import {
  type SessionBindingInput,
  type SessionBindingRepository,
  type SessionRoute,
  SessionRouter,
  type SessionThreadBindingRecord,
} from "../src/session-router.js";
import type { Target } from "../src/types.js";

const TARGET: Target = { platform: "telegram", chatId: "-1001" };

class FakeBindingRepository implements SessionBindingRepository {
  readonly writes: Array<SessionBindingInput & { target: Target }> = [];
  readonly #records = new Map<string, SessionThreadBindingRecord>();

  constructor(private readonly onBeforeWrite?: () => void) {}

  upsert(input: SessionBindingInput & { target: Target }): SessionThreadBindingRecord {
    this.onBeforeWrite?.();
    this.writes.push(input);
    const now = "2026-05-02T00:00:00.000Z";
    const record: SessionThreadBindingRecord = {
      id: `tb_${this.writes.length}`,
      target: input.target,
      projectId: input.projectId,
      cwd: input.cwd,
      ...(input.codexThreadId !== undefined ? { codexThreadId: input.codexThreadId } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      ...(input.activeTurnId !== undefined ? { activeTurnId: input.activeTurnId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.#records.set(JSON.stringify(input.target), record);
    return record;
  }

  findByTarget(target: Target): SessionThreadBindingRecord | undefined {
    return this.#records.get(JSON.stringify(target));
  }
}

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

  it("binds a target only after the synchronous repository write returns", () => {
    const routerRef: { current?: SessionRouter } = {};
    const bindings = new FakeBindingRepository(() => {
      expect(routerRef.current?.resolve(TARGET)).toEqual({
        kind: "unbound",
        target: TARGET,
      } satisfies SessionRoute);
    });
    const router = new SessionRouter({ bindings });
    routerRef.current = router;

    expect(
      router.bind(TARGET, {
        projectId: "web",
        cwd: "/repo/web",
        defaultModel: "gpt-5.5",
      }),
    ).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      defaultModel: "gpt-5.5",
    } satisfies SessionRoute);

    expect(bindings.writes).toHaveLength(1);
    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      defaultModel: "gpt-5.5",
    } satisfies SessionRoute);
  });

  it("binds a Codex thread using the existing project binding", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });

    router.bind(TARGET, {
      projectId: "web",
      cwd: "/repo/web",
      activeTurnId: "turn_1",
    });
    expect(router.bindThread(TARGET, "thread_123")).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
      activeTurnId: "turn_1",
    } satisfies SessionRoute);

    expect(bindings.writes).toEqual([
      {
        target: TARGET,
        projectId: "web",
        cwd: "/repo/web",
        activeTurnId: "turn_1",
      },
      {
        target: TARGET,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread_123",
        activeTurnId: "turn_1",
      },
    ]);
  });
});

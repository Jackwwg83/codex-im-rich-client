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
  writeError: Error | undefined;
  lists = 0;
  readonly reads: Target[] = [];
  readonly writes: Array<SessionBindingInput & { target: Target }> = [];
  readonly list?: () => SessionThreadBindingRecord[];
  readonly #records = new Map<string, SessionThreadBindingRecord>();

  constructor(
    private readonly onBeforeWrite?: () => void,
    options: { withList?: boolean } = {},
  ) {
    if (options.withList === true) {
      this.list = () => {
        this.lists += 1;
        return [...this.#records.values()];
      };
    }
  }

  upsert(input: SessionBindingInput & { target: Target }): SessionThreadBindingRecord {
    this.onBeforeWrite?.();
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
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
    this.reads.push(target);
    return this.#records.get(JSON.stringify(target));
  }

  seed(record: SessionThreadBindingRecord): void {
    this.#records.set(JSON.stringify(record.target), record);
  }

  clear(): void {
    this.#records.clear();
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

  it("resolves from memory cache without hitting the repository", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });

    router.bind(TARGET, {
      projectId: "web",
      cwd: "/repo/web",
    });

    bindings.clear();
    bindings.reads.length = 0;

    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
    } satisfies SessionRoute);
    expect(bindings.reads).toEqual([]);
  });

  it("falls back to the repository on cache miss and caches the result", () => {
    const bindings = new FakeBindingRepository();
    bindings.seed({
      id: "tb_seed",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const router = new SessionRouter({ bindings });

    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
    } satisfies SessionRoute);

    bindings.clear();

    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
    } satisfies SessionRoute);
    expect(bindings.reads).toEqual([TARGET]);
  });

  it("rebuilds the memory cache from repository records on startup", () => {
    const bindings = new FakeBindingRepository(undefined, { withList: true });
    bindings.seed({
      id: "tb_seed",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
      defaultModel: "gpt-5.5",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    const router = new SessionRouter({ bindings });
    bindings.clear();

    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread_123",
      defaultModel: "gpt-5.5",
    } satisfies SessionRoute);
    expect(bindings.lists).toBe(1);
    expect(bindings.reads).toEqual([]);
    expect(bindings.writes).toEqual([]);
  });

  it("does not update cache when bind write fails", () => {
    const bindings = new FakeBindingRepository();
    bindings.writeError = new Error("sqlite unavailable");
    const router = new SessionRouter({ bindings });

    expect(() =>
      router.bind(TARGET, {
        projectId: "web",
        cwd: "/repo/web",
      }),
    ).toThrow("sqlite unavailable");

    expect(router.resolve(TARGET)).toEqual({
      kind: "unbound",
      target: TARGET,
    } satisfies SessionRoute);
    expect(bindings.writes).toEqual([]);
  });

  it("does not update an existing project binding when bindThread write fails", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });
    router.bind(TARGET, {
      projectId: "web",
      cwd: "/repo/web",
    });

    bindings.writeError = new Error("sqlite unavailable");

    expect(() => router.bindThread(TARGET, "thread_123")).toThrow("sqlite unavailable");
    expect(router.resolve(TARGET)).toEqual({
      kind: "bound",
      target: TARGET,
      projectId: "web",
      cwd: "/repo/web",
    } satisfies SessionRoute);
    expect(bindings.writes).toEqual([
      {
        target: TARGET,
        projectId: "web",
        cwd: "/repo/web",
      },
    ]);
  });
});

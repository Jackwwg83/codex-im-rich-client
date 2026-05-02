import type { Target } from "./types.js";

export type SessionRoute =
  | {
      readonly kind: "unbound";
      readonly target: Target;
    }
  | {
      readonly kind: "bound";
      readonly target: Target;
      readonly projectId: string;
      readonly cwd: string;
      readonly codexThreadId?: string;
      readonly defaultModel?: string;
      readonly activeTurnId?: string;
    };

export interface SessionBindingInput {
  projectId: string;
  cwd: string;
  codexThreadId?: string;
  defaultModel?: string;
  activeTurnId?: string;
}

export interface SessionThreadBindingRecord extends SessionBindingInput {
  id: string;
  target: Target;
  createdAt: string;
  updatedAt: string;
}

export interface SessionBindingRepository {
  upsert(input: SessionBindingInput & { target: Target }): SessionThreadBindingRecord;
  findByTarget(target: Target): SessionThreadBindingRecord | undefined;
  list?(): SessionThreadBindingRecord[];
}

export interface SessionRouterOptions {
  bindings?: SessionBindingRepository;
}

function targetKey(target: Target): string {
  return JSON.stringify([
    target.platform,
    target.chatId,
    target.threadKey ?? null,
    target.topicId ?? null,
  ]);
}

function routeFromRecord(record: SessionThreadBindingRecord): SessionRoute {
  return {
    kind: "bound",
    target: record.target,
    projectId: record.projectId,
    cwd: record.cwd,
    ...(record.codexThreadId !== undefined ? { codexThreadId: record.codexThreadId } : {}),
    ...(record.defaultModel !== undefined ? { defaultModel: record.defaultModel } : {}),
    ...(record.activeTurnId !== undefined ? { activeTurnId: record.activeTurnId } : {}),
  };
}

export class SessionRouter {
  readonly #bindings: SessionBindingRepository | undefined;
  readonly #cache = new Map<string, SessionRoute>();

  constructor(options: SessionRouterOptions = {}) {
    this.#bindings = options.bindings;
    for (const record of options.bindings?.list?.() ?? []) {
      const route = routeFromRecord(record);
      this.#cache.set(targetKey(route.target), route);
    }
  }

  resolve(target: Target): SessionRoute {
    const cached = this.#cache.get(targetKey(target));
    if (cached !== undefined) {
      return cached;
    }

    const record = this.#bindings?.findByTarget(target);
    if (record === undefined) {
      return { kind: "unbound", target };
    }

    const route = routeFromRecord(record);
    this.#cache.set(targetKey(target), route);
    return route;
  }

  bind(target: Target, input: SessionBindingInput): SessionRoute {
    const bindings = this.#requireBindings();
    const route = routeFromRecord(bindings.upsert({ target, ...input }));
    this.#cache.set(targetKey(target), route);
    return route;
  }

  bindThread(target: Target, codexThreadId: string): SessionRoute {
    const current = this.resolve(target);
    if (current.kind !== "bound") {
      throw new Error("Cannot bind Codex thread before target is bound to a project");
    }

    return this.bind(target, {
      projectId: current.projectId,
      cwd: current.cwd,
      codexThreadId,
      ...(current.defaultModel !== undefined ? { defaultModel: current.defaultModel } : {}),
      ...(current.activeTurnId !== undefined ? { activeTurnId: current.activeTurnId } : {}),
    });
  }

  #requireBindings(): SessionBindingRepository {
    if (this.#bindings === undefined) {
      throw new Error("SessionRouter requires a binding repository for persistent writes");
    }

    return this.#bindings;
  }
}

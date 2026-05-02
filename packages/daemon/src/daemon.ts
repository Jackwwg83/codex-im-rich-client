import { type IMRoutableApprovalMethod, IM_ROUTABLE_APPROVAL_METHODS } from "@codex-im/core";

type MaybePromise<T> = T | Promise<T>;

export interface DaemonBroker {
  attach(): void;
  enablePendingMode(method: IMRoutableApprovalMethod): void;
}

export interface DaemonBrokerContext {
  readonly config: unknown;
  readonly storage: unknown;
}

export interface DaemonDependencyContext extends DaemonBrokerContext {
  readonly broker: DaemonBroker | undefined;
}

export interface DaemonSessionRouterContext extends DaemonDependencyContext {
  readonly securityPolicy: unknown;
}

export interface DaemonSupervisorContext extends DaemonSessionRouterContext {
  readonly sessionRouter: unknown;
}

export interface DaemonOptions {
  readonly loadConfig?: () => MaybePromise<unknown>;
  readonly openStorage?: (config: unknown) => MaybePromise<unknown>;
  readonly createBroker?: (ctx: DaemonBrokerContext) => MaybePromise<DaemonBroker>;
  readonly createSecurityPolicy?: (ctx: DaemonDependencyContext) => MaybePromise<unknown>;
  readonly createSessionRouter?: (ctx: DaemonSessionRouterContext) => MaybePromise<unknown>;
  readonly createSupervisor?: (ctx: DaemonSupervisorContext) => MaybePromise<unknown>;
  readonly createAdapter?: () => unknown;
}

export class Daemon {
  readonly options: DaemonOptions;
  #started = false;
  #config: unknown;
  #storage: unknown;
  #broker: DaemonBroker | undefined;
  #securityPolicy: unknown;
  #sessionRouter: unknown;
  #supervisor: unknown;

  constructor(options: DaemonOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    this.#config = await this.options.loadConfig?.();
    this.#storage = await this.options.openStorage?.(this.#config);
    this.#broker = await this.options.createBroker?.({
      config: this.#config,
      storage: this.#storage,
    });
    this.#broker?.attach();
    for (const method of IM_ROUTABLE_APPROVAL_METHODS) {
      this.#broker?.enablePendingMode(method);
    }
    const dependencyContext: DaemonDependencyContext = {
      config: this.#config,
      storage: this.#storage,
      broker: this.#broker,
    };
    this.#securityPolicy = await this.options.createSecurityPolicy?.(dependencyContext);
    this.#sessionRouter = await this.options.createSessionRouter?.({
      ...dependencyContext,
      securityPolicy: this.#securityPolicy,
    });
    this.#supervisor = await this.options.createSupervisor?.({
      ...dependencyContext,
      securityPolicy: this.#securityPolicy,
      sessionRouter: this.#sessionRouter,
    });
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  isStarted(): boolean {
    return this.#started;
  }
}

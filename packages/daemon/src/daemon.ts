import { type IMRoutableApprovalMethod, IM_ROUTABLE_APPROVAL_METHODS } from "@codex-im/core";

type MaybePromise<T> = T | Promise<T>;
type Unsubscribe = () => void;

export interface DaemonBroker {
  attach(): void;
  enablePendingMode(method: IMRoutableApprovalMethod): void;
  onPendingCreated?(handler: (snapshot: unknown) => void): Unsubscribe;
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

export interface DaemonAdapterContext extends DaemonSupervisorContext {
  readonly supervisor: unknown;
}

export interface DaemonAdapter {
  onAction(handler: (action: unknown) => void): Unsubscribe;
  onMessage(handler: (message: unknown) => void): Unsubscribe;
  start?(): MaybePromise<void>;
  stop?(): MaybePromise<void>;
}

export interface DaemonOptions {
  readonly loadConfig?: () => MaybePromise<unknown>;
  readonly openStorage?: (config: unknown) => MaybePromise<unknown>;
  readonly createBroker?: (ctx: DaemonBrokerContext) => MaybePromise<DaemonBroker>;
  readonly createSecurityPolicy?: (ctx: DaemonDependencyContext) => MaybePromise<unknown>;
  readonly createSessionRouter?: (ctx: DaemonSessionRouterContext) => MaybePromise<unknown>;
  readonly createSupervisor?: (ctx: DaemonSupervisorContext) => MaybePromise<unknown>;
  readonly createAdapter?: (ctx: DaemonAdapterContext) => MaybePromise<DaemonAdapter>;
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
  #adapter: DaemonAdapter | undefined;
  readonly #unsubscribers: Unsubscribe[] = [];

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
    const adapterContext: DaemonAdapterContext = {
      ...dependencyContext,
      securityPolicy: this.#securityPolicy,
      sessionRouter: this.#sessionRouter,
      supervisor: this.#supervisor,
    };
    this.#adapter = await this.options.createAdapter?.(adapterContext);
    this.#subscribe(
      this.#broker?.onPendingCreated?.((snapshot) => this.#handlePendingCreated(snapshot)),
    );
    this.#subscribe(this.#adapter?.onAction((action) => this.#handleAction(action)));
    this.#subscribe(this.#adapter?.onMessage((message) => this.#handleMessage(message)));
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  isStarted(): boolean {
    return this.#started;
  }

  #subscribe(unsubscribe: Unsubscribe | undefined): void {
    if (unsubscribe !== undefined) {
      this.#unsubscribers.push(unsubscribe);
    }
  }

  #handlePendingCreated(_snapshot: unknown): void {}

  #handleAction(_action: unknown): void {}

  #handleMessage(_message: unknown): void {}
}

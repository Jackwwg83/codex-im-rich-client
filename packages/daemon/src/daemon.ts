type MaybePromise<T> = T | Promise<T>;

export interface DaemonBroker {
  attach(): void;
}

export interface DaemonBrokerContext {
  readonly config: unknown;
  readonly storage: unknown;
}

export interface DaemonOptions {
  readonly loadConfig?: () => MaybePromise<unknown>;
  readonly openStorage?: (config: unknown) => MaybePromise<unknown>;
  readonly createBroker?: (ctx: DaemonBrokerContext) => MaybePromise<DaemonBroker>;
  readonly createSecurityPolicy?: () => unknown;
  readonly createSessionRouter?: () => unknown;
  readonly createSupervisor?: () => unknown;
  readonly createAdapter?: () => unknown;
}

export class Daemon {
  readonly options: DaemonOptions;
  #started = false;
  #config: unknown;
  #storage: unknown;
  #broker: DaemonBroker | undefined;

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
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  isStarted(): boolean {
    return this.#started;
  }
}

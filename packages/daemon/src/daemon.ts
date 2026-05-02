export interface DaemonOptions {
  readonly loadConfig?: () => unknown;
  readonly openStorage?: () => unknown;
  readonly createBroker?: () => unknown;
  readonly createSecurityPolicy?: () => unknown;
  readonly createSessionRouter?: () => unknown;
  readonly createSupervisor?: () => unknown;
  readonly createAdapter?: () => unknown;
}

export class Daemon {
  readonly options: DaemonOptions;
  #started = false;

  constructor(options: DaemonOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  isStarted(): boolean {
    return this.#started;
  }
}

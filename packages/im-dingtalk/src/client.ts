import { DWClient, EventAck, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";

export const DINGTALK_TOPIC_ROBOT = TOPIC_ROBOT;
export const DINGTALK_TOPIC_CARD = TOPIC_CARD;

export interface DingTalkStreamEventLike {
  readonly headers?: {
    readonly messageId?: string;
    readonly topic?: string;
  };
  readonly data?: string;
}

export type DingTalkStreamEventHandler = (event: DingTalkStreamEventLike) => void | Promise<void>;

export interface DingTalkStreamClientLike {
  registerCallbackListener(
    topic: string,
    handler: DingTalkStreamEventHandler,
  ): DingTalkStreamClientLike | undefined;
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  ackCallback?(messageId: string): void | Promise<void>;
}

export interface DingTalkStreamClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly ua?: string;
  readonly keepAlive?: boolean;
  readonly debug?: boolean;
}

export interface DingTalkDwClientLike {
  registerCallbackListener(
    topic: string,
    handler: DingTalkStreamEventHandler,
  ): DingTalkDwClientLike | undefined;
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  socketCallBackResponse(messageId: string, result: unknown): void;
}

export interface DingTalkStreamClientDeps {
  readonly createClient?: (config: DingTalkStreamClientConfig) => DingTalkDwClientLike;
}

export function createDingTalkStreamClient(
  config: DingTalkStreamClientConfig,
  deps: DingTalkStreamClientDeps = {},
): DingTalkStreamClientLike {
  const client =
    deps.createClient?.(config) ??
    (new DWClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      ...(config.ua === undefined ? {} : { ua: config.ua }),
      ...(config.keepAlive === undefined ? {} : { keepAlive: config.keepAlive }),
      ...(config.debug === undefined ? {} : { debug: config.debug }),
    }) as unknown as DingTalkDwClientLike);
  return new DingTalkStreamClient(client);
}

class DingTalkStreamClient implements DingTalkStreamClientLike {
  readonly #client: DingTalkDwClientLike;

  constructor(client: DingTalkDwClientLike) {
    this.#client = client;
  }

  registerCallbackListener(
    topic: string,
    handler: DingTalkStreamEventHandler,
  ): DingTalkStreamClientLike | undefined {
    this.#client.registerCallbackListener(topic, handler);
    return this;
  }

  connect(): void | Promise<void> {
    return this.#client.connect();
  }

  disconnect(): void | Promise<void> {
    return this.#client.disconnect();
  }

  ackCallback(messageId: string): void {
    this.#client.socketCallBackResponse(messageId, { status: EventAck.SUCCESS });
  }
}

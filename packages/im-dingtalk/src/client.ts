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

export interface DingTalkSessionReplyTextClientLike {
  sendText(input: {
    readonly sessionWebhook: string;
    readonly text: string;
  }): Promise<{ readonly messageId?: string }>;
}

export interface DingTalkSessionReplyTextClientDeps {
  readonly fetch?: typeof fetch;
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

export function createDingTalkSessionReplyTextClient(
  deps: DingTalkSessionReplyTextClientDeps = {},
): DingTalkSessionReplyTextClientLike {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  return {
    async sendText(input) {
      const response = await fetchImpl(input.sessionWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: input.text },
        }),
      });
      if (!response.ok) {
        throw new Error(`DingTalk session reply failed with HTTP ${response.status}`);
      }
      const body = await readJsonBody(response);
      const errorCode = numericField(body, "errcode") ?? numericField(body, "code");
      if (errorCode !== undefined && errorCode !== 0) {
        throw new Error(`DingTalk session reply failed with code ${errorCode}`);
      }
      const messageId = stringField(body, "messageId") ?? stringField(body, "msgId");
      return messageId === undefined ? {} : { messageId };
    },
  };
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

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numericField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

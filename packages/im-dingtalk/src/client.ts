import { randomUUID } from "node:crypto";
import type { ActionAck, MessageRef, Target } from "@codex-im/channel-core";
import { DWClient, EventAck, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";
import type { DingTalkApprovalCardJson } from "./card.js";

export const DINGTALK_TOPIC_ROBOT = TOPIC_ROBOT;
export const DINGTALK_TOPIC_CARD = TOPIC_CARD;
const DINGTALK_OPENAPI_BASE_URL = "https://api.dingtalk.com";
const DINGTALK_ACCESS_TOKEN_PATH = "/v1.0/oauth2/accessToken";
const DINGTALK_CREATE_AND_DELIVER_CARD_PATH = "/v1.0/card/instances/createAndDeliver";
const DINGTALK_UPDATE_CARD_PATH = "/v1.0/card/instances";
const DINGTALK_ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

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

export interface DingTalkCardClientLike {
  sendCard(input: { target: Target; card: DingTalkApprovalCardJson }): Promise<{
    messageId: string;
  }>;
  updateCard(input: { messageRef: MessageRef; card: DingTalkApprovalCardJson }): Promise<void>;
  editText(input: { messageRef: MessageRef; text: string }): Promise<void>;
}

export interface DingTalkActionClientLike {
  answerAction(input: {
    callbackHandle: string;
    streamMessageId: string;
    outTrackId: string;
    receivedAt: Date;
    ack: ActionAck;
  }): Promise<void>;
}

export interface DingTalkOpenApiCardClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly robotCode: string;
  readonly cardTemplateId: string;
  readonly callbackRouteKey?: string;
  readonly baseUrl?: string;
}

export interface DingTalkOpenApiCardClientDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomId?: () => string;
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

export function createDingTalkOpenApiCardClient(
  config: DingTalkOpenApiCardClientConfig,
  deps: DingTalkOpenApiCardClientDeps = {},
): DingTalkCardClientLike {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? randomUUID;
  const baseUrl = config.baseUrl ?? DINGTALK_OPENAPI_BASE_URL;
  const tokenCache: { token?: string; expiresAtMs?: number } = {};

  async function accessToken(): Promise<string> {
    if (
      tokenCache.token !== undefined &&
      tokenCache.expiresAtMs !== undefined &&
      now() < tokenCache.expiresAtMs
    ) {
      return tokenCache.token;
    }
    const body = await requestJson(fetchImpl, `${baseUrl}${DINGTALK_ACCESS_TOKEN_PATH}`, {
      operation: "accessToken",
      method: "POST",
      body: {
        appKey: config.clientId,
        appSecret: config.clientSecret,
      },
    });
    const token = stringField(body, "accessToken");
    if (token === undefined) {
      throw new Error("DingTalk OpenAPI accessToken failed: missing accessToken");
    }
    const expireInSeconds = numericField(body, "expireIn") ?? 7200;
    tokenCache.token = token;
    tokenCache.expiresAtMs =
      now() + Math.max(0, expireInSeconds * 1000 - DINGTALK_ACCESS_TOKEN_REFRESH_SKEW_MS);
    return token;
  }

  async function cardRequest(
    operation: string,
    path: string,
    method: "POST" | "PUT",
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = await accessToken();
    return requestJson(fetchImpl, `${baseUrl}${path}`, {
      operation,
      method,
      token,
      body,
    });
  }

  return {
    async sendCard(input) {
      const outTrackId = `codex-im-${randomId()}`;
      const body = createAndDeliverCardBody({
        card: input.card,
        target: input.target,
        outTrackId,
        robotCode: config.robotCode,
        cardTemplateId: config.cardTemplateId,
        ...(config.callbackRouteKey === undefined
          ? {}
          : { callbackRouteKey: config.callbackRouteKey }),
      });
      const response = await cardRequest(
        "createAndDeliver",
        DINGTALK_CREATE_AND_DELIVER_CARD_PATH,
        "POST",
        body,
      );
      const result = asRecord(response.result) ?? {};
      return { messageId: stringField(result, "outTrackId") ?? outTrackId };
    },

    async updateCard(input) {
      await cardRequest("updateCard", DINGTALK_UPDATE_CARD_PATH, "PUT", {
        outTrackId: input.messageRef.messageId,
        cardData: { cardParamMap: cardParamMap(input.card) },
        cardUpdateOptions: {
          updateCardDataByKey: true,
          updatePrivateDataByKey: true,
        },
      });
    },

    async editText(input) {
      await cardRequest("editText", DINGTALK_UPDATE_CARD_PATH, "PUT", {
        outTrackId: input.messageRef.messageId,
        cardData: {
          cardParamMap: {
            title: "Codex",
            markdown: input.text,
            status: "updated",
            card_json: JSON.stringify({ title: "Codex", text: input.text }),
          },
        },
        cardUpdateOptions: {
          updateCardDataByKey: true,
          updatePrivateDataByKey: true,
        },
      });
    },
  };
}

export function createDingTalkNoopActionClient(): DingTalkActionClientLike {
  return {
    async answerAction() {
      // DingTalk Stream callbacks are acknowledged at receipt time.
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

interface CreateAndDeliverInput {
  readonly card: DingTalkApprovalCardJson;
  readonly target: Target;
  readonly outTrackId: string;
  readonly robotCode: string;
  readonly cardTemplateId: string;
  readonly callbackRouteKey?: string;
}

function createAndDeliverCardBody(input: CreateAndDeliverInput): Record<string, unknown> {
  const openSpace = openSpaceForTarget(input.target);
  return {
    callbackType: "STREAM",
    userIdType: 1,
    ...(input.callbackRouteKey === undefined ? {} : { callbackRouteKey: input.callbackRouteKey }),
    cardTemplateId: input.cardTemplateId,
    outTrackId: input.outTrackId,
    openSpaceId: openSpace.openSpaceId,
    cardData: { cardParamMap: cardParamMap(input.card) },
    ...(openSpace.kind === "group"
      ? {
          imGroupOpenSpaceModel: {
            notification: {
              alertContent: input.card.title,
              notificationOff: false,
            },
            supportForward: false,
          },
          imGroupOpenDeliverModel: {
            robotCode: input.robotCode,
          },
        }
      : {
          imRobotOpenSpaceModel: {
            notification: {
              alertContent: input.card.title,
              notificationOff: false,
            },
            supportForward: false,
          },
          imRobotOpenDeliverModel: {
            robotCode: input.robotCode,
            spaceType: "IM_ROBOT",
          },
        }),
  };
}

function openSpaceForTarget(target: Target): { kind: "group" | "robot"; openSpaceId: string } {
  if (target.chatId.startsWith("dtv1.card//IM_GROUP.")) {
    return { kind: "group", openSpaceId: target.chatId };
  }
  if (target.chatId.startsWith("dtv1.card//IM_ROBOT.")) {
    return { kind: "robot", openSpaceId: target.chatId };
  }
  if (target.chatId.startsWith("cid")) {
    return { kind: "group", openSpaceId: `dtv1.card//IM_GROUP.${target.chatId}` };
  }
  return { kind: "robot", openSpaceId: `dtv1.card//IM_ROBOT.${target.chatId}` };
}

function cardParamMap(card: DingTalkApprovalCardJson): Record<string, string> {
  return {
    title: card.title,
    markdown: card.body.map((block) => block.text).join("\n\n"),
    status: card.body.map((block) => block.text).join("\n"),
    actions_json: JSON.stringify(card.actions),
    card_json: JSON.stringify(card),
    ...Object.fromEntries(
      card.actions.flatMap((action, index) => {
        const ordinal = String(index + 1);
        return [
          [`action_${ordinal}_text`, action.text],
          [`action_${ordinal}_value`, action.value],
          [`action_${ordinal}_type`, action.type],
        ];
      }),
    ),
  };
}

interface JsonRequestOptions {
  readonly operation: string;
  readonly method: "POST" | "PUT";
  readonly token?: string;
  readonly body: Record<string, unknown>;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  options: JsonRequestOptions,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: options.method,
    headers: {
      "content-type": "application/json",
      ...(options.token === undefined ? {} : { "x-acs-dingtalk-access-token": options.token }),
    },
    body: JSON.stringify(options.body),
  });
  const body = await readJsonBody(response);
  const errorCode = errorCodeField(body);
  if (!response.ok) {
    if (response.status === 403 && options.operation === "createAndDeliver") {
      throw new Error(
        "DingTalk OpenAPI createAndDeliver failed with HTTP 403; check Card.Instance.Write permission, card template access, and delivery target",
      );
    }
    throw new Error(
      `DingTalk OpenAPI ${options.operation} failed with HTTP ${response.status}${formatErrorCode(errorCode)}`,
    );
  }
  if (errorCode !== undefined && errorCode !== 0 && errorCode !== "0") {
    throw new Error(
      `DingTalk OpenAPI ${options.operation} failed with code ${formatBareErrorCode(errorCode)}`,
    );
  }
  return body;
}

function errorCodeField(record: Record<string, unknown>): number | string | undefined {
  return (
    numericField(record, "errcode") ??
    numericField(record, "code") ??
    numericField(record, "errorCode") ??
    stringField(record, "errcode") ??
    stringField(record, "code") ??
    stringField(record, "errorCode")
  );
}

function formatErrorCode(code: number | string | undefined): string {
  if (code === undefined) {
    return "";
  }
  return ` code ${formatBareErrorCode(code)}`;
}

function formatBareErrorCode(code: number | string): string {
  const rendered = String(code);
  return /^[A-Za-z0-9._:-]{1,120}$/.test(rendered) ? rendered : "<redacted-code>";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

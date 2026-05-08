import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { ActionAck, MessageRef, Target } from "@codex-im/channel-core";
import {
  assertInboundAttachmentWithinLimit,
  normalizeMaxInboundAttachmentBytes,
} from "@codex-im/channel-core";
import { DWClient, EventAck, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";
import type { DingTalkApprovalCardJson } from "./card.js";

export const DINGTALK_TOPIC_ROBOT = TOPIC_ROBOT;
export const DINGTALK_TOPIC_CARD = TOPIC_CARD;
const DINGTALK_OPENAPI_BASE_URL = "https://api.dingtalk.com";
const DINGTALK_OAPI_BASE_URL = "https://oapi.dingtalk.com";
const DINGTALK_ACCESS_TOKEN_PATH = "/v1.0/oauth2/accessToken";
const DINGTALK_MEDIA_UPLOAD_PATH = "/media/upload";
const DINGTALK_ROBOT_MESSAGE_FILE_DOWNLOAD_PATH = "/v1.0/robot/messageFiles/download";
const DINGTALK_ROBOT_GROUP_MESSAGE_SEND_PATH = "/v1.0/robot/groupMessages/send";
const DINGTALK_ROBOT_USER_MESSAGE_BATCH_SEND_PATH = "/v1.0/robot/oToMessages/batchSend";
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
export type DingTalkAllEventHandler = (event: DingTalkStreamEventLike) => unknown;

export interface DingTalkStreamClientLike {
  registerCallbackListener(
    topic: string,
    handler: DingTalkStreamEventHandler,
  ): DingTalkStreamClientLike | undefined;
  registerAllEventListener?(handler: DingTalkAllEventHandler): DingTalkStreamClientLike | undefined;
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
  registerAllEventListener?(handler: DingTalkAllEventHandler): DingTalkDwClientLike | undefined;
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
  sendFile?(input: {
    readonly sessionWebhook: string;
    readonly file: {
      readonly filename: string;
      readonly bytes: Uint8Array;
      readonly contentType: string;
    };
  }): Promise<{ readonly messageId?: string }>;
}

export interface DingTalkProactiveMessageClientLike {
  sendFile(input: {
    readonly target: Target;
    readonly file: {
      readonly filename: string;
      readonly bytes: Uint8Array;
      readonly contentType: string;
    };
  }): Promise<{ readonly messageId?: string }>;
}

export interface DingTalkRobotFileDownloadRequest {
  readonly downloadCode: string;
  readonly filename: string;
  readonly contentType: string;
  readonly kind: "image" | "file";
}

export interface DingTalkRobotDownloadedFile {
  readonly localPath: string;
  readonly sizeBytes?: number;
}

export interface DingTalkRobotFileClientLike {
  downloadMessageFile(
    input: DingTalkRobotFileDownloadRequest,
  ): Promise<DingTalkRobotDownloadedFile>;
}

export interface DingTalkRobotFileClientDeps {
  readonly fetch?: typeof fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly robotCode: string;
  readonly attachmentDir?: string;
  readonly baseUrl?: string;
  readonly maxInboundAttachmentBytes?: number;
  readonly now?: () => number;
  readonly randomId?: () => string;
}

export interface DingTalkSessionReplyTextClientDeps {
  readonly fetch?: typeof fetch;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly baseUrl?: string;
  readonly oapiBaseUrl?: string;
  readonly now?: () => number;
}

export interface DingTalkProactiveMessageClientDeps {
  readonly fetch?: typeof fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly robotCode: string;
  readonly baseUrl?: string;
  readonly oapiBaseUrl?: string;
  readonly now?: () => number;
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
  const baseUrl = deps.baseUrl ?? DINGTALK_OPENAPI_BASE_URL;
  const oapiBaseUrl = deps.oapiBaseUrl ?? DINGTALK_OAPI_BASE_URL;
  const now = deps.now ?? Date.now;
  const tokenCache: { token?: string; expiresAtMs?: number } = {};

  async function accessToken(): Promise<string> {
    if (
      tokenCache.token !== undefined &&
      tokenCache.expiresAtMs !== undefined &&
      now() < tokenCache.expiresAtMs
    ) {
      return tokenCache.token;
    }
    if (deps.clientId === undefined || deps.clientSecret === undefined) {
      throw new Error("DingTalk session media send requires clientId and clientSecret");
    }
    const body = await requestJson(fetchImpl, `${baseUrl}${DINGTALK_ACCESS_TOKEN_PATH}`, {
      operation: "sessionAccessToken",
      method: "POST",
      body: {
        appKey: deps.clientId,
        appSecret: deps.clientSecret,
      },
    });
    const token = stringField(body, "accessToken");
    if (token === undefined) {
      throw new Error("DingTalk session accessToken failed: missing accessToken");
    }
    const expireInSeconds = numericField(body, "expireIn") ?? 7200;
    tokenCache.token = token;
    tokenCache.expiresAtMs =
      now() + Math.max(0, expireInSeconds * 1000 - DINGTALK_ACCESS_TOKEN_REFRESH_SKEW_MS);
    return token;
  }

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
    async sendFile(input) {
      assertDingTalkSessionFile(input.file);
      const token = await accessToken();
      const { mediaId, mediaType } = await uploadDingTalkMedia({
        fetchImpl,
        oapiBaseUrl,
        token,
        file: input.file,
      });
      const body =
        mediaType === "image"
          ? { msgtype: "image", image: { media_id: mediaId } }
          : { msgtype: "file", file: { media_id: mediaId } };
      const response = await fetchImpl(input.sessionWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`DingTalk session media reply failed with HTTP ${response.status}`);
      }
      const replyBody = await readJsonBody(response);
      const errorCode = numericField(replyBody, "errcode") ?? numericField(replyBody, "code");
      if (errorCode !== undefined && errorCode !== 0) {
        throw new Error(`DingTalk session media reply failed with code ${errorCode}`);
      }
      const messageId = stringField(replyBody, "messageId") ?? stringField(replyBody, "msgId");
      return messageId === undefined ? {} : { messageId };
    },
  };
}

export function createDingTalkProactiveMessageClient(
  deps: DingTalkProactiveMessageClientDeps,
): DingTalkProactiveMessageClientLike {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? DINGTALK_OPENAPI_BASE_URL;
  const oapiBaseUrl = deps.oapiBaseUrl ?? DINGTALK_OAPI_BASE_URL;
  const now = deps.now ?? Date.now;
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
      operation: "proactiveAccessToken",
      method: "POST",
      body: {
        appKey: deps.clientId,
        appSecret: deps.clientSecret,
      },
    });
    const token = stringField(body, "accessToken");
    if (token === undefined) {
      throw new Error("DingTalk proactive accessToken failed: missing accessToken");
    }
    const expireInSeconds = numericField(body, "expireIn") ?? 7200;
    tokenCache.token = token;
    tokenCache.expiresAtMs =
      now() + Math.max(0, expireInSeconds * 1000 - DINGTALK_ACCESS_TOKEN_REFRESH_SKEW_MS);
    return token;
  }

  return {
    async sendFile(input) {
      assertDingTalkSessionFile(input.file);
      const token = await accessToken();
      const { mediaId, mediaType } = await uploadDingTalkMedia({
        fetchImpl,
        oapiBaseUrl,
        token,
        file: input.file,
      });
      const target = proactiveTargetForDingTalk(input.target);
      const response = await requestJson(
        fetchImpl,
        `${baseUrl}${
          target.kind === "group"
            ? DINGTALK_ROBOT_GROUP_MESSAGE_SEND_PATH
            : DINGTALK_ROBOT_USER_MESSAGE_BATCH_SEND_PATH
        }`,
        {
          operation: "proactiveMessageSend",
          method: "POST",
          token,
          body: {
            robotCode: deps.robotCode,
            ...proactiveFileMessagePayload(input.file, mediaId, mediaType),
            ...(target.kind === "group"
              ? { openConversationId: target.openConversationId }
              : { userIds: [target.userId] }),
          },
        },
      );
      const messageId = dingTalkDeliveryMessageId(response);
      return messageId === undefined ? {} : { messageId };
    },
  };
}

export function createDingTalkRobotFileClient(
  deps: DingTalkRobotFileClientDeps,
): DingTalkRobotFileClientLike {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? DINGTALK_OPENAPI_BASE_URL;
  const attachmentDir = deps.attachmentDir ?? defaultDingTalkAttachmentDir();
  const maxBytes = normalizeMaxInboundAttachmentBytes(deps.maxInboundAttachmentBytes);
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? randomUUID;
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
      operation: "robotFileAccessToken",
      method: "POST",
      body: {
        appKey: deps.clientId,
        appSecret: deps.clientSecret,
      },
    });
    const token = stringField(body, "accessToken");
    if (token === undefined) {
      throw new Error("DingTalk robot file accessToken failed: missing accessToken");
    }
    const expireInSeconds = numericField(body, "expireIn") ?? 7200;
    tokenCache.token = token;
    tokenCache.expiresAtMs =
      now() + Math.max(0, expireInSeconds * 1000 - DINGTALK_ACCESS_TOKEN_REFRESH_SKEW_MS);
    return token;
  }

  return {
    async downloadMessageFile(input) {
      const token = await accessToken();
      const body = await requestJson(
        fetchImpl,
        `${baseUrl}${DINGTALK_ROBOT_MESSAGE_FILE_DOWNLOAD_PATH}`,
        {
          operation: "robotMessageFileDownload",
          method: "POST",
          token,
          body: {
            downloadCode: input.downloadCode,
            robotCode: deps.robotCode,
          },
        },
      );
      const downloadUrl = stringField(body, "downloadUrl");
      if (downloadUrl === undefined) {
        throw new Error("DingTalk robot message file download failed: missing downloadUrl");
      }
      const response = await fetchImpl(downloadUrl, { method: "GET" });
      if (!response.ok) {
        throw new Error(`DingTalk robot message file fetch failed with HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertInboundAttachmentWithinLimit(bytes.byteLength, maxBytes);
      await mkdir(attachmentDir, { recursive: true, mode: 0o700 });
      await chmod(attachmentDir, 0o700);
      const localPath = join(
        attachmentDir,
        `${now()}-${randomId()}-${safeDingTalkFilename(input.filename)}`,
      );
      await writeFile(localPath, bytes, { mode: 0o600 });
      await chmod(localPath, 0o600);
      return { localPath, sizeBytes: bytes.byteLength };
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
      assertSuccessfulDeliverResults(response, "createAndDeliver");
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

  registerAllEventListener(handler: DingTalkAllEventHandler): DingTalkStreamClientLike | undefined {
    this.#client.registerAllEventListener?.((event) => {
      handler(event);
      return { status: EventAck.SUCCESS };
    });
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

function assertDingTalkSessionFile(file: {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}): void {
  if (file.filename.trim().length === 0) {
    throw new Error("DingTalk session media reply requires a filename");
  }
  if (file.bytes.byteLength === 0) {
    throw new Error("DingTalk session media reply refuses empty files");
  }
}

function dingTalkMediaType(contentType: string): "image" | "file" {
  return contentType.toLowerCase().startsWith("image/") ? "image" : "file";
}

async function uploadDingTalkMedia(input: {
  readonly fetchImpl: typeof fetch;
  readonly oapiBaseUrl: string;
  readonly token: string;
  readonly file: {
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  };
}): Promise<{ readonly mediaId: string; readonly mediaType: "image" | "file" }> {
  const mediaType = dingTalkMediaType(input.file.contentType);
  const uploadUrl = `${input.oapiBaseUrl}${DINGTALK_MEDIA_UPLOAD_PATH}?access_token=${encodeURIComponent(input.token)}&type=${mediaType}`;
  const form = new FormData();
  form.append(
    "media",
    new Blob([input.file.bytes], { type: input.file.contentType }),
    input.file.filename,
  );
  const uploadResponse = await input.fetchImpl(uploadUrl, {
    method: "POST",
    body: form,
  });
  if (!uploadResponse.ok) {
    throw new Error(`DingTalk media upload failed with HTTP ${uploadResponse.status}`);
  }
  const uploadBody = await readJsonBody(uploadResponse);
  const uploadCode = numericField(uploadBody, "errcode") ?? numericField(uploadBody, "code");
  if (uploadCode !== undefined && uploadCode !== 0) {
    throw new Error(`DingTalk media upload failed with code ${uploadCode}`);
  }
  const mediaId = stringField(uploadBody, "media_id");
  if (mediaId === undefined) {
    throw new Error("DingTalk media upload failed: missing media_id");
  }
  return { mediaId, mediaType };
}

function proactiveTargetForDingTalk(target: Target):
  | { readonly kind: "group"; readonly openConversationId: string }
  | {
      readonly kind: "user";
      readonly userId: string;
    } {
  if (target.chatId.startsWith("dtv1.card//IM_GROUP.")) {
    return {
      kind: "group",
      openConversationId: target.chatId.slice("dtv1.card//IM_GROUP.".length),
    };
  }
  if (target.chatId.startsWith("dtv1.card//IM_ROBOT.")) {
    return { kind: "user", userId: target.chatId.slice("dtv1.card//IM_ROBOT.".length) };
  }
  if (target.chatId.startsWith("cid")) {
    return { kind: "group", openConversationId: target.chatId };
  }
  return { kind: "user", userId: target.chatId };
}

function proactiveFileMessagePayload(
  file: { readonly filename: string; readonly contentType: string },
  mediaId: string,
  mediaType: "image" | "file",
): { readonly msgKey: string; readonly msgParam: string } {
  if (mediaType === "image") {
    return { msgKey: "sampleImageMsg", msgParam: JSON.stringify({ photoURL: mediaId }) };
  }
  return {
    msgKey: "sampleFile",
    msgParam: JSON.stringify({
      mediaId,
      fileName: safeDingTalkFilename(file.filename),
      fileType: dingTalkFileType(file.filename, file.contentType),
    }),
  };
}

function dingTalkFileType(filename: string, contentType: string): string {
  const extension = extname(filename).slice(1).trim();
  if (/^[A-Za-z0-9]{1,16}$/.test(extension)) {
    return extension;
  }
  const subtype = contentType.split("/")[1]?.split(/[;+]/u)[0]?.trim();
  return subtype !== undefined && /^[A-Za-z0-9]{1,16}$/.test(subtype) ? subtype : "file";
}

function dingTalkDeliveryMessageId(response: Record<string, unknown>): string | undefined {
  const result = asRecord(response.result);
  return (
    stringField(response, "messageId") ??
    stringField(response, "msgId") ??
    stringField(response, "processQueryKey") ??
    stringField(response, "outTrackId") ??
    stringField(result ?? {}, "messageId") ??
    stringField(result ?? {}, "processQueryKey") ??
    stringField(result ?? {}, "outTrackId")
  );
}

function defaultDingTalkAttachmentDir(): string {
  return join(tmpdir(), "codex-im-dingtalk-attachments");
}

function safeDingTalkFilename(filename: string): string {
  const base = basename(filename)
    .replace(/[^\w .@+-]/gu, "_")
    .trim();
  const safe = base.length === 0 || base === "." || base === ".." ? "attachment" : base;
  return safe.slice(0, 160);
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
    ...(openSpace.kind === "robot" ? { userId: openSpace.userId } : {}),
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

function openSpaceForTarget(
  target: Target,
): { kind: "group"; openSpaceId: string } | { kind: "robot"; openSpaceId: string; userId: string } {
  if (target.chatId.startsWith("dtv1.card//IM_GROUP.")) {
    return { kind: "group", openSpaceId: target.chatId };
  }
  if (target.chatId.startsWith("dtv1.card//IM_ROBOT.")) {
    return {
      kind: "robot",
      openSpaceId: target.chatId,
      userId: target.chatId.slice("dtv1.card//IM_ROBOT.".length),
    };
  }
  if (target.chatId.startsWith("cid")) {
    return { kind: "group", openSpaceId: `dtv1.card//IM_GROUP.${target.chatId}` };
  }
  return {
    kind: "robot",
    openSpaceId: `dtv1.card//IM_ROBOT.${target.chatId}`,
    userId: target.chatId,
  };
}

function cardParamMap(card: DingTalkApprovalCardJson): Record<string, string> {
  const actionSlots = Object.fromEntries(
    [0, 1, 2, 3].flatMap((index) => {
      const ordinal = String(index + 1);
      const action = card.actions[index];
      return [
        [`action_${ordinal}_text`, action?.text ?? ""],
        [`action_${ordinal}_value`, action?.value ?? ""],
        [`action_${ordinal}_type`, action?.type ?? ""],
      ];
    }),
  );
  const markdown = card.body.map((block) => block.text).join("\n\n");
  const templateStatus = dingtalkTemplateStatus(card.status);
  return {
    title: card.title,
    type: card.kind,
    amount: card.riskLevel,
    reason: card.summary,
    markdown,
    content: markdown,
    lastMessage: `${card.title}: ${card.summary}`,
    flowStatus: card.status === "pending" ? "1" : "3",
    status: templateStatus,
    imageList: "[]",
    selectedIndex: "",
    actions_json: JSON.stringify(card.actions),
    card_json: JSON.stringify(card),
    ...actionSlots,
  };
}

function dingtalkTemplateStatus(status: DingTalkApprovalCardJson["status"]): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "resolved":
      return "已处理";
    case "expired":
      return "已过期";
    case "transport_lost":
      return "已中断";
  }
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
  if (body.success === false) {
    throw new Error(
      `DingTalk OpenAPI ${options.operation} failed with success=false${formatErrorCode(
        errorCode,
      )}`,
    );
  }
  return body;
}

function assertSuccessfulDeliverResults(
  response: Record<string, unknown>,
  operation: string,
): void {
  const result = asRecord(response.result);
  const deliverResults = result?.deliverResults;
  if (!Array.isArray(deliverResults)) {
    return;
  }
  const failed = deliverResults.find((entry) => {
    const record = asRecord(entry);
    return record !== undefined && record.success === false;
  });
  const failedRecord = asRecord(failed);
  if (failedRecord === undefined) {
    return;
  }
  const spaceType = safeSpaceType(stringField(failedRecord, "spaceType"));
  const errorCode = errorCodeField(failedRecord);
  throw new Error(
    `DingTalk OpenAPI ${operation} failed with deliverResult failure${
      spaceType === undefined ? "" : ` spaceType ${spaceType}`
    }${formatErrorCode(errorCode)}`,
  );
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

function safeSpaceType(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Z_]{1,40}$/.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

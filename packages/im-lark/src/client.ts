import { Buffer } from "node:buffer";
import * as lark from "@larksuiteoapi/node-sdk";
import { LarkChannelAdapter } from "./adapter.js";
import type {
  LarkActionClientLike,
  LarkChannelAdapterOptions,
  LarkEventDispatcherLike,
  LarkMessageClientLike,
  LarkWsClientLike,
} from "./adapter.js";
import type { LarkApprovalCardJson } from "./card.js";

export interface LarkSdkChannelAdapterConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly domain?: "feishu" | "lark";
  readonly verificationToken?: string;
  readonly encryptKey?: string;
}

export interface LarkSdkDeps {
  readonly createClient?: (config: LarkSdkChannelAdapterConfig) => unknown;
  readonly createWsClient?: (config: LarkSdkChannelAdapterConfig) => LarkWsClientLike;
  readonly createEventDispatcher?: (config: LarkSdkChannelAdapterConfig) => LarkEventDispatcherLike;
}

type LarkSdkLogger = {
  readonly error: (...msg: unknown[]) => void;
  readonly warn: (...msg: unknown[]) => void;
  readonly info: (...msg: unknown[]) => void;
  readonly debug: (...msg: unknown[]) => void;
  readonly trace: (...msg: unknown[]) => void;
};

interface LarkSdkClientLike {
  readonly im: {
    readonly file: {
      readonly create: (payload: LarkSdkCreateFilePayload) => Promise<LarkSdkFileResult | null>;
    };
    readonly image: {
      readonly create: (payload: LarkSdkCreateImagePayload) => Promise<LarkSdkImageResult | null>;
    };
    readonly message: {
      readonly create: (payload: LarkSdkCreateMessagePayload) => Promise<LarkSdkMessageResult>;
      readonly reply: (payload: LarkSdkReplyMessagePayload) => Promise<LarkSdkMessageResult>;
      readonly update: (payload: LarkSdkUpdateTextPayload) => Promise<LarkSdkMessageResult>;
    };
  };
  readonly cardkit: {
    readonly v1: {
      readonly card: {
        readonly idConvert: (payload: LarkSdkCardIdConvertPayload) => Promise<LarkSdkCardIdResult>;
        readonly update: (payload: LarkSdkCardKitUpdatePayload) => Promise<LarkSdkResult>;
      };
    };
  };
}

interface LarkSdkCreateMessagePayload {
  readonly params: { readonly receive_id_type: "chat_id" };
  readonly data: {
    readonly receive_id: string;
    readonly msg_type: "text" | "interactive" | "image" | "file";
    readonly content: string;
  };
}

interface LarkSdkCreateFilePayload {
  readonly data: {
    readonly file_type: LarkSdkFileType;
    readonly file_name: string;
    readonly file: Buffer;
  };
}

interface LarkSdkCreateImagePayload {
  readonly data: {
    readonly image_type: "message";
    readonly image: Buffer;
  };
}

interface LarkSdkReplyMessagePayload {
  readonly path: { readonly message_id: string };
  readonly data: {
    readonly msg_type: "text";
    readonly content: string;
  };
}

interface LarkSdkUpdateTextPayload {
  readonly path: { readonly message_id: string };
  readonly data: {
    readonly msg_type: "text";
    readonly content: string;
  };
}

interface LarkSdkCardIdConvertPayload {
  readonly data: {
    readonly message_id: string;
  };
}

interface LarkSdkCardKitUpdatePayload {
  readonly path: {
    readonly card_id: string;
  };
  readonly data: {
    readonly card: {
      readonly type: "card_json";
      readonly data: string;
    };
    readonly sequence: number;
  };
}

interface LarkSdkResult {
  readonly code?: number;
  readonly msg?: string;
}

interface LarkSdkCardIdResult extends LarkSdkResult {
  readonly data?: {
    readonly card_id?: string;
  };
}

interface LarkSdkMessageResult extends LarkSdkResult {
  readonly data?: {
    readonly message_id?: string;
  };
}

interface LarkSdkFileResult extends LarkSdkResult {
  readonly file_key?: string;
  readonly data?: {
    readonly file_key?: string;
  };
}

interface LarkSdkImageResult extends LarkSdkResult {
  readonly image_key?: string;
  readonly data?: {
    readonly image_key?: string;
  };
}

type LarkSdkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

export const SILENT_LARK_SDK_LOGGER: LarkSdkLogger = Object.freeze({
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
});

export function createLarkSdkChannelAdapter(
  config: LarkSdkChannelAdapterConfig,
  deps: LarkSdkDeps = {},
): LarkChannelAdapter {
  return new LarkChannelAdapter(createLarkSdkAdapterOptions(config, deps));
}

export function createLarkSdkAdapterOptions(
  config: LarkSdkChannelAdapterConfig,
  deps: LarkSdkDeps = {},
): LarkChannelAdapterOptions {
  const client = (deps.createClient?.(config) ?? createDefaultClient(config)) as LarkSdkClientLike;
  const wsClient = deps.createWsClient?.(config) ?? createDefaultWsClient(config);
  return {
    wsClient,
    messageClient: createSdkMessageClient(client),
    actionClient: createSdkActionClient(),
    createEventDispatcher: () =>
      deps.createEventDispatcher?.(config) ?? createDefaultDispatcher(config),
  };
}

function createDefaultClient(config: LarkSdkChannelAdapterConfig): LarkSdkClientLike {
  return new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: larkDomain(config.domain),
    logger: SILENT_LARK_SDK_LOGGER,
    source: "codex-im",
  }) as unknown as LarkSdkClientLike;
}

function createDefaultWsClient(config: LarkSdkChannelAdapterConfig): LarkWsClientLike {
  return new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: larkDomain(config.domain),
    logger: SILENT_LARK_SDK_LOGGER,
    source: "codex-im",
  });
}

function createDefaultDispatcher(config: LarkSdkChannelAdapterConfig): LarkEventDispatcherLike {
  return new lark.EventDispatcher({
    ...(config.verificationToken === undefined
      ? {}
      : { verificationToken: config.verificationToken }),
    ...(config.encryptKey === undefined ? {} : { encryptKey: config.encryptKey }),
    logger: SILENT_LARK_SDK_LOGGER,
  });
}

function createSdkMessageClient(client: LarkSdkClientLike): LarkMessageClientLike {
  const cardIdsByMessageId = new Map<string, string>();
  let lastCardUpdateSequence = 0;
  return {
    async sendText(input) {
      const content = JSON.stringify({ text: input.text });
      const result = await callLarkSdk("sendText", () =>
        input.replyToMessageId === undefined
          ? client.im.message.create({
              params: { receive_id_type: "chat_id" },
              data: {
                receive_id: input.target.chatId,
                msg_type: "text",
                content,
              },
            })
          : client.im.message.reply({
              path: { message_id: input.replyToMessageId },
              data: { msg_type: "text", content },
            }),
      );
      return { messageId: messageIdFromResult(result) };
    },

    async editText(input) {
      assertOk(
        await callLarkSdk("editText", () =>
          client.im.message.update({
            path: { message_id: input.messageRef.messageId },
            data: {
              msg_type: "text",
              content: JSON.stringify({ text: input.text }),
            },
          }),
        ),
      );
    },

    async sendFile(input) {
      assertOutboundFile(input.file, "LarkChannelAdapter.sendFile");
      if (isLarkImageContentType(input.file.contentType)) {
        const imageResult = await callLarkSdk("uploadImage", () =>
          client.im.image.create({
            data: { image_type: "message", image: Buffer.from(input.file.bytes) },
          }),
        );
        const imageKey = imageKeyFromResult(imageResult);
        const result = await callLarkSdk("sendImage", () =>
          client.im.message.create({
            params: { receive_id_type: "chat_id" },
            data: {
              receive_id: input.target.chatId,
              msg_type: "image",
              content: JSON.stringify({ image_key: imageKey }),
            },
          }),
        );
        return { messageId: messageIdFromResult(result) };
      }
      const fileResult = await callLarkSdk("uploadFile", () =>
        client.im.file.create({
          data: {
            file_type: larkFileType(input.file),
            file_name: input.file.filename,
            file: Buffer.from(input.file.bytes),
          },
        }),
      );
      const fileKey = fileKeyFromResult(fileResult);
      const result = await callLarkSdk("sendFile", () =>
        client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: input.target.chatId,
            msg_type: "file",
            content: JSON.stringify({ file_key: fileKey }),
          },
        }),
      );
      return { messageId: messageIdFromResult(result) };
    },

    async sendCard(input) {
      const result = await callLarkSdk("sendCard", () =>
        client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: input.target.chatId,
            msg_type: "interactive",
            content: stringifyCard(input.card),
          },
        }),
      );
      return { messageId: messageIdFromResult(result) };
    },

    async updateCard(input) {
      const cardId = await cardIdForMessage(client, cardIdsByMessageId, input.messageRef.messageId);
      const sequence = lastCardUpdateSequence + 1;
      lastCardUpdateSequence = sequence;
      assertOk(
        await callLarkSdk("updateCard", () =>
          client.cardkit.v1.card.update({
            path: { card_id: cardId },
            data: {
              card: { type: "card_json", data: stringifyCard(input.card) },
              sequence,
            },
          }),
        ),
      );
    },
  };
}

function createSdkActionClient(): LarkActionClientLike {
  return {
    async answerAction() {
      // Lark long-connection callbacks are acknowledged by the SDK event handler return path.
    },
  };
}

function stringifyCard(card: LarkApprovalCardJson): string {
  return JSON.stringify(card);
}

async function cardIdForMessage(
  client: LarkSdkClientLike,
  cardIdsByMessageId: Map<string, string>,
  messageId: string,
): Promise<string> {
  const cached = cardIdsByMessageId.get(messageId);
  if (cached !== undefined) {
    return cached;
  }
  const result = await callLarkSdk("cardIdConvert", () =>
    client.cardkit.v1.card.idConvert({
      data: { message_id: messageId },
    }),
  );
  assertOk(result);
  const cardId = result.data?.card_id;
  if (cardId === undefined || cardId.length === 0) {
    throw new Error("Lark SDK response missing card_id");
  }
  cardIdsByMessageId.set(messageId, cardId);
  return cardId;
}

async function callLarkSdk<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new Error(`Lark SDK ${operation} failed: ${describeLarkSdkError(error)}`);
  }
}

function describeLarkSdkError(error: unknown): string {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const data = asRecord(response?.data);
  const code = data?.code;
  const msg = data?.msg;
  if (typeof code === "number" || typeof code === "string") {
    return typeof msg === "string" && msg.length > 0 ? `code ${code}: ${msg}` : `code ${code}`;
  }
  const message = record?.message;
  return typeof message === "string" && message.length > 0 ? message : "unknown error";
}

function messageIdFromResult(result: LarkSdkMessageResult): string {
  assertOk(result);
  const messageId = result.data?.message_id;
  if (messageId === undefined || messageId.length === 0) {
    throw new Error("Lark SDK response missing message_id");
  }
  return messageId;
}

function fileKeyFromResult(result: LarkSdkFileResult | null): string {
  assertOk(result ?? {});
  const fileKey = result?.file_key ?? result?.data?.file_key;
  if (fileKey === undefined || fileKey.length === 0) {
    throw new Error("Lark SDK response missing file_key");
  }
  return fileKey;
}

function imageKeyFromResult(result: LarkSdkImageResult | null): string {
  assertOk(result ?? {});
  const imageKey = result?.image_key ?? result?.data?.image_key;
  if (imageKey === undefined || imageKey.length === 0) {
    throw new Error("Lark SDK response missing image_key");
  }
  return imageKey;
}

function assertOk(result: LarkSdkResult): void {
  if (result.code !== undefined && result.code !== 0) {
    throw new Error(`Lark SDK returned code ${result.code}`);
  }
}

function assertOutboundFile(
  file: { filename: string; bytes: Uint8Array },
  operation: string,
): void {
  if (file.filename.trim().length === 0) {
    throw new Error(`${operation} requires a filename`);
  }
  if (file.bytes.byteLength === 0) {
    throw new Error(`${operation} refuses empty files`);
  }
}

function isLarkImageContentType(contentType: string): boolean {
  return /^(?:image\/jpeg|image\/jpg|image\/png|image\/webp|image\/gif|image\/tiff|image\/bmp|image\/x-icon|image\/vnd\.microsoft\.icon)$/iu.test(
    contentType,
  );
}

function larkFileType(file: { filename: string; contentType: string }): LarkSdkFileType {
  const filename = file.filename.toLowerCase();
  const contentType = file.contentType.toLowerCase();
  if (contentType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (contentType.includes("word") || filename.endsWith(".doc") || filename.endsWith(".docx")) {
    return "doc";
  }
  if (contentType.includes("excel") || filename.endsWith(".xls") || filename.endsWith(".xlsx")) {
    return "xls";
  }
  if (
    contentType.includes("powerpoint") ||
    filename.endsWith(".ppt") ||
    filename.endsWith(".pptx")
  ) {
    return "ppt";
  }
  if (contentType === "video/mp4" || filename.endsWith(".mp4")) return "mp4";
  if (contentType === "audio/ogg" || filename.endsWith(".opus")) return "opus";
  return "stream";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function larkDomain(domain: LarkSdkChannelAdapterConfig["domain"]): lark.Domain {
  return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

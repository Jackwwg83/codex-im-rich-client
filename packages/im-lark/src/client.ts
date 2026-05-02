import * as lark from "@larksuiteoapi/node-sdk";
import { LarkChannelAdapter } from "./adapter.js";
import type {
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

interface LarkSdkClientLike {
  readonly im: {
    readonly message: {
      readonly create: (payload: LarkSdkCreateMessagePayload) => Promise<LarkSdkMessageResult>;
      readonly reply: (payload: LarkSdkReplyMessagePayload) => Promise<LarkSdkMessageResult>;
      readonly update: (payload: LarkSdkUpdateTextPayload) => Promise<LarkSdkMessageResult>;
      readonly patch: (payload: LarkSdkPatchCardPayload) => Promise<LarkSdkResult>;
    };
  };
}

interface LarkSdkCreateMessagePayload {
  readonly params: { readonly receive_id_type: "chat_id" };
  readonly data: {
    readonly receive_id: string;
    readonly msg_type: "text" | "interactive";
    readonly content: string;
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

interface LarkSdkPatchCardPayload {
  readonly path: { readonly message_id: string };
  readonly data: { readonly content: string };
}

interface LarkSdkResult {
  readonly code?: number;
  readonly msg?: string;
}

interface LarkSdkMessageResult extends LarkSdkResult {
  readonly data?: {
    readonly message_id?: string;
  };
}

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
    source: "codex-im",
  }) as unknown as LarkSdkClientLike;
}

function createDefaultWsClient(config: LarkSdkChannelAdapterConfig): LarkWsClientLike {
  return new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: larkDomain(config.domain),
    source: "codex-im",
  });
}

function createDefaultDispatcher(config: LarkSdkChannelAdapterConfig): LarkEventDispatcherLike {
  return new lark.EventDispatcher({
    ...(config.verificationToken === undefined
      ? {}
      : { verificationToken: config.verificationToken }),
    ...(config.encryptKey === undefined ? {} : { encryptKey: config.encryptKey }),
  });
}

function createSdkMessageClient(client: LarkSdkClientLike): LarkMessageClientLike {
  return {
    async sendText(input) {
      const content = JSON.stringify({ text: input.text });
      const result =
        input.replyToMessageId === undefined
          ? await client.im.message.create({
              params: { receive_id_type: "chat_id" },
              data: {
                receive_id: input.target.chatId,
                msg_type: "text",
                content,
              },
            })
          : await client.im.message.reply({
              path: { message_id: input.replyToMessageId },
              data: { msg_type: "text", content },
            });
      return { messageId: messageIdFromResult(result) };
    },

    async editText(input) {
      assertOk(
        await client.im.message.update({
          path: { message_id: input.messageRef.messageId },
          data: {
            msg_type: "text",
            content: JSON.stringify({ text: input.text }),
          },
        }),
      );
    },

    async sendCard(input) {
      const result = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: input.target.chatId,
          msg_type: "interactive",
          content: stringifyCard(input.card),
        },
      });
      return { messageId: messageIdFromResult(result) };
    },

    async updateCard(input) {
      assertOk(
        await client.im.message.patch({
          path: { message_id: input.messageRef.messageId },
          data: { content: stringifyCard(input.card) },
        }),
      );
    },
  };
}

function stringifyCard(card: LarkApprovalCardJson): string {
  return JSON.stringify(card);
}

function messageIdFromResult(result: LarkSdkMessageResult): string {
  assertOk(result);
  const messageId = result.data?.message_id;
  if (messageId === undefined || messageId.length === 0) {
    throw new Error("Lark SDK response missing message_id");
  }
  return messageId;
}

function assertOk(result: LarkSdkResult): void {
  if (result.code !== undefined && result.code !== 0) {
    throw new Error(`Lark SDK returned code ${result.code}`);
  }
}

function larkDomain(domain: LarkSdkChannelAdapterConfig["domain"]): lark.Domain {
  return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

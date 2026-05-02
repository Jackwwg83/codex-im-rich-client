import { randomBytes } from "node:crypto";
import type {
  ActionAck,
  ChannelAdapter,
  InboundAction,
  InboundMessage,
  MessageRef,
  OutboundFile,
  SendCardResult,
  Target,
} from "@codex-im/channel-core";
import { Bot } from "grammy";
import { decodeCallbackData } from "./callback-codec.js";
import { TELEGRAM_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];
type ApprovalActionInput = ApprovalCardInput["actions"][number];

export interface TelegramSendMessageOptions {
  message_thread_id?: number;
  reply_markup: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramSentMessageLike {
  readonly message_id: number | string;
}

export interface TelegramBotApiLike {
  sendMessage(
    chatId: string,
    text: string,
    options: TelegramSendMessageOptions,
  ): Promise<TelegramSentMessageLike>;
}

export interface TelegramBotLike {
  start(): Promise<void>;
  stop(): void | Promise<void>;
  readonly api?: TelegramBotApiLike;
}

export interface TelegramChannelAdapterOptions {
  readonly botToken?: string;
  readonly bot?: TelegramBotLike;
  readonly createBot?: (botToken: string) => TelegramBotLike;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly capabilities = TELEGRAM_CAPABILITIES;

  readonly #options: TelegramChannelAdapterOptions;
  #bot: TelegramBotLike | undefined;
  #started = false;

  constructor(options: TelegramChannelAdapterOptions = {}) {
    this.#options = options;
    this.#bot = options.bot;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    const bot = this.#bot ?? this.#createBot();
    await bot.start();
    this.#bot = bot;
    this.#started = true;
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    await this.#bot?.stop();
  }

  onMessage(_handler: (msg: InboundMessage) => void): () => void {
    throw notImplemented("onMessage");
  }

  onAction(_handler: (action: InboundAction) => void): () => void {
    throw notImplemented("onAction");
  }

  async sendCard(target: Target, card: ApprovalCardInput): Promise<SendCardResult> {
    this.#assertStarted("sendCard");
    const api = this.#api("sendCard");
    const options = sendMessageOptions(target, card);
    try {
      const sent = await api.sendMessage(target.chatId, formatApprovalCard(card), options);
      return {
        messageRef: { target, messageId: String(sent.message_id) },
        callbackNonce: generateCallbackNonce(),
      };
    } catch (error) {
      throw new Error(`TelegramChannelAdapter.sendCard failed: ${describeTelegramError(error)}`);
    }
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    throw notImplemented("updateCard");
  }

  async editText(_ref: MessageRef, _body: string): Promise<void> {
    throw notImplemented("editText");
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    throw notImplemented("answerAction");
  }

  async sendFile(_target: Target, _file: OutboundFile): Promise<MessageRef> {
    throw notImplemented("sendFile");
  }

  #createBot(): TelegramBotLike {
    const botToken = this.#options.botToken;
    if (botToken === undefined || botToken.length === 0) {
      throw new Error("TelegramChannelAdapter requires botToken before start()");
    }
    return (this.#options.createBot ?? ((token) => new Bot(token) as unknown as TelegramBotLike))(
      botToken,
    );
  }

  #assertStarted(method: string): void {
    if (!this.#started) {
      throw new Error(`TelegramChannelAdapter.${method} requires start() first`);
    }
  }

  #api(method: string): TelegramBotApiLike {
    const api = this.#bot?.api;
    if (api === undefined) {
      throw new Error(`TelegramChannelAdapter.${method} requires a bot API`);
    }
    return api;
  }
}

function notImplemented(method: string): Error {
  return new Error(`TelegramChannelAdapter.${method} is not implemented until its Phase 3 slice`);
}

function sendMessageOptions(target: Target, card: ApprovalCardInput): TelegramSendMessageOptions {
  const inlineKeyboard = card.actions.map((action) => [buttonForAction(action)]);
  const messageThreadId = parseTelegramTopicId(target.topicId);
  return {
    ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
    reply_markup: { inline_keyboard: inlineKeyboard },
  };
}

function buttonForAction(action: ApprovalActionInput): TelegramInlineKeyboardButton {
  const callbackData = action.wirePayload;
  if (callbackData === undefined) {
    throw new Error("TelegramChannelAdapter.sendCard requires action.wirePayload");
  }
  if (decodeCallbackData(callbackData) === undefined) {
    throw new Error("TelegramChannelAdapter.sendCard invalid v1 opaque callback_data");
  }
  const bytes = new TextEncoder().encode(callbackData).byteLength;
  if (bytes > TELEGRAM_CAPABILITIES.maxCallbackDataBytes) {
    throw new Error(
      `TelegramChannelAdapter.sendCard callback_data is ${bytes}B, exceeds ${TELEGRAM_CAPABILITIES.maxCallbackDataBytes}B Telegram limit`,
    );
  }
  return { text: labelForAction(action), callback_data: callbackData };
}

function labelForAction(action: ApprovalActionInput): string {
  switch (action.kind) {
    case "allow_once":
      return "Allow once";
    case "allow_session":
      return "Allow session";
    case "decline":
      return "Decline";
    case "abort":
      return "Abort";
  }
  const _exhaustive: never = action;
  return _exhaustive;
}

function formatApprovalCard(card: ApprovalCardInput): string {
  return [
    card.summary,
    `Approval: ${card.approvalId}`,
    `Kind: ${card.kind}`,
    `Risk: ${card.target.riskLevel}`,
    `Status: ${card.status}`,
  ].join("\n");
}

function parseTelegramTopicId(topicId: string | undefined): number | undefined {
  if (topicId === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(topicId, 10);
  if (Number.isSafeInteger(parsed) && String(parsed) === topicId) {
    return parsed;
  }
  throw new Error("TelegramChannelAdapter.sendCard requires numeric Telegram topicId");
}

function generateCallbackNonce(): string {
  return randomBytes(16).toString("hex");
}

function describeTelegramError(error: unknown): string {
  if (isTelegramApiError(error)) {
    const retryAfter = error.parameters?.retry_after;
    const retrySuffix = retryAfter !== undefined ? ` retry_after=${retryAfter}` : "";
    return `api ${error.error_code} ${error.description}${retrySuffix}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}

function isTelegramApiError(error: unknown): error is {
  readonly error_code: number;
  readonly description: string;
  readonly parameters?: { readonly retry_after?: number };
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "error_code" in error &&
    "description" in error &&
    typeof (error as { error_code?: unknown }).error_code === "number" &&
    typeof (error as { description?: unknown }).description === "string"
  );
}

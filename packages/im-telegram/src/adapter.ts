import { Buffer } from "node:buffer";
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
const ANSWER_CALLBACK_DEADLINE_MS = 60_000;
const CALLBACK_HANDLE_PREFIX = "tgcb:v1:";

export interface TelegramUserLike {
  readonly id: number | string;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

export interface TelegramChatLike {
  readonly id: number | string;
  readonly type?: string;
  readonly title?: string;
}

export interface TelegramTextMessageLike {
  readonly message_id: number | string;
  readonly message_thread_id?: number | string;
  readonly date?: number;
  readonly chat: TelegramChatLike;
  readonly from?: TelegramUserLike;
  readonly text: string;
}

export interface TelegramMessageContextLike {
  readonly message?: TelegramTextMessageLike;
  readonly chat?: TelegramChatLike;
  readonly from?: TelegramUserLike;
}

export interface TelegramCallbackMessageLike {
  readonly message_id: number | string;
  readonly message_thread_id?: number | string;
  readonly date?: number;
  readonly chat: TelegramChatLike;
}

export interface TelegramCallbackQueryLike {
  readonly id: string;
  readonly from: TelegramUserLike;
  readonly message?: TelegramCallbackMessageLike | null;
  readonly data?: string;
  readonly chat_instance?: string;
}

export interface TelegramCallbackQueryContextLike {
  readonly callbackQuery?: TelegramCallbackQueryLike;
}

export interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendMessageOptions {
  message_thread_id?: number;
  reply_markup?: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
}

export interface TelegramEditMessageReplyMarkupOptions {
  reply_markup: TelegramReplyMarkup;
}

export interface TelegramEditMessageTextOptions {
  reply_markup?: TelegramReplyMarkup;
}

export interface TelegramAnswerCallbackQueryOptions {
  text: string;
  show_alert: boolean;
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
  editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    options: TelegramEditMessageReplyMarkupOptions,
  ): Promise<unknown>;
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options: TelegramEditMessageTextOptions,
  ): Promise<unknown>;
  answerCallbackQuery(
    callbackQueryId: string,
    options: TelegramAnswerCallbackQueryOptions,
  ): Promise<unknown>;
}

export type TelegramMessageHandlerLike = (ctx: TelegramMessageContextLike) => void | Promise<void>;
export type TelegramCallbackQueryHandlerLike = (
  ctx: TelegramCallbackQueryContextLike,
) => void | Promise<void>;

export interface TelegramBotLike {
  start(): Promise<void>;
  stop(): void | Promise<void>;
  readonly api?: TelegramBotApiLike;
  on?(
    filter: "message:text" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown;
}

export interface TelegramChannelAdapterOptions {
  readonly botToken?: string;
  readonly bot?: TelegramBotLike;
  readonly createBot?: (botToken: string) => TelegramBotLike;
  readonly now?: () => Date;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly capabilities = TELEGRAM_CAPABILITIES;

  readonly #options: TelegramChannelAdapterOptions;
  #bot: TelegramBotLike | undefined;
  #started = false;
  #inboundPaused = true;
  #messageHandlerInstalled = false;
  #actionHandlerInstalled = false;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: TelegramChannelAdapterOptions = {}) {
    this.#options = options;
    this.#bot = options.bot;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    const bot = this.#bot ?? this.#createBot();
    this.#installMessageHandler(bot);
    this.#installActionHandler(bot);
    await bot.start();
    this.#bot = bot;
    this.#started = true;
    this.#inboundPaused = false;
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#inboundPaused = true;
    this.#started = false;
    await this.#bot?.stop();
  }

  async pauseInbound(): Promise<void> {
    this.#inboundPaused = true;
  }

  onMessage(handler: (msg: InboundMessage) => void): () => void {
    this.#onMessageHandlers.add(handler);
    this.#installMessageHandler(this.#bot);
    return () => {
      this.#onMessageHandlers.delete(handler);
    };
  }

  onAction(handler: (action: InboundAction) => void): () => void {
    this.#onActionHandlers.add(handler);
    this.#installActionHandler(this.#bot);
    return () => {
      this.#onActionHandlers.delete(handler);
    };
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

  async updateCard(ref: MessageRef, card: ApprovalCardInput): Promise<void> {
    this.#assertStarted("updateCard");
    const api = this.#api("updateCard");
    const messageId = parseTelegramMessageId(ref.messageId);
    const replyMarkup = sendMessageOptions(ref.target, card).reply_markup;
    if (replyMarkup === undefined) {
      throw new Error("TelegramChannelAdapter.updateCard requires approval reply_markup");
    }
    try {
      await api.editMessageReplyMarkup(ref.target.chatId, messageId, { reply_markup: replyMarkup });
      await api.editMessageText(ref.target.chatId, messageId, formatApprovalCard(card), {
        reply_markup: replyMarkup,
      });
    } catch (error) {
      throw new Error(`TelegramChannelAdapter.updateCard failed: ${describeTelegramError(error)}`);
    }
  }

  async editText(ref: MessageRef, body: string): Promise<void> {
    this.#assertStarted("editText");
    const api = this.#api("editText");
    const messageId = parseTelegramMessageId(ref.messageId);
    try {
      await api.editMessageText(ref.target.chatId, messageId, body, {});
    } catch (error) {
      throw new Error(`TelegramChannelAdapter.editText failed: ${describeTelegramError(error)}`);
    }
  }

  async sendText(target: Target, body: string): Promise<MessageRef> {
    this.#assertStarted("sendText");
    const api = this.#api("sendText");
    try {
      const sent = await api.sendMessage(target.chatId, body, sendTextOptions(target));
      return { target, messageId: String(sent.message_id) };
    } catch (error) {
      throw new Error(`TelegramChannelAdapter.sendText failed: ${describeTelegramError(error)}`);
    }
  }

  async answerAction(callbackHandle: string, ack: ActionAck): Promise<void> {
    this.#assertStarted("answerAction");
    const api = this.#api("answerAction");
    const decoded = decodeTelegramCallbackHandle(callbackHandle);
    if (decoded === undefined) {
      throw new Error("TelegramChannelAdapter.answerAction invalid callback handle");
    }
    const elapsed = this.#nowMs() - decoded.receivedAtMs;
    if (elapsed > ANSWER_CALLBACK_DEADLINE_MS) {
      throw new Error(
        `TelegramChannelAdapter.answerAction deadline exceeded (${elapsed}ms > ${ANSWER_CALLBACK_DEADLINE_MS}ms)`,
      );
    }
    try {
      await api.answerCallbackQuery(decoded.callbackQueryId, {
        text: ack.userMessage,
        show_alert: !ack.ok,
      });
    } catch (error) {
      throw new Error(
        `TelegramChannelAdapter.answerAction failed: ${describeTelegramError(error)}`,
      );
    }
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

  #nowMs(): number {
    return (this.#options.now?.() ?? new Date()).getTime();
  }

  #installMessageHandler(bot: TelegramBotLike | undefined): void {
    if (bot === undefined || this.#messageHandlerInstalled || this.#onMessageHandlers.size === 0) {
      return;
    }
    if (bot.on === undefined) {
      throw new Error('TelegramChannelAdapter.onMessage requires bot.on("message:text")');
    }
    bot.on("message:text", (ctx: TelegramMessageContextLike) => {
      this.#emitTelegramTextMessage(ctx);
    });
    this.#messageHandlerInstalled = true;
  }

  #installActionHandler(bot: TelegramBotLike | undefined): void {
    if (bot === undefined || this.#actionHandlerInstalled || this.#onActionHandlers.size === 0) {
      return;
    }
    if (bot.on === undefined) {
      throw new Error('TelegramChannelAdapter.onAction requires bot.on("callback_query:data")');
    }
    bot.on("callback_query:data", (ctx: TelegramCallbackQueryContextLike) => {
      this.#emitTelegramCallbackQuery(ctx);
    });
    this.#actionHandlerInstalled = true;
  }

  #emitTelegramTextMessage(ctx: TelegramMessageContextLike): void {
    if (!this.#acceptInbound()) {
      return;
    }
    const msg = normalizeTelegramTextMessage(ctx, this.#nowMs());
    for (const handler of this.#onMessageHandlers) {
      try {
        handler(msg);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  #emitTelegramCallbackQuery(ctx: TelegramCallbackQueryContextLike): void {
    if (!this.#acceptInbound()) {
      return;
    }
    const action = normalizeTelegramCallbackQuery(ctx, this.#nowMs());
    for (const handler of this.#onActionHandlers) {
      try {
        handler(action);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  #acceptInbound(): boolean {
    return this.#started && !this.#inboundPaused;
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

function sendTextOptions(target: Target): TelegramSendMessageOptions {
  const messageThreadId = parseTelegramTopicId(target.topicId);
  return {
    ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
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

function normalizeTelegramTextMessage(
  ctx: TelegramMessageContextLike,
  nowMs: number,
): InboundMessage {
  const message = ctx.message;
  const chat = message?.chat ?? ctx.chat;
  const from = message?.from ?? ctx.from;
  if (message === undefined || chat === undefined || from === undefined) {
    throw new Error("TelegramChannelAdapter.onMessage received incomplete message:text context");
  }

  const target = telegramTarget(chat, message.message_thread_id);
  return {
    target,
    sender: {
      userId: String(from.id),
      ...optionalDisplayName(from),
    },
    text: message.text,
    receivedAt: message.date !== undefined ? new Date(message.date * 1000) : new Date(nowMs),
    messageRef: { target, messageId: String(message.message_id) },
  };
}

function telegramTarget(
  chat: TelegramChatLike,
  messageThreadId: number | string | undefined,
): Target {
  const topicId = messageThreadId !== undefined ? String(messageThreadId) : undefined;
  return {
    platform: "telegram",
    chatId: String(chat.id),
    ...(topicId !== undefined ? { topicId } : {}),
  };
}

function normalizeTelegramCallbackQuery(
  ctx: TelegramCallbackQueryContextLike,
  nowMs: number,
): InboundAction {
  const query = ctx.callbackQuery;
  if (query === undefined || query.data === undefined) {
    throw new Error(
      "TelegramChannelAdapter.onAction received incomplete callback_query:data context",
    );
  }

  const receivedAt = new Date(nowMs);
  const target =
    query.message !== undefined && query.message !== null
      ? telegramTarget(query.message.chat, query.message.message_thread_id)
      : { platform: "telegram", chatId: "<unknown>" };
  const rawCallbackData = query.data;
  return {
    approvalId: "<opaque>",
    uiAction: { kind: "decline" },
    target,
    sender: {
      userId: String(query.from.id),
      ...optionalDisplayName(query.from),
    },
    messageRef: {
      target,
      messageId:
        query.message !== undefined && query.message !== null
          ? String(query.message.message_id)
          : "<unknown>",
    },
    callbackNonce: decodeCallbackData(rawCallbackData) ?? "",
    rawCallbackData,
    receivedAt,
    callbackHandle: encodeTelegramCallbackHandle(query.id, receivedAt),
  };
}

function optionalDisplayName(user: TelegramUserLike): { displayName?: string } {
  const displayName =
    user.username ??
    [user.first_name, user.last_name].filter((part): part is string => Boolean(part)).join(" ");
  return displayName.length > 0 ? { displayName } : {};
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

function parseTelegramMessageId(messageId: string): number {
  const parsed = Number.parseInt(messageId, 10);
  if (Number.isSafeInteger(parsed) && String(parsed) === messageId) {
    return parsed;
  }
  throw new Error("TelegramChannelAdapter requires numeric Telegram messageId");
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

export function encodeTelegramCallbackHandle(callbackQueryId: string, receivedAt: Date): string {
  if (callbackQueryId.length === 0) {
    throw new Error("Telegram callback handle requires callback query id");
  }
  const encodedId = Buffer.from(callbackQueryId, "utf8").toString("base64url");
  return `${CALLBACK_HANDLE_PREFIX}${receivedAt.getTime()}:${encodedId}`;
}

function decodeTelegramCallbackHandle(
  callbackHandle: string,
): { callbackQueryId: string; receivedAtMs: number } | undefined {
  if (!callbackHandle.startsWith(CALLBACK_HANDLE_PREFIX)) {
    return undefined;
  }
  const body = callbackHandle.slice(CALLBACK_HANDLE_PREFIX.length);
  const colon = body.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const receivedAtMs = Number.parseInt(body.slice(0, colon), 10);
  if (!Number.isSafeInteger(receivedAtMs)) {
    return undefined;
  }
  const encodedId = body.slice(colon + 1);
  if (encodedId.length === 0) {
    return undefined;
  }
  const callbackQueryId = Buffer.from(encodedId, "base64url").toString("utf8");
  return callbackQueryId.length > 0 ? { callbackQueryId, receivedAtMs } : undefined;
}

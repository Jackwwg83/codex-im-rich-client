import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  ActionAck,
  ChannelAdapter,
  InboundAction,
  InboundAttachment,
  InboundMessage,
  MessageRef,
  OutboundFile,
  SendCardResult,
  Target,
} from "@codex-im/channel-core";
import { Bot, InputFile } from "grammy";
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
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: readonly TelegramPhotoSizeLike[];
  readonly document?: TelegramDocumentLike;
}

export interface TelegramPhotoSizeLike {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly width?: number;
  readonly height?: number;
  readonly file_size?: number;
}

export interface TelegramDocumentLike {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
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

export interface TelegramSendFileOptions {
  message_thread_id?: number;
  caption?: string;
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
  sendDocument(
    chatId: string,
    document: InputFile,
    options: TelegramSendFileOptions,
  ): Promise<TelegramSentMessageLike>;
  sendPhoto(
    chatId: string,
    photo: InputFile,
    options: TelegramSendFileOptions,
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
  getFile?(fileId: string): Promise<TelegramFileInfoLike>;
}

export interface TelegramFileInfoLike {
  readonly file_id?: string;
  readonly file_unique_id?: string;
  readonly file_size?: number;
  readonly file_path?: string;
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
    filter: "message:text" | "message:photo" | "message:document" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown;
}

export interface TelegramAttachmentDownloadRequest {
  readonly fileId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly kind: "image" | "file";
  readonly messageId: string;
}

export interface TelegramDownloadedAttachment {
  readonly localPath: string;
  readonly sizeBytes?: number;
}

export interface TelegramFetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type TelegramFetchLike = (url: string) => Promise<TelegramFetchResponseLike>;

export interface TelegramChannelAdapterOptions {
  readonly botToken?: string;
  readonly bot?: TelegramBotLike;
  readonly createBot?: (botToken: string) => TelegramBotLike;
  readonly attachmentDir?: string;
  readonly downloadFile?: (
    request: TelegramAttachmentDownloadRequest,
  ) => Promise<TelegramDownloadedAttachment>;
  readonly fetch?: TelegramFetchLike;
  readonly now?: () => Date;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly capabilities = TELEGRAM_CAPABILITIES;

  readonly #options: TelegramChannelAdapterOptions;
  #bot: TelegramBotLike | undefined;
  #startError: unknown;
  #startPromise: Promise<void> | undefined;
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
    this.#bot = bot;
    this.#started = true;
    this.#inboundPaused = false;
    this.#startError = undefined;
    try {
      this.#startPromise = Promise.resolve(bot.start()).catch((error: unknown) => {
        this.#startError = error;
        this.#inboundPaused = true;
        this.#started = false;
      });
    } catch (error) {
      this.#startError = error;
      this.#inboundPaused = true;
      this.#started = false;
      throw error;
    }
    await Promise.resolve();
    if (this.#startError !== undefined) {
      this.#bot = undefined;
      throw describeTelegramStartError(this.#startError);
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#inboundPaused = true;
    this.#started = false;
    await this.#bot?.stop();
    this.#startPromise = undefined;
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
        messageRef: {
          target,
          messageId: String(sent.message_id),
          kind: "approval_card",
          textUpdateMode: "edit",
        },
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
      return { target, messageId: String(sent.message_id), kind: "text", textUpdateMode: "edit" };
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

  async sendFile(target: Target, file: OutboundFile): Promise<MessageRef> {
    this.#assertStarted("sendFile");
    const api = this.#api("sendFile");
    const upload = telegramInputFile(file);
    const options = sendFileOptions(target, file);
    try {
      const sent = isTelegramPhotoContentType(file.contentType)
        ? await api.sendPhoto(target.chatId, upload, options)
        : await api.sendDocument(target.chatId, upload, options);
      return { target, messageId: String(sent.message_id), kind: "file" };
    } catch (error) {
      throw new Error(`TelegramChannelAdapter.sendFile failed: ${describeTelegramError(error)}`);
    }
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
    if (this.#startError !== undefined) {
      throw new Error(
        `TelegramChannelAdapter.${method} requires healthy bot polling: ${describeTelegramError(
          this.#startError,
        )}`,
      );
    }
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
      throw new Error('TelegramChannelAdapter.onMessage requires bot.on("message:*")');
    }
    for (const filter of ["message:text", "message:photo", "message:document"] as const) {
      bot.on(filter, (ctx: TelegramMessageContextLike) => this.#emitTelegramMessage(ctx));
    }
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

  async #emitTelegramMessage(ctx: TelegramMessageContextLike): Promise<void> {
    if (!this.#acceptInbound()) {
      return;
    }
    const msg = await this.#normalizeTelegramMessage(ctx);
    for (const handler of this.#onMessageHandlers) {
      try {
        handler(msg);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  async #normalizeTelegramMessage(ctx: TelegramMessageContextLike): Promise<InboundMessage> {
    return normalizeTelegramTextMessage(ctx, this.#nowMs(), (request) =>
      this.#downloadTelegramAttachment(request),
    );
  }

  async #downloadTelegramAttachment(
    request: TelegramAttachmentDownloadRequest,
  ): Promise<TelegramDownloadedAttachment> {
    if (this.#options.downloadFile !== undefined) {
      return this.#options.downloadFile(request);
    }
    return downloadTelegramFile({
      request,
      api: this.#api("downloadFile"),
      botToken: this.#options.botToken,
      attachmentDir: this.#options.attachmentDir,
      fetch: this.#options.fetch,
    });
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

function sendFileOptions(target: Target, file: OutboundFile): TelegramSendFileOptions {
  const messageThreadId = parseTelegramTopicId(target.topicId);
  return {
    ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
    ...(file.filename.length > 0 ? { caption: file.filename } : {}),
  };
}

function telegramInputFile(file: OutboundFile): InputFile {
  if (file.filename.trim().length === 0) {
    throw new Error("TelegramChannelAdapter.sendFile requires a filename");
  }
  if (file.bytes.byteLength === 0) {
    throw new Error("TelegramChannelAdapter.sendFile refuses empty files");
  }
  return new InputFile(Buffer.from(file.bytes), file.filename);
}

function isTelegramPhotoContentType(contentType: string): boolean {
  return /^(?:image\/jpeg|image\/jpg|image\/png|image\/webp)$/iu.test(contentType);
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
  downloadAttachment?: (
    request: TelegramAttachmentDownloadRequest,
  ) => Promise<TelegramDownloadedAttachment>,
): Promise<InboundMessage> {
  const message = ctx.message;
  const chat = message?.chat ?? ctx.chat;
  const from = message?.from ?? ctx.from;
  if (message === undefined || chat === undefined || from === undefined) {
    throw new Error("TelegramChannelAdapter.onMessage received incomplete message context");
  }

  const target = telegramTarget(chat, message.message_thread_id);
  return materializeTelegramAttachments(message, downloadAttachment).then((attachments) => ({
    target,
    sender: {
      userId: String(from.id),
      ...optionalDisplayName(from),
    },
    text: message.text ?? message.caption ?? "",
    receivedAt: message.date !== undefined ? new Date(message.date * 1000) : new Date(nowMs),
    messageRef: { target, messageId: String(message.message_id), kind: "inbound" },
    ...(attachments.length === 0 ? {} : { attachments }),
  }));
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

async function materializeTelegramAttachments(
  message: TelegramTextMessageLike,
  downloadAttachment:
    | ((request: TelegramAttachmentDownloadRequest) => Promise<TelegramDownloadedAttachment>)
    | undefined,
): Promise<InboundAttachment[]> {
  const descriptors = telegramAttachmentDescriptors(message);
  const attachments: InboundAttachment[] = [];
  for (const descriptor of descriptors) {
    if (downloadAttachment === undefined) {
      continue;
    }
    try {
      const downloaded = await downloadAttachment(descriptor);
      attachments.push({
        kind: descriptor.kind,
        filename: descriptor.filename,
        contentType: descriptor.contentType,
        localPath: downloaded.localPath,
        ...(downloaded.sizeBytes === undefined ? {} : { sizeBytes: downloaded.sizeBytes }),
      });
    } catch {
      // Attachment download failure must not leak tokenized file URLs or block text routing.
    }
  }
  return attachments;
}

function telegramAttachmentDescriptors(
  message: TelegramTextMessageLike,
): TelegramAttachmentDownloadRequest[] {
  const descriptors: TelegramAttachmentDownloadRequest[] = [];
  const photo = largestTelegramPhoto(message.photo);
  if (photo !== undefined) {
    descriptors.push({
      fileId: photo.file_id,
      filename: `telegram-photo-${message.message_id}.jpg`,
      contentType: "image/jpeg",
      kind: "image",
      messageId: String(message.message_id),
    });
  }
  const document = message.document;
  if (document !== undefined) {
    const contentType = document.mime_type ?? "application/octet-stream";
    descriptors.push({
      fileId: document.file_id,
      filename: safeTelegramFilename(
        document.file_name ??
          `telegram-file-${message.message_id}${extensionForContentType(contentType)}`,
      ),
      contentType,
      kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
      messageId: String(message.message_id),
    });
  }
  return descriptors;
}

function largestTelegramPhoto(
  photos: readonly TelegramPhotoSizeLike[] | undefined,
): TelegramPhotoSizeLike | undefined {
  return photos?.reduce<TelegramPhotoSizeLike | undefined>((best, current) => {
    if (best === undefined) {
      return current;
    }
    return telegramPhotoScore(current) >= telegramPhotoScore(best) ? current : best;
  }, undefined);
}

function telegramPhotoScore(photo: TelegramPhotoSizeLike): number {
  return photo.file_size ?? (photo.width ?? 0) * (photo.height ?? 0);
}

async function downloadTelegramFile(input: {
  readonly request: TelegramAttachmentDownloadRequest;
  readonly api: TelegramBotApiLike;
  readonly botToken: string | undefined;
  readonly attachmentDir: string | undefined;
  readonly fetch: TelegramFetchLike | undefined;
}): Promise<TelegramDownloadedAttachment> {
  if (input.api.getFile === undefined) {
    throw new Error("TelegramChannelAdapter.downloadFile requires api.getFile");
  }
  if (input.botToken === undefined || input.botToken.length === 0) {
    throw new Error("TelegramChannelAdapter.downloadFile requires botToken");
  }
  const fileInfo = await input.api.getFile(input.request.fileId);
  const filePath = fileInfo.file_path;
  if (filePath === undefined || filePath.length === 0) {
    throw new Error("TelegramChannelAdapter.downloadFile received no file_path");
  }
  const fetchFile = telegramFetch(input.fetch);
  const response = await fetchFile(
    `https://api.telegram.org/file/bot${input.botToken}/${filePath}`,
  );
  if (!response.ok) {
    throw new Error(`TelegramChannelAdapter.downloadFile failed: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = input.attachmentDir ?? defaultTelegramAttachmentDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const localPath = join(
    dir,
    `${input.request.messageId}-${input.request.fileId.slice(0, 12)}-${safeTelegramFilename(
      input.request.filename,
    )}`,
  );
  await writeFile(localPath, bytes, { mode: 0o600 });
  return { localPath, sizeBytes: bytes.byteLength };
}

function telegramFetch(fetchOverride: TelegramFetchLike | undefined): TelegramFetchLike {
  if (fetchOverride !== undefined) {
    return fetchOverride;
  }
  const globalFetch = (globalThis as unknown as { readonly fetch?: TelegramFetchLike }).fetch;
  if (globalFetch === undefined) {
    throw new Error("TelegramChannelAdapter.downloadFile requires fetch");
  }
  return globalFetch;
}

function defaultTelegramAttachmentDir(): string {
  return join(tmpdir(), "codex-im-telegram-attachments");
}

function safeTelegramFilename(filename: string): string {
  const base = basename(filename)
    .replace(/[^\w .@+-]/gu, "_")
    .trim();
  const safe = base.length === 0 || base === "." || base === ".." ? "attachment" : base;
  return safe.slice(0, 160);
}

function extensionForContentType(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "application/pdf":
      return ".pdf";
    case "text/plain":
      return ".txt";
    default:
      return "";
  }
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
      kind: "approval_card",
      textUpdateMode: "edit",
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

function describeTelegramStartError(error: unknown): Error {
  return new Error(`TelegramChannelAdapter.start failed: ${describeTelegramError(error)}`);
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

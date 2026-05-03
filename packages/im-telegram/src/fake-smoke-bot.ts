import type { Sender, Target } from "@codex-im/channel-core";
import type {
  TelegramAnswerCallbackQueryOptions,
  TelegramBotApiLike,
  TelegramBotLike,
  TelegramCallbackQueryContextLike,
  TelegramCallbackQueryHandlerLike,
  TelegramEditMessageTextOptions,
  TelegramMessageContextLike,
  TelegramMessageHandlerLike,
  TelegramReplyMarkup,
  TelegramSendMessageOptions,
  TelegramSentMessageLike,
} from "./adapter.js";

export interface TelegramFakeSmokeMessage {
  readonly target: Target;
  readonly sender: Sender;
  readonly text: string;
  readonly messageId: string | number;
  readonly receivedAt: Date;
}

export interface TelegramFakeSmokeCallback {
  readonly target: Target;
  readonly sender: Sender;
  readonly callbackData: string;
  readonly callbackQueryId: string;
  readonly messageId: string | number;
  readonly receivedAt: Date;
}

export interface TelegramFakeSmokeSentMessage {
  readonly messageId: number;
  readonly text: string;
  readonly callbackData: readonly string[];
  readonly replyMarkup?: TelegramReplyMarkup;
}

export class TelegramFakeSmokeBot implements TelegramBotLike {
  started = false;
  stopped = false;
  readonly sentMessages: TelegramFakeSmokeSentMessage[] = [];
  readonly editedMessages: TelegramFakeSmokeSentMessage[] = [];
  readonly approvalMessages: TelegramFakeSmokeSentMessage[] = [];
  readonly callbackAnswers: string[] = [];
  #nextMessageId = 1;

  readonly api: TelegramBotApiLike = {
    sendMessage: async (
      _chatId: string,
      text: string,
      options: TelegramSendMessageOptions,
    ): Promise<TelegramSentMessageLike> => {
      const sent = this.#recordMessage(this.sentMessages, this.#nextMessageId++, text, options);
      if (sent.callbackData.length > 0) {
        this.approvalMessages.push(sent);
      }
      return { message_id: sent.messageId };
    },
    editMessageReplyMarkup: async () => true,
    editMessageText: async (
      _chatId: string,
      messageId: number,
      text: string,
      options: TelegramEditMessageTextOptions,
    ) => {
      this.#recordMessage(this.editedMessages, messageId, text, options);
      return true;
    },
    answerCallbackQuery: async (
      _callbackQueryId: string,
      options: TelegramAnswerCallbackQueryOptions,
    ) => {
      this.callbackAnswers.push(options.text);
      return true;
    },
  };

  readonly #messageTextHandlers: TelegramMessageHandlerLike[] = [];
  readonly #callbackHandlers: TelegramCallbackQueryHandlerLike[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  on(
    filter: "message:text" | "callback_query:data",
    handler: TelegramMessageHandlerLike | TelegramCallbackQueryHandlerLike,
  ): unknown {
    if (filter === "message:text") {
      this.#messageTextHandlers.push(handler as TelegramMessageHandlerLike);
      return undefined;
    }
    this.#callbackHandlers.push(handler as TelegramCallbackQueryHandlerLike);
    return undefined;
  }

  async injectTextMessage(input: TelegramFakeSmokeMessage): Promise<void> {
    const ctx = this.#textMessageContext(input);
    await Promise.all(this.#messageTextHandlers.map((handler) => handler(ctx)));
  }

  async injectCallbackQuery(input: TelegramFakeSmokeCallback): Promise<void> {
    const ctx = this.#callbackQueryContext(input);
    await Promise.all(this.#callbackHandlers.map((handler) => handler(ctx)));
  }

  hasText(fragment: string): boolean {
    return [...this.sentMessages, ...this.editedMessages].some((message) =>
      message.text.includes(fragment),
    );
  }

  #recordMessage(
    target: TelegramFakeSmokeSentMessage[],
    messageId: number,
    text: string,
    options: { readonly reply_markup?: TelegramReplyMarkup },
  ): TelegramFakeSmokeSentMessage {
    const callbackData =
      options.reply_markup?.inline_keyboard
        .flat()
        .map((button) => button.callback_data)
        .filter((value): value is string => value !== undefined) ?? [];
    const sent = {
      messageId,
      text,
      callbackData,
      ...(options.reply_markup === undefined ? {} : { replyMarkup: options.reply_markup }),
    };
    target.push(sent);
    return sent;
  }

  #textMessageContext(input: TelegramFakeSmokeMessage): TelegramMessageContextLike {
    const chat = { id: input.target.chatId, type: "supergroup", title: "CI Fake Chat" };
    const from = {
      id: input.sender.userId,
      ...(input.sender.displayName === undefined ? {} : { username: input.sender.displayName }),
    };
    const message = {
      message_id: input.messageId,
      ...(input.target.topicId === undefined ? {} : { message_thread_id: input.target.topicId }),
      date: Math.floor(input.receivedAt.getTime() / 1000),
      chat,
      from,
      text: input.text,
    };

    return { message, chat, from };
  }

  #callbackQueryContext(input: TelegramFakeSmokeCallback): TelegramCallbackQueryContextLike {
    const chat = { id: input.target.chatId, type: "supergroup", title: "CI Fake Chat" };
    const from = {
      id: input.sender.userId,
      ...(input.sender.displayName === undefined ? {} : { username: input.sender.displayName }),
    };
    return {
      callbackQuery: {
        id: input.callbackQueryId,
        from,
        data: input.callbackData,
        message: {
          message_id: input.messageId,
          ...(input.target.topicId === undefined
            ? {}
            : { message_thread_id: input.target.topicId }),
          date: Math.floor(input.receivedAt.getTime() / 1000),
          chat,
        },
      },
    };
  }
}

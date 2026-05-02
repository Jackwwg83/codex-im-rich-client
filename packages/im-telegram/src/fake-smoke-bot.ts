import type { Sender, Target } from "@codex-im/channel-core";
import type {
  TelegramAnswerCallbackQueryOptions,
  TelegramBotApiLike,
  TelegramBotLike,
  TelegramCallbackQueryContextLike,
  TelegramCallbackQueryHandlerLike,
  TelegramMessageContextLike,
  TelegramMessageHandlerLike,
  TelegramSentMessageLike,
} from "./adapter.js";

export interface TelegramFakeSmokeMessage {
  readonly target: Target;
  readonly sender: Sender;
  readonly text: string;
  readonly messageId: string | number;
  readonly receivedAt: Date;
}

export class TelegramFakeSmokeBot implements TelegramBotLike {
  started = false;
  stopped = false;
  readonly api: TelegramBotApiLike = {
    sendMessage: async (): Promise<TelegramSentMessageLike> => ({ message_id: 1 }),
    editMessageReplyMarkup: async () => true,
    editMessageText: async () => true,
    answerCallbackQuery: async (
      _callbackQueryId: string,
      _options: TelegramAnswerCallbackQueryOptions,
    ) => true,
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
}

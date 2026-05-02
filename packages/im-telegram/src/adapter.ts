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
import { TELEGRAM_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface TelegramBotLike {
  start(): Promise<void>;
  stop(): void | Promise<void>;
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

  async sendCard(_target: Target, _card: ApprovalCardInput): Promise<SendCardResult> {
    throw notImplemented("sendCard");
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
    return (this.#options.createBot ?? ((token) => new Bot(token)))(botToken);
  }
}

function notImplemented(method: string): Error {
  return new Error(`TelegramChannelAdapter.${method} is not implemented until its Phase 3 slice`);
}

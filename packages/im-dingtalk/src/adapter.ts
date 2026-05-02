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
import { DINGTALK_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface DingTalkChannelAdapterOptions {
  readonly now?: () => Date;
}

export class DingTalkChannelAdapter implements ChannelAdapter {
  readonly capabilities = DINGTALK_CAPABILITIES;

  readonly #options: DingTalkChannelAdapterOptions;
  #started = false;
  #inboundPaused = true;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: DingTalkChannelAdapterOptions = {}) {
    this.#options = options;
  }

  async start(): Promise<void> {
    throw new Error("DingTalkChannelAdapter.start requires JAC-80 Stream lifecycle implementation");
  }

  async stop(): Promise<void> {
    this.#inboundPaused = true;
    this.#started = false;
  }

  onMessage(handler: (msg: InboundMessage) => void): () => void {
    this.#onMessageHandlers.add(handler);
    return () => {
      this.#onMessageHandlers.delete(handler);
    };
  }

  onAction(handler: (action: InboundAction) => void): () => void {
    this.#onActionHandlers.add(handler);
    return () => {
      this.#onActionHandlers.delete(handler);
    };
  }

  async sendCard(_target: Target, _card: ApprovalCardInput): Promise<SendCardResult> {
    throw this.#notImplemented("sendCard", "JAC-82 card send/update");
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    throw this.#notImplemented("updateCard", "JAC-82 card send/update");
  }

  async editText(_ref: MessageRef, _body: string): Promise<void> {
    throw this.#notImplemented("editText", "JAC-82 card send/update");
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    throw this.#notImplemented("answerAction", "JAC-85 approval round-trip");
  }

  async sendFile(_target: Target, _file: OutboundFile): Promise<MessageRef> {
    throw this.#notImplemented("sendFile", "future attachment slice");
  }

  _startedForTest(): boolean {
    return this.#started;
  }

  _inboundPausedForTest(): boolean {
    return this.#inboundPaused;
  }

  _nowForTest(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #notImplemented(method: string, issue: string): Error {
    return new Error(`DingTalkChannelAdapter.${method} is not implemented until ${issue}`);
  }
}

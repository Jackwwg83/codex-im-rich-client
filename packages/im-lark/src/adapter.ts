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
import { LARK_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface LarkChannelAdapterOptions {
  readonly now?: () => Date;
}

export class LarkChannelAdapter implements ChannelAdapter {
  readonly capabilities = LARK_CAPABILITIES;

  readonly #options: LarkChannelAdapterOptions;
  #started = false;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: LarkChannelAdapterOptions = {}) {
    this.#options = options;
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  async stop(): Promise<void> {
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
    throw this.#notImplemented("sendCard", "JAC-154");
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    throw this.#notImplemented("updateCard", "JAC-155");
  }

  async editText(_ref: MessageRef, _body: string): Promise<void> {
    throw this.#notImplemented("editText", "JAC-153");
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    throw this.#notImplemented("answerAction", "JAC-158");
  }

  async sendFile(_target: Target, _file: OutboundFile): Promise<MessageRef> {
    throw this.#notImplemented("sendFile", "future Phase 4+ attachment slice");
  }

  _startedForTest(): boolean {
    return this.#started;
  }

  _nowForTest(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #notImplemented(method: string, issue: string): Error {
    return new Error(`LarkChannelAdapter.${method} is not implemented until ${issue}`);
  }
}

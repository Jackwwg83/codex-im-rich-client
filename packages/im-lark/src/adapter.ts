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
import { type LarkRawMessageEvent, normalizeLarkRawMessage } from "./message.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface LarkEventDispatcherLike {
  readonly kind?: string;
}

export interface LarkWsClientLike {
  start(input: { eventDispatcher: LarkEventDispatcherLike }): Promise<void>;
  close(params?: { force?: boolean }): void | Promise<void>;
}

export interface LarkChannelAdapterOptions {
  readonly now?: () => Date;
  readonly wsClient?: LarkWsClientLike;
  readonly createEventDispatcher?: () => LarkEventDispatcherLike;
}

export class LarkChannelAdapter implements ChannelAdapter {
  readonly capabilities = LARK_CAPABILITIES;

  readonly #options: LarkChannelAdapterOptions;
  #wsClient: LarkWsClientLike | undefined;
  #started = false;
  #inboundPaused = true;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: LarkChannelAdapterOptions = {}) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#inboundPaused = true;
    const wsClient = this.#options.wsClient;
    if (wsClient === undefined) {
      throw new Error("LarkChannelAdapter.start requires an injected wsClient");
    }
    const eventDispatcher = this.#options.createEventDispatcher?.() ?? {};
    await wsClient.start({ eventDispatcher });
    this.#wsClient = wsClient;
    this.#started = true;
    this.#inboundPaused = false;
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#inboundPaused = true;
    this.#started = false;
    await this.#wsClient?.close();
    this.#wsClient = undefined;
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

  _inboundPausedForTest(): boolean {
    return this.#inboundPaused;
  }

  _nowForTest(): Date {
    return this.#options.now?.() ?? new Date();
  }

  _emitRawMessageForTest(raw: LarkRawMessageEvent): void {
    this.#emitRawMessage(raw);
  }

  #emitRawMessage(raw: LarkRawMessageEvent): void {
    if (!this.#acceptInbound()) {
      return;
    }
    const msg = normalizeLarkRawMessage(raw, this.#nowMs());
    for (const handler of this.#onMessageHandlers) {
      try {
        handler(msg);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  #acceptInbound(): boolean {
    return this.#started && !this.#inboundPaused;
  }

  #nowMs(): number {
    return this.#options.now?.().getTime() ?? Date.now();
  }

  #notImplemented(method: string, issue: string): Error {
    return new Error(`LarkChannelAdapter.${method} is not implemented until ${issue}`);
  }
}

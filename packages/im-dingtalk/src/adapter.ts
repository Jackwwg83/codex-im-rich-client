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
import { type DingTalkApprovalCardJson, renderDingTalkApprovalCard } from "./card.js";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventLike,
} from "./client.js";
import { normalizeDingTalkRawRobotMessage } from "./message.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface DingTalkChannelAdapterOptions {
  readonly now?: () => Date;
  readonly streamClient?: DingTalkStreamClientLike;
  readonly cardClient?: DingTalkCardClientLike;
}

export interface DingTalkCardClientLike {
  sendCard(input: { target: Target; card: DingTalkApprovalCardJson }): Promise<{
    messageId: string;
  }>;
  updateCard(input: { messageRef: MessageRef; card: DingTalkApprovalCardJson }): Promise<void>;
  editText(input: { messageRef: MessageRef; text: string }): Promise<void>;
}

export class DingTalkChannelAdapter implements ChannelAdapter {
  readonly capabilities = DINGTALK_CAPABILITIES;

  readonly #options: DingTalkChannelAdapterOptions;
  #streamClient: DingTalkStreamClientLike | undefined;
  #started = false;
  #inboundPaused = true;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: DingTalkChannelAdapterOptions = {}) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#inboundPaused = true;
    const streamClient = this.#options.streamClient;
    if (streamClient === undefined) {
      throw new Error("DingTalkChannelAdapter.start requires an injected streamClient");
    }
    this.#installStreamCallbacks(streamClient);
    try {
      await streamClient.connect();
    } catch (error) {
      this.#started = false;
      this.#inboundPaused = true;
      throw error;
    }
    this.#streamClient = streamClient;
    this.#started = true;
    this.#inboundPaused = false;
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#inboundPaused = true;
    this.#started = false;
    await this.#streamClient?.disconnect();
    this.#streamClient = undefined;
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
    this.#assertStarted("sendCard");
    const cardClient = this.#cardClient("sendCard");
    const card = renderDingTalkApprovalCard(_card);
    try {
      const sent = await cardClient.sendCard({ target: _target, card });
      return { messageRef: { target: _target, messageId: sent.messageId }, callbackNonce: "" };
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.sendCard failed: ${describeError(error)}`);
    }
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    this.#assertStarted("updateCard");
    const cardClient = this.#cardClient("updateCard");
    const card = renderDingTalkApprovalCard(_card);
    try {
      await cardClient.updateCard({ messageRef: _ref, card });
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.updateCard failed: ${describeError(error)}`);
    }
  }

  async editText(_ref: MessageRef, _body: string): Promise<void> {
    this.#assertStarted("editText");
    const cardClient = this.#cardClient("editText");
    try {
      await cardClient.editText({ messageRef: _ref, text: _body });
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.editText failed: ${describeError(error)}`);
    }
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

  #assertStarted(method: string): void {
    if (!this.#started) {
      throw new Error(`DingTalkChannelAdapter.${method} requires start() first`);
    }
  }

  #cardClient(method: string): DingTalkCardClientLike {
    const cardClient = this.#options.cardClient;
    if (cardClient === undefined) {
      throw new Error(`DingTalkChannelAdapter.${method} requires an injected cardClient`);
    }
    return cardClient;
  }

  #installStreamCallbacks(streamClient: DingTalkStreamClientLike): void {
    streamClient.registerCallbackListener(DINGTALK_TOPIC_ROBOT, (event) => {
      this.#handleRobotCallback(event);
    });
    streamClient.registerCallbackListener(DINGTALK_TOPIC_CARD, (event) => {
      this.#handleCardCallback(event);
    });
  }

  #handleRobotCallback(_event: DingTalkStreamEventLike): void {
    if (!this.#acceptInbound()) {
      return;
    }
    let msg: InboundMessage;
    try {
      msg = normalizeDingTalkRawRobotMessage(_event, this.#nowMs());
    } catch {
      return;
    }
    for (const handler of this.#onMessageHandlers) {
      try {
        handler(msg);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  #handleCardCallback(_event: DingTalkStreamEventLike): void {
    if (!this.#acceptInbound()) {
      return;
    }
  }

  #acceptInbound(): boolean {
    return this.#started && !this.#inboundPaused;
  }

  #nowMs(): number {
    return this.#options.now?.().getTime() ?? Date.now();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

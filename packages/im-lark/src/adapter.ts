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
import {
  type LarkRawCardActionInput,
  decodeLarkCallbackHandle,
  normalizeLarkRawCardAction,
} from "./action.js";
import { LARK_CAPABILITIES } from "./capabilities.js";
import { type LarkApprovalCardJson, renderLarkApprovalCard } from "./card.js";
import { type LarkRawMessageEvent, normalizeLarkRawMessage } from "./message.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export interface LarkEventDispatcherLike {
  readonly kind?: string;
  register?(handlers: LarkEventHandlerMap): LarkEventDispatcherLike | undefined;
}

export interface LarkEventHandlerMap {
  "im.message.receive_v1"?: (event: LarkRawMessageEvent) => void | Promise<void>;
  "card.action.trigger"?: (event: LarkRawCardActionInput) => void | Promise<void>;
}

export interface LarkWsClientLike {
  start(input: { eventDispatcher: LarkEventDispatcherLike }): Promise<void>;
  close(params?: { force?: boolean }): void | Promise<void>;
}

export interface LarkMessageClientLike {
  sendText(input: {
    target: Target;
    text: string;
    replyToMessageId?: string;
  }): Promise<{ messageId: string }>;
  editText(input: { messageRef: MessageRef; text: string }): Promise<void>;
  sendCard?(input: { target: Target; card: LarkApprovalCardJson }): Promise<{ messageId: string }>;
  updateCard?(input: { messageRef: MessageRef; card: LarkApprovalCardJson }): Promise<void>;
}

export interface LarkActionClientLike {
  answerAction(input: {
    callbackHandle: string;
    eventId: string;
    receivedAt: Date;
    ack: ActionAck;
  }): Promise<void>;
}

export interface LarkChannelAdapterOptions {
  readonly now?: () => Date;
  readonly wsClient?: LarkWsClientLike;
  readonly messageClient?: LarkMessageClientLike;
  readonly actionClient?: LarkActionClientLike;
  readonly createEventDispatcher?: () => LarkEventDispatcherLike;
}

export class LarkChannelAdapter implements ChannelAdapter {
  readonly capabilities = LARK_CAPABILITIES;

  readonly #options: LarkChannelAdapterOptions;
  #wsClient: LarkWsClientLike | undefined;
  #started = false;
  #inboundPaused = true;
  #inboundHandlersInstalled = false;
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
    this.#installInboundHandlers(eventDispatcher);
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
    this.#inboundHandlersInstalled = false;
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
    const messageClient = this.#messageClient("sendCard");
    if (messageClient.sendCard === undefined) {
      throw new Error("LarkChannelAdapter.sendCard requires messageClient.sendCard");
    }
    const card = renderLarkApprovalCard(_card);
    try {
      const sent = await messageClient.sendCard({ target: _target, card });
      return { messageRef: { target: _target, messageId: sent.messageId }, callbackNonce: "" };
    } catch (error) {
      throw new Error(`LarkChannelAdapter.sendCard failed: ${describeError(error)}`);
    }
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    this.#assertStarted("updateCard");
    const messageClient = this.#messageClient("updateCard");
    if (messageClient.updateCard === undefined) {
      throw new Error("LarkChannelAdapter.updateCard requires messageClient.updateCard");
    }
    const card = renderLarkApprovalCard(_card);
    try {
      await messageClient.updateCard({ messageRef: _ref, card });
    } catch (error) {
      throw new Error(`LarkChannelAdapter.updateCard failed: ${describeError(error)}`);
    }
  }

  async editText(_ref: MessageRef, _body: string): Promise<void> {
    this.#assertStarted("editText");
    const messageClient = this.#messageClient("editText");
    try {
      await messageClient.editText({ messageRef: _ref, text: _body });
    } catch (error) {
      throw new Error(`LarkChannelAdapter.editText failed: ${describeError(error)}`);
    }
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    this.#assertStarted("answerAction");
    const decoded = decodeLarkCallbackHandle(_callbackHandle);
    if (decoded === undefined) {
      throw new Error("LarkChannelAdapter.answerAction invalid callback handle");
    }
    const actionClient = this.#options.actionClient;
    if (actionClient === undefined) {
      throw new Error("LarkChannelAdapter.answerAction requires an injected actionClient");
    }
    try {
      await actionClient.answerAction({
        callbackHandle: _callbackHandle,
        eventId: decoded.eventId,
        receivedAt: new Date(decoded.receivedAtMs),
        ack: _ack,
      });
    } catch (error) {
      throw new Error(`LarkChannelAdapter.answerAction failed: ${describeError(error)}`);
    }
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

  _emitRawActionForTest(raw: LarkRawCardActionInput): void {
    this.#emitRawAction(raw);
  }

  async sendText(target: Target, text: string): Promise<MessageRef> {
    this.#assertStarted("sendText");
    const messageClient = this.#messageClient("sendText");
    try {
      const sent = await messageClient.sendText({ target, text });
      return { target, messageId: sent.messageId };
    } catch (error) {
      throw new Error(`LarkChannelAdapter.sendText failed: ${describeError(error)}`);
    }
  }

  async replyText(ref: MessageRef, text: string): Promise<MessageRef> {
    this.#assertStarted("replyText");
    const messageClient = this.#messageClient("replyText");
    try {
      const sent = await messageClient.sendText({
        target: ref.target,
        text,
        replyToMessageId: ref.messageId,
      });
      return { target: ref.target, messageId: sent.messageId };
    } catch (error) {
      throw new Error(`LarkChannelAdapter.replyText failed: ${describeError(error)}`);
    }
  }

  #emitRawMessage(raw: LarkRawMessageEvent): void {
    if (!this.#acceptInbound()) {
      return;
    }
    let msg: InboundMessage;
    try {
      msg = normalizeLarkRawMessage(raw, this.#nowMs());
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

  #emitRawAction(raw: LarkRawCardActionInput): void {
    if (!this.#acceptInbound()) {
      return;
    }
    const action = normalizeLarkRawCardAction(raw, this.#nowMs());
    if (action === undefined) {
      return;
    }
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

  #nowMs(): number {
    return this.#options.now?.().getTime() ?? Date.now();
  }

  #assertStarted(method: string): void {
    if (!this.#started) {
      throw new Error(`LarkChannelAdapter.${method} requires start() first`);
    }
  }

  #messageClient(method: string): LarkMessageClientLike {
    const messageClient = this.#options.messageClient;
    if (messageClient === undefined) {
      throw new Error(`LarkChannelAdapter.${method} requires an injected messageClient`);
    }
    return messageClient;
  }

  #notImplemented(method: string, issue: string): Error {
    return new Error(`LarkChannelAdapter.${method} is not implemented until ${issue}`);
  }

  #installInboundHandlers(eventDispatcher: LarkEventDispatcherLike): void {
    if (this.#inboundHandlersInstalled) {
      return;
    }
    const handlers: LarkEventHandlerMap = {};
    if (this.#onMessageHandlers.size > 0) {
      handlers["im.message.receive_v1"] = (event: LarkRawMessageEvent) => {
        this.#emitRawMessage(event);
      };
    }
    if (this.#onActionHandlers.size > 0) {
      handlers["card.action.trigger"] = (event: LarkRawCardActionInput) => {
        this.#emitRawAction(event);
      };
    }
    if (Object.keys(handlers).length === 0) {
      return;
    }
    if (eventDispatcher.register === undefined) {
      throw new Error("LarkChannelAdapter.start requires EventDispatcher.register");
    }
    eventDispatcher.register(handlers);
    this.#inboundHandlersInstalled = true;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

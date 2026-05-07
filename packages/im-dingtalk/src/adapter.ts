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
  type DingTalkInboundAction,
  decodeDingTalkCallbackHandle,
  normalizeDingTalkRawCardAction,
} from "./action.js";
import { extractDingTalkCardCallbackWirePayload } from "./callback-codec.js";
import { DINGTALK_CAPABILITIES } from "./capabilities.js";
import { type DingTalkApprovalCardJson, renderDingTalkApprovalCard } from "./card.js";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkActionClientLike,
  type DingTalkCardClientLike,
  type DingTalkRobotFileClientLike,
  type DingTalkSessionReplyTextClientLike,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventLike,
} from "./client.js";
import {
  type DingTalkInboundMessage,
  dingtalkRobotAttachmentDescriptor,
  extractDingTalkRobotSessionReply,
  normalizeDingTalkRawRobotMessage,
} from "./message.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];
const MAX_SEEN_ROBOT_KEYS = 4096;
const DINGTALK_TEXT_MESSAGE_REF_PREFIX = "dingtalk-text:";
const DINGTALK_FILE_MESSAGE_REF_PREFIX = "dingtalk-file:";

export interface DingTalkChannelAdapterOptions {
  readonly now?: () => Date;
  readonly streamClient?: DingTalkStreamClientLike;
  readonly cardClient?: DingTalkCardClientLike;
  readonly actionClient?: DingTalkActionClientLike;
  readonly textClient?: DingTalkSessionReplyTextClientLike;
  readonly fileClient?: DingTalkRobotFileClientLike;
}

export class DingTalkChannelAdapter implements ChannelAdapter {
  readonly capabilities = DINGTALK_CAPABILITIES;

  readonly #options: DingTalkChannelAdapterOptions;
  #streamClient: DingTalkStreamClientLike | undefined;
  #started = false;
  #inboundPaused = true;
  #generation = 0;
  readonly #seenRobotKeys = new Set<string>();
  readonly #seenRobotKeyQueue: string[] = [];
  readonly #sessionReplyUrlsByChatId = new Map<string, string>();
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
    const generation = ++this.#generation;
    this.#installStreamCallbacks(streamClient, generation);
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
    this.#generation += 1;
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
      return {
        messageRef: {
          target: _target,
          messageId: sent.messageId,
          kind: "approval_card",
          textUpdateMode: "edit",
        },
        callbackNonce: "",
      };
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
    if (isDingTalkTextMessageRef(_ref)) {
      try {
        await this.#sendSessionReply(_ref.target, _body);
        return;
      } catch (error) {
        throw new Error(`DingTalkChannelAdapter.editText failed: ${describeError(error)}`);
      }
    }
    const cardClient = this.#cardClient("editText");
    try {
      await cardClient.editText({ messageRef: _ref, text: _body });
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.editText failed: ${describeError(error)}`);
    }
  }

  async sendText(_target: Target, _body: string): Promise<MessageRef> {
    this.#assertStarted("sendText");
    try {
      return await this.#sendSessionReply(_target, _body);
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.sendText failed: ${describeError(error)}`);
    }
  }

  async #sendSessionReply(_target: Target, _body: string): Promise<MessageRef> {
    const textClient = this.#options.textClient;
    if (textClient === undefined) {
      throw new Error("DingTalkChannelAdapter.sendText requires an injected textClient");
    }
    const sessionWebhook = this.#sessionReplyUrlsByChatId.get(_target.chatId);
    if (sessionWebhook === undefined) {
      throw new Error(
        "DingTalkChannelAdapter.sendText requires a recent inbound session reply URL",
      );
    }
    const sent = await textClient.sendText({ sessionWebhook, text: _body });
    return {
      target: _target,
      messageId: `${DINGTALK_TEXT_MESSAGE_REF_PREFIX}${sent.messageId ?? this.#nowMs()}`,
      kind: "text",
      textUpdateMode: "append",
    };
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    this.#assertStarted("answerAction");
    const decoded = decodeDingTalkCallbackHandle(_callbackHandle);
    if (decoded === undefined) {
      throw new Error("DingTalkChannelAdapter.answerAction invalid callback handle");
    }
    const actionClient = this.#options.actionClient;
    if (actionClient === undefined) {
      throw new Error("DingTalkChannelAdapter.answerAction requires an injected actionClient");
    }
    try {
      await actionClient.answerAction({
        callbackHandle: _callbackHandle,
        streamMessageId: decoded.streamMessageId,
        outTrackId: decoded.outTrackId,
        receivedAt: new Date(decoded.receivedAtMs),
        ack: _ack,
      });
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.answerAction failed: ${describeError(error)}`);
    }
  }

  async sendFile(_target: Target, _file: OutboundFile): Promise<MessageRef> {
    this.#assertStarted("sendFile");
    assertDingTalkOutboundFile(_file);
    const textClient = this.#options.textClient;
    if (textClient?.sendFile === undefined) {
      throw new Error("DingTalkChannelAdapter.sendFile requires an injected textClient.sendFile");
    }
    const sessionWebhook = this.#sessionReplyUrlsByChatId.get(_target.chatId);
    if (sessionWebhook === undefined) {
      throw new Error(
        "DingTalkChannelAdapter.sendFile requires a recent inbound session reply URL",
      );
    }
    try {
      const sent = await textClient.sendFile({ sessionWebhook, file: _file });
      return {
        target: _target,
        messageId: `${DINGTALK_FILE_MESSAGE_REF_PREFIX}${sent.messageId ?? this.#nowMs()}`,
        kind: "file",
        textUpdateMode: "append",
      };
    } catch (error) {
      throw new Error(`DingTalkChannelAdapter.sendFile failed: ${describeError(error)}`);
    }
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

  #installStreamCallbacks(streamClient: DingTalkStreamClientLike, generation: number): void {
    streamClient.registerCallbackListener(DINGTALK_TOPIC_ROBOT, (event) => {
      return this.#handleRobotCallback(streamClient, event, generation);
    });
    streamClient.registerCallbackListener(DINGTALK_TOPIC_CARD, (event) => {
      return this.#handleCardCallback(streamClient, event, generation);
    });
  }

  async #handleRobotCallback(
    streamClient: DingTalkStreamClientLike,
    _event: DingTalkStreamEventLike,
    generation: number,
  ): Promise<void> {
    if (!this.#acceptInbound(generation)) {
      return;
    }
    await this.#ackStreamCallback(streamClient, _event);
    let msg: DingTalkInboundMessage;
    try {
      const attachments = await this.#materializeRobotAttachments(_event);
      msg = normalizeDingTalkRawRobotMessage(_event, this.#nowMs(), attachments);
    } catch {
      return;
    }
    if (!this.#rememberRobotKey(msg.idempotencyKey)) {
      return;
    }
    const sessionReply = extractDingTalkRobotSessionReply(_event);
    if (sessionReply !== undefined) {
      this.#sessionReplyUrlsByChatId.set(sessionReply.target.chatId, sessionReply.url);
    }
    for (const handler of this.#onMessageHandlers) {
      try {
        handler(msg);
      } catch {
        // Keep one subscriber failure from blocking other subscribers.
      }
    }
  }

  async #handleCardCallback(
    streamClient: DingTalkStreamClientLike,
    _event: DingTalkStreamEventLike,
    generation: number,
  ): Promise<void> {
    if (!this.#acceptInbound(generation)) {
      return;
    }
    await this.#ackStreamCallback(streamClient, _event);
    extractDingTalkCardCallbackWirePayload(_event);
    const action: DingTalkInboundAction | undefined = normalizeDingTalkRawCardAction(
      _event,
      this.#nowMs(),
    );
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

  async #ackStreamCallback(
    streamClient: DingTalkStreamClientLike,
    event: DingTalkStreamEventLike,
  ): Promise<void> {
    const messageId = event.headers?.messageId;
    if (messageId === undefined || messageId.length === 0) {
      return;
    }
    try {
      await streamClient.ackCallback?.(messageId);
    } catch {
      // Stream ack is platform receipt only; business handling still fails closed above.
    }
  }

  async #materializeRobotAttachments(
    event: DingTalkStreamEventLike,
  ): Promise<NonNullable<DingTalkInboundMessage["attachments"]>> {
    const descriptor = dingtalkRobotAttachmentDescriptor(event);
    const fileClient = this.#options.fileClient;
    if (descriptor === undefined || fileClient === undefined) {
      return [];
    }
    try {
      const downloaded = await fileClient.downloadMessageFile({
        downloadCode: descriptor.downloadCode,
        filename: descriptor.filename,
        contentType: descriptor.contentType,
        kind: descriptor.kind,
      });
      const sizeBytes = downloaded.sizeBytes ?? descriptor.sizeBytes;
      return [
        {
          kind: descriptor.kind,
          filename: descriptor.filename,
          contentType: descriptor.contentType,
          localPath: downloaded.localPath,
          ...(sizeBytes === undefined ? {} : { sizeBytes }),
        },
      ];
    } catch {
      // Download URLs and codes are sensitive; keep text routing alive without logging them.
      return [];
    }
  }

  #rememberRobotKey(key: string): boolean {
    if (this.#seenRobotKeys.has(key)) {
      return false;
    }
    this.#seenRobotKeys.add(key);
    this.#seenRobotKeyQueue.push(key);
    while (this.#seenRobotKeyQueue.length > MAX_SEEN_ROBOT_KEYS) {
      const oldest = this.#seenRobotKeyQueue.shift();
      if (oldest !== undefined) {
        this.#seenRobotKeys.delete(oldest);
      }
    }
    return true;
  }

  #acceptInbound(generation: number): boolean {
    return generation === this.#generation && this.#started && !this.#inboundPaused;
  }

  #nowMs(): number {
    return this.#options.now?.().getTime() ?? Date.now();
  }
}

function assertDingTalkOutboundFile(file: OutboundFile): void {
  if (file.filename.trim().length === 0) {
    throw new Error("DingTalkChannelAdapter.sendFile requires a filename");
  }
  if (file.bytes.byteLength === 0) {
    throw new Error("DingTalkChannelAdapter.sendFile refuses empty files");
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDingTalkTextMessageRef(ref: MessageRef): boolean {
  return ref.messageId.startsWith(DINGTALK_TEXT_MESSAGE_REF_PREFIX);
}

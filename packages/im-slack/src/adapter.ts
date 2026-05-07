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
import { SLACK_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export type SlackSocketModeEventName = "app_mention" | "message" | "slash_commands" | "interactive";

export interface SlackSocketModeClientLike {
  start(): Promise<void>;
  disconnect(): void | Promise<void>;
  on?(
    event: SlackSocketModeEventName,
    handler: (payload: unknown) => void | Promise<void>,
  ): unknown;
}

export interface SlackWebClientLike {
  chatPostMessage?(input: SlackPostMessageInput): Promise<SlackMessageResult>;
  chatUpdate?(input: SlackUpdateMessageInput): Promise<SlackMessageResult | undefined>;
  filesUpload?(input: SlackFileUploadInput): Promise<SlackMessageResult | undefined>;
}

export interface SlackPostMessageInput {
  readonly channel: string;
  readonly text: string;
  readonly thread_ts?: string;
}

export interface SlackUpdateMessageInput {
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
}

export interface SlackFileUploadInput {
  readonly channels: readonly string[];
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly thread_ts?: string;
}

export interface SlackMessageResult {
  readonly channel?: string;
  readonly ts?: string;
}

export interface SlackChannelAdapterOptions {
  readonly now?: () => Date;
  readonly socketClient?: SlackSocketModeClientLike;
  readonly webClient?: SlackWebClientLike;
}

export class SlackChannelAdapter implements ChannelAdapter {
  readonly capabilities = SLACK_CAPABILITIES;

  readonly #options: SlackChannelAdapterOptions;
  #socketClient: SlackSocketModeClientLike | undefined;
  #started = false;
  #inboundPaused = true;
  readonly #onMessageHandlers = new Set<(msg: InboundMessage) => void>();
  readonly #onActionHandlers = new Set<(action: InboundAction) => void>();

  constructor(options: SlackChannelAdapterOptions = {}) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#inboundPaused = true;
    const socketClient = this.#options.socketClient;
    if (socketClient === undefined) {
      throw new Error("SlackChannelAdapter.start requires an injected socketClient");
    }
    this.#socketClient = socketClient;
    await socketClient.start();
    this.#started = true;
    this.#inboundPaused = false;
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#inboundPaused = true;
    this.#started = false;
    await this.#socketClient?.disconnect();
    this.#socketClient = undefined;
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
    throw new Error("SlackChannelAdapter.sendCard requires Slack T3 approval-card implementation");
  }

  async sendText(target: Target, body: string): Promise<MessageRef> {
    this.#assertStarted("sendText");
    const webClient = this.#webClient("sendText");
    if (webClient.chatPostMessage === undefined) {
      throw new Error("SlackChannelAdapter.sendText requires webClient.chatPostMessage");
    }
    const sent = await webClient.chatPostMessage({
      channel: slackChannelFromTarget(target),
      text: body,
      ...(target.threadKey === undefined ? {} : { thread_ts: target.threadKey }),
    });
    return {
      target,
      messageId: slackMessageId(
        sent.channel ?? slackChannelFromTarget(target),
        requiredTs(sent.ts),
      ),
      kind: "text",
      textUpdateMode: "edit",
    };
  }

  async updateCard(_ref: MessageRef, _card: ApprovalCardInput): Promise<void> {
    this.#assertStarted("updateCard");
    throw new Error(
      "SlackChannelAdapter.updateCard requires Slack T3 approval-card implementation",
    );
  }

  async editText(ref: MessageRef, body: string): Promise<void> {
    this.#assertStarted("editText");
    const webClient = this.#webClient("editText");
    if (webClient.chatUpdate === undefined) {
      throw new Error("SlackChannelAdapter.editText requires webClient.chatUpdate");
    }
    const parsed = parseSlackMessageId(ref.messageId);
    await webClient.chatUpdate({ channel: parsed.channel, ts: parsed.ts, text: body });
  }

  async answerAction(_callbackHandle: string, _ack: ActionAck): Promise<void> {
    this.#assertStarted("answerAction");
    throw new Error("SlackChannelAdapter.answerAction requires Slack T3 action implementation");
  }

  async sendFile(target: Target, file: OutboundFile): Promise<MessageRef> {
    this.#assertStarted("sendFile");
    const webClient = this.#webClient("sendFile");
    if (webClient.filesUpload === undefined) {
      throw new Error("SlackChannelAdapter.sendFile requires webClient.filesUpload");
    }
    const sent = await webClient.filesUpload({
      channels: [slackChannelFromTarget(target)],
      filename: file.filename,
      contentType: file.contentType,
      bytes: file.bytes,
      ...(target.threadKey === undefined ? {} : { thread_ts: target.threadKey }),
    });
    return {
      target,
      messageId: slackMessageId(
        sent?.channel ?? slackChannelFromTarget(target),
        requiredTs(sent?.ts),
      ),
      kind: "file",
    };
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

  _handlerCountsForTest(): { messages: number; actions: number } {
    return {
      messages: this.#onMessageHandlers.size,
      actions: this.#onActionHandlers.size,
    };
  }

  #assertStarted(method: string): void {
    if (!this.#started) {
      throw new Error(`SlackChannelAdapter.${method} requires start() first`);
    }
  }

  #webClient(method: string): SlackWebClientLike {
    const webClient = this.#options.webClient;
    if (webClient === undefined) {
      throw new Error(`SlackChannelAdapter.${method} requires an injected webClient`);
    }
    return webClient;
  }
}

function slackChannelFromTarget(target: Target): string {
  const separator = target.chatId.lastIndexOf(":");
  if (separator === -1 || separator === target.chatId.length - 1) {
    throw new Error("SlackChannelAdapter target.chatId must be <teamId>:<channelId>");
  }
  return target.chatId.slice(separator + 1);
}

function slackMessageId(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

function parseSlackMessageId(messageId: string): { channel: string; ts: string } {
  const separator = messageId.lastIndexOf(":");
  if (separator <= 0 || separator === messageId.length - 1) {
    throw new Error("SlackChannelAdapter messageId must be <channelId>:<ts>");
  }
  return {
    channel: messageId.slice(0, separator),
    ts: messageId.slice(separator + 1),
  };
}

function requiredTs(ts: string | undefined): string {
  if (ts === undefined || ts.length === 0) {
    throw new Error("SlackChannelAdapter received Slack message without ts");
  }
  return ts;
}

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
import { TELEGRAM_CAPABILITIES } from "./capabilities.js";

type ApprovalCardInput = Parameters<ChannelAdapter["sendCard"]>[1];

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly capabilities = TELEGRAM_CAPABILITIES;

  async start(): Promise<void> {
    throw notImplemented("start");
  }

  async stop(): Promise<void> {
    throw notImplemented("stop");
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
}

function notImplemented(method: string): Error {
  return new Error(`TelegramChannelAdapter.${method} is not implemented until its Phase 3 slice`);
}

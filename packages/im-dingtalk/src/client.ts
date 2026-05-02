export const DINGTALK_TOPIC_ROBOT = "/v1.0/im/bot/messages/get";
export const DINGTALK_TOPIC_CARD = "/v1.0/card/instances/callback";

export interface DingTalkStreamEventLike {
  readonly headers?: {
    readonly messageId?: string;
    readonly topic?: string;
  };
  readonly data?: string;
}

export type DingTalkStreamEventHandler = (event: DingTalkStreamEventLike) => void | Promise<void>;

export interface DingTalkStreamClientLike {
  registerCallbackListener(
    topic: string,
    handler: DingTalkStreamEventHandler,
  ): DingTalkStreamClientLike | undefined;
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
}

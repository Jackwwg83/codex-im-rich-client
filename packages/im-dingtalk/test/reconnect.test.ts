import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  type DingTalkInboundMessage,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
} from "../src/index.js";

const FIXTURE_DIR = "packages/im-dingtalk/test/fixtures";
const NOW = new Date("2026-05-02T20:00:00.000Z");

function fixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as DingTalkStreamEventLike;
}

class ReconnectFakeStreamClient implements DingTalkStreamClientLike {
  readonly events: string[] = [];
  readonly acks: string[] = [];
  readonly handlers = new Map<string, DingTalkStreamEventHandler[]>();
  connectHook: (() => void | Promise<void>) | undefined;

  registerCallbackListener(topic: string, handler: DingTalkStreamEventHandler) {
    this.events.push(`register:${topic}`);
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(handler);
    this.handlers.set(topic, handlers);
    return this;
  }

  async connect() {
    this.events.push("stream.connect");
    await this.connectHook?.();
  }

  disconnect() {
    this.events.push("stream.disconnect");
  }

  ackCallback(messageId: string) {
    this.acks.push(messageId);
  }

  async injectAll(topic: string, event: DingTalkStreamEventLike): Promise<void> {
    await Promise.all((this.handlers.get(topic) ?? []).map((handler) => handler(event)));
  }

  async injectLatest(topic: string, event: DingTalkStreamEventLike): Promise<void> {
    const handlers = this.handlers.get(topic) ?? [];
    await handlers.at(-1)?.(event);
  }
}

describe("DingTalk Stream reconnect behavior (JAC-86)", () => {
  it("does not duplicate emissions from stale callbacks after stop/start reconnect", async () => {
    const streamClient = new ReconnectFakeStreamClient();
    const adapter = new DingTalkChannelAdapter({ streamClient, now: () => NOW });
    const messages: DingTalkInboundMessage[] = [];
    const actions: DingTalkInboundAction[] = [];

    adapter.onMessage((msg) => messages.push(msg as DingTalkInboundMessage));
    adapter.onAction((action) => actions.push(action as DingTalkInboundAction));

    await adapter.start();
    await adapter.stop();
    await adapter.start();

    await streamClient.injectAll(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    await streamClient.injectAll(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));

    expect(messages.map((msg) => msg.idempotencyKey)).toEqual(["robot:msg_test_private"]);
    expect(actions.map((action) => action.idempotencyKey)).toEqual([
      "card:stream_card_group_001:ding_card_group_001:btn_allow",
    ]);
    expect(streamClient.events).toEqual([
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
      "stream.disconnect",
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
    ]);
  });

  it("keeps inbound paused while reconnect connect() is still in flight", async () => {
    const streamClient = new ReconnectFakeStreamClient();
    const adapter = new DingTalkChannelAdapter({ streamClient, now: () => NOW });
    const messages: string[] = [];
    adapter.onMessage((msg) => messages.push(msg.text));
    streamClient.connectHook = async () => {
      await streamClient.injectLatest(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    };

    await adapter.start();

    expect(messages).toEqual([]);
    await streamClient.injectLatest(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    expect(messages).toEqual(["hello from dingtalk"]);
  });

  it("drops duplicate robot deliveries while leaving card replay checks to daemon tokens", async () => {
    const streamClient = new ReconnectFakeStreamClient();
    const adapter = new DingTalkChannelAdapter({ streamClient, now: () => NOW });
    const messages: DingTalkInboundMessage[] = [];
    const actions: DingTalkInboundAction[] = [];

    adapter.onMessage((msg) => messages.push(msg as DingTalkInboundMessage));
    adapter.onAction((action) => actions.push(action as DingTalkInboundAction));

    await adapter.start();
    await streamClient.injectLatest(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    await streamClient.injectLatest(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    await streamClient.injectLatest(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));
    await streamClient.injectLatest(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));

    expect(messages.map((msg) => msg.idempotencyKey)).toEqual(["robot:msg_test_private"]);
    expect(actions.map((action) => action.idempotencyKey)).toEqual([
      "card:stream_card_group_001:ding_card_group_001:btn_allow",
      "card:stream_card_group_001:ding_card_group_001:btn_allow",
    ]);
    expect(streamClient.acks).toEqual([
      "stream_msg_private_001",
      "stream_msg_private_001",
      "stream_card_group_001",
      "stream_card_group_001",
    ]);
  });
});

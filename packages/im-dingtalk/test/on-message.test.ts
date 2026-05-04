import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  DingTalkChannelAdapter,
  type DingTalkInboundMessage,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
  normalizeDingTalkRawRobotMessage,
} from "../src/index.js";

function fixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(
    readFileSync(join("packages/im-dingtalk/test/fixtures", name), "utf8"),
  ) as DingTalkStreamEventLike;
}

class FakeDingTalkStreamClient implements DingTalkStreamClientLike {
  readonly handlers = new Map<string, DingTalkStreamEventHandler>();
  readonly events: string[] = [];

  registerCallbackListener(topic: string, handler: DingTalkStreamEventHandler) {
    this.events.push(`register:${topic}`);
    this.handlers.set(topic, handler);
    return this;
  }

  async connect() {
    this.events.push("stream.connect");
  }

  disconnect() {
    this.events.push("stream.disconnect");
  }

  async inject(topic: string, event: DingTalkStreamEventLike): Promise<void> {
    await this.handlers.get(topic)?.(event);
  }
}

describe("DingTalk message receive fixtures (JAC-81)", () => {
  it("normalizes a private robot text fixture into ChannelAdapter InboundMessage", () => {
    const msg = normalizeDingTalkRawRobotMessage(fixture("private-text-message.json"), 0);

    expect(msg).toEqual({
      target: { platform: "dingtalk", chatId: "staff_test_private" },
      sender: { userId: "staff_test_private", displayName: "Ada" },
      text: "hello from dingtalk",
      receivedAt: new Date("2026-05-02T19:43:20.000Z"),
      messageRef: {
        target: { platform: "dingtalk", chatId: "staff_test_private" },
        messageId: "msg_test_private",
      },
      idempotencyKey: "robot:msg_test_private",
      raw: {
        topic: DINGTALK_TOPIC_ROBOT,
        streamMessageId: "[redacted]",
        robotMsgId: "[redacted]",
        conversationId: "[redacted]",
        conversationType: "1",
        msgtype: "text",
      },
    });
  });

  it("normalizes a group text fixture without leaking real identifiers", () => {
    const msg = normalizeDingTalkRawRobotMessage(fixture("group-text-message.json"), 0);

    expect(msg.target).toEqual({ platform: "dingtalk", chatId: "cid_test_group" });
    expect(msg.sender).toEqual({ userId: "staff_test_group", displayName: "Grace" });
    expect(msg.text).toBe("@Codex run tests");
    expect(msg.idempotencyKey).toBe("robot:msg_test_group");
    expect(JSON.stringify(fixture("group-text-message.json"))).not.toMatch(
      /access_token|clientSecret|client_secret|live_[a-z0-9_]+/i,
    );
  });

  it("turns unsupported robot messages into explicit user-visible text", () => {
    const msg = normalizeDingTalkRawRobotMessage(fixture("unsupported-image-message.json"), 0);

    expect(msg.text).toBe("Unsupported DingTalk message type: image");
    expect(msg.target).toEqual({ platform: "dingtalk", chatId: "cid_test_image" });
    expect(msg.messageRef.messageId).toBe("msg_test_image");
  });

  it("keeps debug raw fields sanitized while preserving idempotency outside raw", () => {
    const msg = normalizeDingTalkRawRobotMessage(fixture("private-text-message.json"), 0);
    const rawJson = JSON.stringify(msg.raw);

    expect(msg.raw.streamMessageId).toBe("[redacted]");
    expect(msg.raw.robotMsgId).toBe("[redacted]");
    expect(msg.raw.conversationId).toBe("[redacted]");
    expect(msg.idempotencyKey).toBe("robot:msg_test_private");
    expect(rawJson).not.toContain("stream_msg_private_001");
    expect(rawJson).not.toContain("msg_test_private");
    expect(rawJson).not.toContain("staff_test_private");
    expect(rawJson).not.toMatch(/sessionWebhook|access_token|clientSecret|client_secret/i);
  });

  it("emits robot message fixtures only after lifecycle start unpauses inbound", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const adapter = new DingTalkChannelAdapter({
      streamClient,
      now: () => new Date(1777751000000),
    });
    const received: DingTalkInboundMessage[] = [];

    adapter.onMessage((msg) => {
      received.push(msg as DingTalkInboundMessage);
    });

    await streamClient.inject(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));
    expect(received).toEqual([]);

    await adapter.start();
    expect(streamClient.events).toEqual([
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
    ]);

    await streamClient.inject(DINGTALK_TOPIC_ROBOT, fixture("private-text-message.json"));

    expect(received.map((msg) => msg.text)).toEqual(["hello from dingtalk"]);
    expect(received[0]?.idempotencyKey).toBe("robot:msg_test_private");
  });

  it("fails closed for malformed robot events without throwing from Stream handlers", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const adapter = new DingTalkChannelAdapter({ streamClient });
    const received: string[] = [];

    adapter.onMessage((msg) => {
      received.push(msg.text);
    });

    await adapter.start();
    await expect(
      streamClient.inject(DINGTALK_TOPIC_ROBOT, {
        headers: { messageId: "stream_msg_bad", topic: DINGTALK_TOPIC_ROBOT },
        data: "{}",
      }),
    ).resolves.toBeUndefined();

    expect(received).toEqual([]);
  });
});

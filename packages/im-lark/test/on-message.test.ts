import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LarkChannelAdapter,
  type LarkRawMessageEvent,
  type LarkWsClientLike,
  normalizeLarkRawMessage,
} from "../src/index.js";

function fixture(name: string): LarkRawMessageEvent {
  return JSON.parse(
    readFileSync(join("packages/im-lark/test/fixtures", name), "utf8"),
  ) as LarkRawMessageEvent;
}

describe("Lark message receive fixtures (JAC-152)", () => {
  it("normalizes a private text message into ChannelAdapter InboundMessage", () => {
    const msg = normalizeLarkRawMessage(fixture("private-message.json"), 0);

    expect(msg).toEqual({
      target: { platform: "lark", chatId: "oc_test_private_chat" },
      sender: { userId: "ou_test_private_sender" },
      text: "hello codex",
      receivedAt: new Date("2026-05-02T19:26:40.000Z"),
      messageRef: {
        target: { platform: "lark", chatId: "oc_test_private_chat" },
        messageId: "om_test_private_message",
      },
    });
  });

  it("normalizes a group mention without leaking real identifiers", () => {
    const msg = normalizeLarkRawMessage(fixture("group-mention-message.json"), 0);

    expect(msg.target).toEqual({ platform: "lark", chatId: "oc_test_group_chat" });
    expect(msg.sender.userId).toBe("ou_test_group_sender");
    expect(msg.text).toBe("@codex run tests");
    expect(JSON.stringify(fixture("group-mention-message.json"))).not.toMatch(
      /tenant_key_live|open_id_live|union_id_live|chat_id_live|message_id_live/,
    );
  });

  it("preserves thread/root context as target.threadKey", () => {
    const msg = normalizeLarkRawMessage(fixture("thread-root-message.json"), 0);

    expect(msg.target).toEqual({
      platform: "lark",
      chatId: "oc_test_thread_chat",
      threadKey: "omt_test_thread",
    });
    expect(msg.messageRef.target).toBe(msg.target);
    expect(msg.messageRef.messageId).toBe("om_test_thread_reply");
  });

  it("turns unsupported attachments into explicit user-visible text", () => {
    const msg = normalizeLarkRawMessage(fixture("unsupported-attachment-message.json"), 0);

    expect(msg.text).toBe("Unsupported Lark message type: image");
    expect(msg.target).toEqual({ platform: "lark", chatId: "oc_test_file_chat" });
  });

  it("emits raw message fixtures only after lifecycle start unpauses inbound", async () => {
    const wsClient: LarkWsClientLike = {
      async start() {},
      close() {},
    };
    const adapter = new LarkChannelAdapter({ wsClient, now: () => new Date(1777750004000) });
    const received: string[] = [];

    adapter.onMessage((msg) => {
      received.push(msg.text);
    });

    adapter._emitRawMessageForTest(fixture("private-message.json"));
    expect(received).toEqual([]);

    await adapter.start();
    adapter._emitRawMessageForTest(fixture("private-message.json"));

    expect(received).toEqual(["hello codex"]);
  });
});

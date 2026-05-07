import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LarkChannelAdapter,
  type LarkEventDispatcherLike,
  type LarkEventHandlerMap,
  type LarkMessageClientLike,
  type LarkRawMessageEvent,
  type LarkWsClientLike,
  normalizeLarkRawMessage,
} from "../src/index.js";

function fixture(name: string): LarkRawMessageEvent {
  return JSON.parse(
    readFileSync(join("packages/im-lark/test/fixtures", name), "utf8"),
  ) as LarkRawMessageEvent;
}

class FakeLarkEventDispatcher implements LarkEventDispatcherLike {
  readonly messageHandlers: Array<(event: LarkRawMessageEvent) => void | Promise<void>> = [];

  register(handlers: LarkEventHandlerMap) {
    if (handlers["im.message.receive_v1"] !== undefined) {
      this.messageHandlers.push(handlers["im.message.receive_v1"]);
    }
    return this;
  }

  async injectMessage(event: LarkRawMessageEvent): Promise<void> {
    await Promise.all(this.messageHandlers.map((handler) => handler(event)));
  }
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
        kind: "inbound",
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

  it("downloads Lark image messages as inbound image attachments", async () => {
    const downloadFile = vi.fn<NonNullable<LarkMessageClientLike["downloadFile"]>>(async () => ({
      localPath: "/tmp/codex-im-lark/image.jpg",
      sizeBytes: 4,
    }));
    const adapter = new LarkChannelAdapter({
      wsClient: {
        async start() {},
        close() {},
      },
      createEventDispatcher: () => new FakeLarkEventDispatcher(),
      messageClient: {
        sendText: vi.fn(),
        editText: vi.fn(),
        downloadFile,
      },
      now: () => new Date(1777750004000),
    });
    const seen: unknown[] = [];
    adapter.onMessage((msg) => seen.push(msg));

    await adapter.start();
    await adapter._emitRawMessageForTest({
      sender: { sender_id: { open_id: "ou_image_sender" } },
      message: {
        message_id: "om_image_message",
        chat_id: "oc_image_chat",
        chat_type: "p2p",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_test_key" }),
        create_time: "1777750005000",
      },
    });

    expect(downloadFile).toHaveBeenCalledWith({
      messageId: "om_image_message",
      fileKey: "img_test_key",
      kind: "image",
      filename: "lark-image-om_image_message.jpg",
      contentType: "image/jpeg",
    });
    expect(seen).toEqual([
      expect.objectContaining({
        text: "",
        attachments: [
          {
            kind: "image",
            filename: "lark-image-om_image_message.jpg",
            contentType: "image/jpeg",
            localPath: "/tmp/codex-im-lark/image.jpg",
            sizeBytes: 4,
          },
        ],
      }),
    ]);
  });

  it("downloads Lark file messages as inbound file attachments", async () => {
    const downloadFile = vi.fn<NonNullable<LarkMessageClientLike["downloadFile"]>>(async () => ({
      localPath: "/tmp/codex-im-lark/build.log",
      sizeBytes: 42,
    }));
    const adapter = new LarkChannelAdapter({
      wsClient: {
        async start() {},
        close() {},
      },
      createEventDispatcher: () => new FakeLarkEventDispatcher(),
      messageClient: {
        sendText: vi.fn(),
        editText: vi.fn(),
        downloadFile,
      },
      now: () => new Date(1777750004000),
    });
    const seen: unknown[] = [];
    adapter.onMessage((msg) => seen.push(msg));

    await adapter.start();
    await adapter._emitRawMessageForTest({
      sender: { sender_id: { open_id: "ou_file_sender" } },
      message: {
        message_id: "om_file_message",
        chat_id: "oc_file_chat",
        chat_type: "p2p",
        message_type: "file",
        content: JSON.stringify({ file_key: "file_test_key", file_name: "build.log" }),
        create_time: "1777750006000",
      },
    });

    expect(downloadFile).toHaveBeenCalledWith({
      messageId: "om_file_message",
      fileKey: "file_test_key",
      kind: "file",
      filename: "build.log",
      contentType: "application/octet-stream",
    });
    expect(seen).toEqual([
      expect.objectContaining({
        text: "",
        attachments: [
          {
            kind: "file",
            filename: "build.log",
            contentType: "application/octet-stream",
            localPath: "/tmp/codex-im-lark/build.log",
            sizeBytes: 42,
          },
        ],
      }),
    ]);
  });

  it("emits raw message fixtures only after lifecycle start unpauses inbound", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const wsClient: LarkWsClientLike = {
      async start() {},
      close() {},
    };
    const adapter = new LarkChannelAdapter({
      wsClient,
      createEventDispatcher: () => dispatcher,
      now: () => new Date(1777750004000),
    });
    const received: string[] = [];

    adapter.onMessage((msg) => {
      received.push(msg.text);
    });

    await adapter._emitRawMessageForTest(fixture("private-message.json"));
    expect(received).toEqual([]);

    await adapter.start();
    await dispatcher.injectMessage(fixture("private-message.json"));

    expect(received).toEqual(["hello codex"]);
  });

  it("fails closed for malformed message events without throwing from transport handlers", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const adapter = new LarkChannelAdapter({
      wsClient: {
        async start() {},
        close() {},
      },
      createEventDispatcher: () => dispatcher,
      now: () => new Date(1777750004000),
    });
    const received: string[] = [];
    adapter.onMessage((msg) => {
      received.push(msg.text);
    });

    await adapter.start();
    await expect(dispatcher.injectMessage({ message: { content: "{}" } })).resolves.toBeUndefined();

    expect(received).toEqual([]);
  });
});

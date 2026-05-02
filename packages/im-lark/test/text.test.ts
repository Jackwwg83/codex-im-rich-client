import { describe, expect, it } from "vitest";
import {
  LarkChannelAdapter,
  type LarkMessageClientLike,
  type LarkWsClientLike,
} from "../src/index.js";

const TARGET = { platform: "lark", chatId: "oc_text_chat", threadKey: "omt_thread" };
const REF = { target: TARGET, messageId: "om_existing_message" };

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

describe("LarkChannelAdapter text send/edit/reply (JAC-153)", () => {
  it("sends text and maps the returned Lark message id into MessageRef", async () => {
    const calls: unknown[] = [];
    const messageClient: LarkMessageClientLike = {
      async sendText(input) {
        calls.push(input);
        return { messageId: "om_sent_text" };
      },
      async editText(input) {
        calls.push(input);
      },
    };
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient(), messageClient });

    await adapter.start();
    const messageRef = await adapter.sendText(TARGET, "hello lark");

    expect(calls).toEqual([{ target: TARGET, text: "hello lark" }]);
    expect(messageRef).toEqual({ target: TARGET, messageId: "om_sent_text" });
  });

  it("edits text through the injected message client", async () => {
    const calls: unknown[] = [];
    const messageClient: LarkMessageClientLike = {
      async sendText(input) {
        calls.push(input);
        return { messageId: "unused" };
      },
      async editText(input) {
        calls.push(input);
      },
    };
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient(), messageClient });

    await adapter.start();
    await adapter.editText(REF, "edited");

    expect(calls).toEqual([{ messageRef: REF, text: "edited" }]);
  });

  it("replies with the original message id and returns the reply MessageRef", async () => {
    const calls: unknown[] = [];
    const messageClient: LarkMessageClientLike = {
      async sendText(input) {
        calls.push(input);
        return { messageId: "om_reply_message" };
      },
      async editText(input) {
        calls.push(input);
      },
    };
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient(), messageClient });

    await adapter.start();
    const replyRef = await adapter.replyText(REF, "reply body");

    expect(calls).toEqual([
      { target: TARGET, text: "reply body", replyToMessageId: "om_existing_message" },
    ]);
    expect(replyRef).toEqual({ target: TARGET, messageId: "om_reply_message" });
  });

  it("fails fast before start and propagates client failures after start", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: {
        async sendText() {
          throw new Error("send rejected");
        },
        async editText() {
          throw new Error("edit rejected");
        },
      },
    });

    await expect(adapter.sendText(TARGET, "before start")).rejects.toThrow(
      "LarkChannelAdapter.sendText requires start() first",
    );

    await adapter.start();
    await expect(adapter.sendText(TARGET, "after start")).rejects.toThrow(
      "LarkChannelAdapter.sendText failed: send rejected",
    );
    await expect(adapter.editText(REF, "after start")).rejects.toThrow(
      "LarkChannelAdapter.editText failed: edit rejected",
    );
  });

  it("fails closed when messageClient is missing", async () => {
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient() });

    await adapter.start();

    await expect(adapter.sendText(TARGET, "missing client")).rejects.toThrow(
      "LarkChannelAdapter.sendText requires an injected messageClient",
    );
  });
});

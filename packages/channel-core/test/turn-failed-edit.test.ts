import { formatTurnFailed } from "@codex-im/render";
import { describe, expect, it } from "vitest";
import { TelegramShapeFakeChannelAdapter } from "../src/fake.js";
import type { MessageRef, Target } from "../src/types.js";

describe("TelegramShapeFakeChannelAdapter turn_failed edit path (Phase 3 T19d)", () => {
  it("edits the streaming message ref with rendered transport_lost failure text", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    const target: Target = { platform: "telegram", chatId: "-100" };
    const streamingRef: MessageRef = { target, messageId: "stream-1" };

    await adapter.start();
    await adapter.editText(
      streamingRef,
      formatTurnFailed({
        type: "turn_failed",
        threadId: "thread-stream",
        turnId: "turn-stream",
        cause: "transport_lost",
      }),
    );

    expect(adapter._editsForTest()).toEqual([
      {
        messageRef: streamingRef,
        text: expect.stringContaining("transport was lost"),
      },
    ]);
  });
});

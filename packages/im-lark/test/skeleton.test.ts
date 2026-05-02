import { describe, expect, it } from "vitest";
import { LARK_CAPABILITIES, LarkChannelAdapter } from "../src/index.js";

describe("@codex-im/im-lark skeleton (JAC-149)", () => {
  it("exports the Lark adapter shell and Phase 4 capability constants", () => {
    expect(LARK_CAPABILITIES).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: false,
      maxCallbackDataBytes: 256,
    });

    const adapter = new LarkChannelAdapter();
    expect(adapter.capabilities).toBe(LARK_CAPABILITIES);
    expect(adapter.constructor.name).toBe("LarkChannelAdapter");
  });

  it("requires injected lifecycle dependencies before start", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const adapter = new LarkChannelAdapter({ now: () => now });

    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
    expect(adapter._nowForTest()).toBe(now);

    await expect(adapter.start()).rejects.toThrow(
      "LarkChannelAdapter.start requires an injected wsClient",
    );
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);

    await adapter.stop();
    expect(adapter._startedForTest()).toBe(false);
  });

  it("keeps later card/action slices explicitly unimplemented", async () => {
    const adapter = new LarkChannelAdapter();
    const ref = {
      target: { platform: "lark", chatId: "chat-1" },
      messageId: "message-1",
    };

    await expect(
      adapter.answerAction("callback-handle", { ok: true, userMessage: "ok" }),
    ).rejects.toThrow("LarkChannelAdapter.answerAction is not implemented until JAC-158");
  });
});

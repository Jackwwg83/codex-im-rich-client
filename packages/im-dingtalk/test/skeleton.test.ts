import { describe, expect, it } from "vitest";
import { DINGTALK_CAPABILITIES, DingTalkChannelAdapter } from "../src/index.js";

describe("@codex-im/im-dingtalk skeleton (JAC-79)", () => {
  it("exports the DingTalk adapter shell and conservative capability constants", () => {
    expect(DINGTALK_CAPABILITIES).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: true,
      maxCallbackDataBytes: 64,
    });

    const adapter = new DingTalkChannelAdapter();
    expect(adapter.capabilities).toBe(DINGTALK_CAPABILITIES);
    expect(adapter.constructor.name).toBe("DingTalkChannelAdapter");
  });

  it("requires injected Stream lifecycle dependencies before start", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const adapter = new DingTalkChannelAdapter({ now: () => now });

    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
    expect(adapter._nowForTest()).toBe(now);

    await expect(adapter.start()).rejects.toThrow("requires an injected streamClient");
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);

    await adapter.stop();
    expect(adapter._startedForTest()).toBe(false);
  });

  it("keeps gated methods fail closed before start", async () => {
    const adapter = new DingTalkChannelAdapter();
    const target = { platform: "dingtalk", chatId: "cid_phase5_fake_group" };

    await expect(adapter.sendCard(target, {} as never)).rejects.toThrow(
      "DingTalkChannelAdapter.sendCard requires start() first",
    );
    await expect(
      adapter.answerAction("dtcb:v1:fake", { ok: true, userMessage: "ok" }),
    ).rejects.toThrow("DingTalkChannelAdapter.answerAction requires start() first");
    await expect(adapter.sendFile(target, {} as never)).rejects.toThrow(
      "DingTalkChannelAdapter.sendFile requires start() first",
    );
  });
});

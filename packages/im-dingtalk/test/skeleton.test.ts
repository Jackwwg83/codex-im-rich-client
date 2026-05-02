import { describe, expect, it } from "vitest";
import { DINGTALK_CAPABILITIES, DingTalkChannelAdapter } from "../src/index.js";

describe("@codex-im/im-dingtalk skeleton (JAC-79)", () => {
  it("exports the DingTalk adapter shell and conservative capability constants", () => {
    expect(DINGTALK_CAPABILITIES).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: false,
      maxCallbackDataBytes: 64,
    });

    const adapter = new DingTalkChannelAdapter();
    expect(adapter.capabilities).toBe(DINGTALK_CAPABILITIES);
    expect(adapter.constructor.name).toBe("DingTalkChannelAdapter");
  });

  it("keeps Stream lifecycle explicitly gated for JAC-80", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const adapter = new DingTalkChannelAdapter({ now: () => now });

    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
    expect(adapter._nowForTest()).toBe(now);

    await expect(adapter.start()).rejects.toThrow(
      "DingTalkChannelAdapter.start requires JAC-80 Stream lifecycle implementation",
    );
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);

    await adapter.stop();
    expect(adapter._startedForTest()).toBe(false);
  });

  it("keeps later card/action/file slices explicitly unimplemented", async () => {
    const adapter = new DingTalkChannelAdapter();
    const target = { platform: "dingtalk", chatId: "cid_phase5_fake_group" };
    const ref = { target, messageId: "msg_phase5_fake_prompt" };

    await expect(adapter.sendCard(target, {} as never)).rejects.toThrow(
      "DingTalkChannelAdapter.sendCard is not implemented until JAC-82 card send/update",
    );
    await expect(adapter.updateCard(ref, {} as never)).rejects.toThrow(
      "DingTalkChannelAdapter.updateCard is not implemented until JAC-82 card send/update",
    );
    await expect(
      adapter.answerAction("dtcb:v1:fake", { ok: true, userMessage: "ok" }),
    ).rejects.toThrow(
      "DingTalkChannelAdapter.answerAction is not implemented until JAC-85 approval round-trip",
    );
    await expect(adapter.sendFile(target, {} as never)).rejects.toThrow(
      "DingTalkChannelAdapter.sendFile is not implemented until future attachment slice",
    );
  });
});

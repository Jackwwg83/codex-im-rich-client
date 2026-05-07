import { describe, expect, it } from "vitest";
import { SLACK_CAPABILITIES, SlackChannelAdapter } from "../src/index.js";

describe("@codex-im/im-slack skeleton (JAC-244)", () => {
  it("exports the Slack adapter shell and capability constants", () => {
    expect(SLACK_CAPABILITIES).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: true,
      maxCallbackDataBytes: 2000,
    });

    const adapter = new SlackChannelAdapter();
    expect(adapter.capabilities).toBe(SLACK_CAPABILITIES);
    expect(adapter.constructor.name).toBe("SlackChannelAdapter");
  });

  it("requires injected Socket Mode lifecycle dependencies before start", async () => {
    const now = new Date("2026-05-07T00:00:00.000Z");
    const adapter = new SlackChannelAdapter({ now: () => now });

    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
    expect(adapter._nowForTest()).toBe(now);

    await expect(adapter.start()).rejects.toThrow(
      "SlackChannelAdapter.start requires an injected socketClient",
    );
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);

    await adapter.stop();
    expect(adapter._startedForTest()).toBe(false);
  });

  it("fails closed when outbound methods are called before start", async () => {
    const adapter = new SlackChannelAdapter();
    const target = { platform: "slack", chatId: "T_TEST:C_TEST" };
    const ref = { target, messageId: "C_TEST:1715000000.000100" };

    await expect(adapter.sendText?.(target, "hello")).rejects.toThrow(
      "SlackChannelAdapter.sendText requires start() first",
    );
    await expect(adapter.editText(ref, "hello")).rejects.toThrow(
      "SlackChannelAdapter.editText requires start() first",
    );
    await expect(
      adapter.sendFile(target, {
        filename: "artifact.txt",
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toThrow("SlackChannelAdapter.sendFile requires start() first");
  });
});

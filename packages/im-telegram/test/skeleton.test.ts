import { describe, expect, it } from "vitest";
import { TELEGRAM_CAPABILITIES, TelegramChannelAdapter } from "../src/index.js";

describe("@codex-im/im-telegram skeleton (T20)", () => {
  it("exports the real Telegram adapter shell and Phase 3 capability constants", () => {
    expect(TELEGRAM_CAPABILITIES).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: false,
      maxCallbackDataBytes: 64,
    });

    const adapter = new TelegramChannelAdapter();
    expect(adapter.capabilities).toBe(TELEGRAM_CAPABILITIES);
    expect(adapter.constructor.name).toBe("TelegramChannelAdapter");
  });
});

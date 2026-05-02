import type { ChannelCapabilities } from "@codex-im/channel-core";

export const TELEGRAM_CAPABILITIES = Object.freeze({
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: false,
  maxCallbackDataBytes: 64,
} satisfies ChannelCapabilities);

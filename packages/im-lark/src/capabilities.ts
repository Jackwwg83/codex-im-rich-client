import type { ChannelCapabilities } from "@codex-im/channel-core";

export const LARK_CAPABILITIES = Object.freeze({
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: false,
  maxCallbackDataBytes: 256,
} satisfies ChannelCapabilities);

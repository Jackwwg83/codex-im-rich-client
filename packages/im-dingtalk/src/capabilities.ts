import type { ChannelCapabilities } from "@codex-im/channel-core";

export const DINGTALK_CAPABILITIES = Object.freeze({
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: true,
  maxCallbackDataBytes: 64,
} satisfies ChannelCapabilities);

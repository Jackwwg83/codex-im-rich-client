import type { ChannelCapabilities } from "@codex-im/channel-core";

export const SLACK_CAPABILITIES = Object.freeze({
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: true,
  maxCallbackDataBytes: 2000,
} satisfies ChannelCapabilities);

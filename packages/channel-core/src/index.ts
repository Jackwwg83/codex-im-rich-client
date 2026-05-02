// @codex-im/channel-core — public surface (T18 skeleton + types).
//
// Phase 2 fills this in incrementally:
//   - T18  types (Target / Sender / MessageRef / OutboundFile /
//          InboundMessage / InboundAction) + ChannelCapabilities +
//          requireCapability helper. Boundary tests assert no runtime
//          import of @codex-im/core / @codex-im/app-server-client /
//          @codex-im/codex-runtime / @codex-im/protocol from src.
//   - T19  ChannelAdapter interface (closed; D14 escape clause in JSDoc)
//          + TelegramShapeFakeChannelAdapter (callback_data ≤ 62 bytes,
//          60s callback-query answer deadline, parse_mode unsupported).
//
// Boundary policy (F13): channel-core depends only on @codex-im/render
// (type-only). Render itself depends on @codex-im/core for redact +
// classifyApprovalRequest, but channel-core never imports those — the
// type-only chain through render gives us ApprovalAction without the
// runtime dep.

export type {
  InboundAction,
  InboundMessage,
  MessageRef,
  OutboundFile,
  Sender,
  Target,
} from "./types.js";
export { requireCapability } from "./capabilities.js";
export type { ChannelCapabilities } from "./capabilities.js";

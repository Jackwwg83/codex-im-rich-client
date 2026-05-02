// T18 (Phase 2) — ChannelCapabilities + requireCapability helper.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §2.1
// (D14 capability matrix is the only escape hatch for adapter divergence
// within the closed ChannelAdapter interface)
//
// Phase 2 capability matrix:
//   supportsButtons      — adapter renders inline keyboard buttons
//   canEditMessage       — adapter can edit a previously sent message
//                          (used to update an approval card on resolve)
//   supportsAttachments  — adapter can send OutboundFile payloads
//   maxCallbackDataBytes — upper bound on callback_data size (per
//                          platform; Telegram = 64 per Bot API §inline
//                          keyboards). Renderer / daemon wire-up should
//                          query this before encoding nonces into
//                          button payloads.
//
// `requireCapability` is the helper for adapter-agnostic code that
// needs to fail closed when a feature is unsupported. Throws a
// descriptive Error rather than returning a result — these are
// programmer errors (missing branch in the adapter wire-up), not
// recoverable conditions.

export type ChannelCapabilities = {
  readonly supportsButtons: boolean;
  readonly canEditMessage: boolean;
  readonly supportsAttachments: boolean;
  readonly maxCallbackDataBytes: number;
};

export function requireCapability(
  caps: ChannelCapabilities,
  capability: keyof ChannelCapabilities,
): void {
  const value = caps[capability];
  if (typeof value === "boolean") {
    if (!value) {
      throw new Error(
        `ChannelAdapter capability "${capability}" is required but not supported by this adapter`,
      );
    }
    return;
  }
  // Numeric capabilities are present iff > 0; treat 0 as "feature absent".
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `ChannelAdapter capability "${capability}" is required but reports non-positive value ${value}`,
      );
    }
    return;
  }
  throw new Error(`ChannelAdapter capability "${capability}" has an unrecognized shape`);
}

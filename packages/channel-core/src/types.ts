// T18 (Phase 2) — channel-core types.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §2.1
//
// IM-platform-agnostic types consumed by ChannelAdapter implementations.
// All shapes are platform-neutral — Telegram-specific fields (bot_token,
// inline_keyboard, etc.) live INSIDE adapter implementations, never on
// the boundary.
//
// Boundary policy (F13):
//   channel-core has NO runtime dep on @codex-im/core. The InboundAction
//   `uiAction` field uses ApprovalAction (= core's ApprovalUiAction)
//   imported type-only via @codex-im/render. Test
//   `no-broker-import.test.ts` enforces no runtime import of
//   `@codex-im/core` or `@codex-im/codex-runtime` or
//   `@codex-im/app-server-client` from channel-core src.
//
// Note: channel-core's `Target` mirrors core's `Target` shape verbatim
// (platform/chatId/threadKey/topicId). We declare it here rather than
// re-exporting because the runtime boundary forbids importing from
// core. Daemon wire-up assigns one to the other freely thanks to
// TypeScript structural typing.

import type { ApprovalAction } from "@codex-im/render";

/**
 * IM platform addressing — identifies which chat / thread / topic an
 * inbound message or action belongs to. Mirrors core's `Target` (same
 * shape, different declaration site to preserve the F13 boundary).
 */
export type Target = {
  readonly platform: string;
  readonly chatId: string;
  readonly threadKey?: string;
  readonly topicId?: string;
};

/**
 * The authenticated identity of whoever sent the inbound event. The
 * adapter sets this from platform-asserted user context (Telegram
 * `from.id`, Lark `user_id`, DingTalk `senderStaffId`). Phase 2 trusts
 * platform-asserted identity; Phase 3 SecurityPolicy can re-validate.
 */
export type Sender = {
  readonly userId: string;
  /** Platform-supplied display name. Optional — some platforms don't expose. */
  readonly displayName?: string;
};

/**
 * Stable cross-message reference an adapter returns from `sendCard` /
 * `sendText` / `editText`. Daemon wire-up keeps it so `updateCard` /
 * `editText` / `answerAction` can target the right rendered message
 * later.
 *
 * Opaque — adapters typically encode (chatId, messageId) or whatever
 * their platform needs. The daemon doesn't introspect.
 */
export type MessageRef = {
  readonly target: Target;
  /** Adapter-specific message identifier. */
  readonly messageId: string;
};

/**
 * Outbound file payload for adapters that support attachments. Phase 2
 * doesn't ship file-sending in the core flow — included so the
 * ChannelAdapter interface is closed (D14) without forcing future
 * amendments for a basic capability.
 */
export type OutboundFile = {
  /** UTF-8 file name as the IM platform should display it. */
  readonly filename: string;
  /** Platform-agnostic byte payload. */
  readonly bytes: Uint8Array;
  /** MIME type hint (e.g. "text/plain", "application/json"). */
  readonly contentType: string;
};

/**
 * Inbound chat-message event from the IM platform. The adapter
 * normalizes raw platform payloads (Telegram Update, Lark webhook) into
 * this shape before handing off to the daemon wire-up.
 */
export type InboundMessage = {
  readonly target: Target;
  readonly sender: Sender;
  /** Plain-text body. Adapters strip or render formatting per platform. */
  readonly text: string;
  /** Adapter-supplied wall-clock receive time. */
  readonly receivedAt: Date;
  /** Stable reference to the inbound message (for reply / edit chains). */
  readonly messageRef: MessageRef;
};

/**
 * Inbound action — user clicked an approval button (or typed an
 * action slash command on a non-buttons platform).
 */
export type InboundAction = {
  readonly approvalId: string;
  readonly uiAction: ApprovalAction;
  readonly target: Target;
  readonly sender: Sender;
  /**
   * Stable reference to the rendered IM message that produced this
   * action. Real IM adapters set this when the platform exposes it.
   * When Telegram callback_query.message is null, adapters use
   * messageId="<unknown>" so daemon-side messageRef validation fails
   * closed before broker.resolve().
   */
  readonly messageRef?: MessageRef;
  /**
   * Legacy fallback round-tripped from the rendered card. Production
   * Phase 3 daemon action handling ignores this field and uses
   * `rawCallbackData` as the callback source of truth.
   */
  readonly callbackNonce: string;
  /**
   * Verbatim platform callback payload. Production daemon code decodes
   * this field (for example `v1:<opaque-token>`) before any
   * broker.resolve call.
   */
  readonly rawCallbackData: string;
  /** Adapter-supplied wall-clock receive time. */
  readonly receivedAt: Date;
  /**
   * Platform's callback handle (e.g. Telegram callback_query.id).
   * The adapter uses this to ack the user's click via `answerAction`.
   * Opaque to the daemon.
   */
  readonly callbackHandle: string;
};

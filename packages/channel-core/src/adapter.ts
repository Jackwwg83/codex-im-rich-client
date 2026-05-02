// T19 (Phase 2) — ChannelAdapter interface (closed for Phase 2; D14).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T19
//
// CLOSED INTERFACE (D14 escape clause):
//   This interface is closed for Phase 2 implementations. Phase 4 /
//   Phase 5 / future adapter additions (im-lark, im-dingtalk, im-discord,
//   …) MUST conform to this interface verbatim. If a future platform
//   genuinely cannot fit, the proposed change must go through:
//     1. plan-eng-review (interface evolution proposal),
//     2. Codex outside-voice review (boundary impact),
//   before landing.
//
//   Within the closed interface, capability divergence is the ONLY
//   escape hatch — adapters report what they CAN do via
//   ChannelCapabilities (supportsButtons, canEditMessage,
//   supportsAttachments, maxCallbackDataBytes), and adapter-agnostic
//   callers (the daemon wire-up) use requireCapability to fail-close
//   when a feature is unsupported.
//
// SCOPE PER METHOD:
//   start()         — open platform connection (Telegram long-poll,
//                     Lark webhook listener, etc.). Idempotent on
//                     repeated call.
//   stop()          — drain in-flight + close. After stop, all
//                     mutating methods reject; subscribers stop firing.
//   onMessage(h)    — register inbound chat-message handler. Returns
//                     unsubscribe.
//   onAction(h)     — register inbound action (button click / slash
//                     command) handler. Returns unsubscribe.
//   sendCard(t, c)  — render an ApprovalCard at target t. Returns
//                     MessageRef + callbackNonce. Adapter encodes
//                     callback_data within capability limits; throws
//                     synchronously on encoding overflow so the
//                     daemon wire-up sees the bug locally instead of
//                     as a remote 400.
//   updateCard(r,c) — re-render an existing card (typically status flip).
//   editText(r, t)  — edit an existing message body (text-only).
//   answerAction(handle, ack) — ack a callback_query within the
//                     platform's deadline (Telegram = 60s absolute).
//                     Rejects on missing handle / past deadline / post-stop.

import type { ApprovalCard } from "@codex-im/render";
import type { ChannelCapabilities } from "./capabilities.js";
import type { InboundAction, InboundMessage, MessageRef, OutboundFile, Target } from "./types.js";

/**
 * Acknowledgement payload returned to the IM platform for a
 * user-initiated action (button click). `ok=true` typically displays
 * `userMessage` as a small toast; `ok=false` may show an error toast.
 * Platform-specific UX nuances live inside the adapter implementation.
 */
export type ActionAck = {
  readonly ok: boolean;
  readonly userMessage: string;
};

/**
 * Outcome of a sendCard / updateCard call. The MessageRef lets the
 * daemon target subsequent updateCard / editText / answerAction; the
 * callbackNonce is what the broker binds via bindActorPolicy and
 * validates on resolve (D19 stale_callback).
 */
export type SendCardResult = {
  readonly messageRef: MessageRef;
  readonly callbackNonce: string;
};

export interface ChannelAdapter {
  /** Adapter capability matrix. Static for the lifetime of one adapter. */
  readonly capabilities: ChannelCapabilities;

  /** Open the platform connection. Idempotent on repeated call. */
  start(): Promise<void>;

  /** Drain in-flight and close. Subsequent mutating calls reject. */
  stop(): Promise<void>;

  /** Subscribe to inbound chat messages. Returns an unsubscribe handle. */
  onMessage(handler: (msg: InboundMessage) => void): () => void;

  /** Subscribe to inbound user actions (button clicks). Returns unsubscribe. */
  onAction(handler: (action: InboundAction) => void): () => void;

  /** Render an ApprovalCard. Returns MessageRef + callbackNonce. */
  sendCard(target: Target, card: ApprovalCard): Promise<SendCardResult>;

  /** Re-render an existing card (typically a status flip). */
  updateCard(ref: MessageRef, card: ApprovalCard): Promise<void>;

  /** Edit an existing message body (text-only). */
  editText(ref: MessageRef, body: string): Promise<void>;

  /** Ack a user action's platform callback handle. */
  answerAction(callbackHandle: string, ack: ActionAck): Promise<void>;

  /** Send a file payload. Requires `supportsAttachments` capability. */
  sendFile(target: Target, file: OutboundFile): Promise<MessageRef>;
}

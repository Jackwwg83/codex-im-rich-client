// T19 (Phase 2) — TelegramShapeFakeChannelAdapter.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T19
// (D17 / Codex P2 — canonical reference adapter for tests + e2e rigs)
//
// This is the test-side ChannelAdapter implementation. It deliberately
// enforces the HARDEST constraints from Telegram's Bot API so adapter-
// agnostic wire-up code that passes the fake is guaranteed to pass
// real Telegram with margin:
//
//   callback_data ≤ 62 bytes
//     (Telegram Bot API §inlineKeyboardButton.callback_data limit is
//      64 bytes; fake is strictly stricter so consumers have 2 bytes of
//      headroom for any Telegram-side encoding subtleties.
//      Cite: https://core.telegram.org/bots/api#inlinekeyboardbutton)
//
//   answerCallbackQuery within 60s absolute
//     (Telegram drops the "loading" UI on the user side ~10s before
//      this; the fake enforces the absolute 60s deadline so timing
//      bugs surface deterministically in tests.
//      Cite: https://core.telegram.org/bots/api#answercallbackquery)
//
//   parse_mode unsupported
//     (Real Telegram supports MarkdownV2 / HTML; the fake intentionally
//      omits parse_mode so adapter wire-up can't accidentally rely on
//      formatting that won't render on other platforms.)
//
// Lifecycle:
//   - Construct → start() → mutating calls allowed → stop() → mutating
//     calls reject. start() is idempotent; stop() is idempotent.
//   - Subscribers (onMessage / onAction) survive across stop() calls
//     for inspection; new injectMessage / injectAction after stop() is
//     a programmer error.
//
// Test affordances (`_…ForTest`):
//   - `_editsForTest()` returns recorded editText calls.
//   - `_acksForTest()` returns recorded answerAction calls.
//   - `_callbackDataForTest(ref)` returns the encoded callback_data
//     payloads for a sent card's action buttons.

import type { ApprovalCard } from "@codex-im/render";
import type { ActionAck, ChannelAdapter, SendCardResult } from "./adapter.js";
import { type ChannelCapabilities, requireCapability } from "./capabilities.js";
import type { InboundAction, InboundMessage, MessageRef, OutboundFile, Target } from "./types.js";

const CALLBACK_DATA_LIMIT_BYTES = 62;
const ANSWER_CALLBACK_DEADLINE_MS = 60_000;
const NONCE_BYTE_LENGTH = 16;

const TELEGRAM_LIKE_CAPABILITIES: ChannelCapabilities = {
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: true,
  maxCallbackDataBytes: CALLBACK_DATA_LIMIT_BYTES,
};

type StoredCallback = {
  readonly receivedAt: Date;
};

type StoredCard = {
  readonly callbackNonce: string;
  readonly callbackData: readonly string[];
};

function generateNonce(): string {
  // Hex of 16 random bytes — 32 chars, ≥16 byte entropy. Avoid
  // crypto.randomUUID() so tests on older runtimes still pass.
  const chars = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < NONCE_BYTE_LENGTH * 2; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function encodeCallbackData(approvalId: string, actionKind: string, nonce: string): string {
  return `${approvalId}|${actionKind}|${nonce}`;
}

type InjectableInboundAction = Omit<InboundAction, "rawCallbackData"> & {
  readonly rawCallbackData?: string;
};

function callbackDataForAction(
  approvalId: string,
  action: ApprovalCard["actions"][number],
  nonce: string,
): string {
  return action.wirePayload ?? encodeCallbackData(approvalId, action.kind, nonce);
}

export class TelegramShapeFakeChannelAdapter implements ChannelAdapter {
  readonly capabilities: ChannelCapabilities = TELEGRAM_LIKE_CAPABILITIES;

  #started = false;
  #stopped = false;
  readonly #onMessage = new Set<(msg: InboundMessage) => void>();
  readonly #onAction = new Set<(action: InboundAction) => void>();
  readonly #cards = new Map<string, StoredCard>(); // keyed by messageId
  readonly #callbacks = new Map<string, StoredCallback>(); // keyed by callbackHandle
  readonly #edits: Array<{ messageRef: MessageRef; text: string }> = [];
  readonly #acks: Array<{ callbackHandle: string; ack: ActionAck }> = [];
  // T24 Codex review P1 — instance-scoped messageId sequence so tests
  // see fresh ids per adapter (was module-scoped before, leaking state
  // across tests).
  #messageIdSeq = 0;

  #nextMessageId(): string {
    this.#messageIdSeq += 1;
    return `fake-msg-${this.#messageIdSeq}`;
  }

  async start(): Promise<void> {
    this.#started = true;
    this.#stopped = false;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
  }

  onMessage(handler: (msg: InboundMessage) => void): () => void {
    this.#onMessage.add(handler);
    return () => {
      this.#onMessage.delete(handler);
    };
  }

  onAction(handler: (action: InboundAction) => void): () => void {
    this.#onAction.add(handler);
    return () => {
      this.#onAction.delete(handler);
    };
  }

  async sendCard(target: Target, card: ApprovalCard): Promise<SendCardResult> {
    this.#assertRunning("sendCard");
    requireCapability(this.capabilities, "supportsButtons");
    const callbackNonce = generateNonce();
    const callbackData: string[] = [];
    for (const action of card.actions) {
      const data = callbackDataForAction(card.approvalId, action, callbackNonce);
      const bytes = new TextEncoder().encode(data).byteLength;
      if (bytes > CALLBACK_DATA_LIMIT_BYTES) {
        throw new Error(
          `TelegramShapeFakeChannelAdapter: callback_data for action "${action.kind}" is ${bytes}B, exceeds ${CALLBACK_DATA_LIMIT_BYTES}B limit (Telegram Bot API §inlineKeyboardButton). Shorten approvalId.`,
        );
      }
      callbackData.push(data);
    }
    const messageId = this.#nextMessageId();
    const messageRef: MessageRef = { target, messageId };
    this.#cards.set(messageId, { callbackNonce, callbackData });
    return { messageRef, callbackNonce };
  }

  async updateCard(ref: MessageRef, card: ApprovalCard): Promise<void> {
    this.#assertRunning("updateCard");
    if (!this.#cards.has(ref.messageId)) {
      throw new Error(`TelegramShapeFakeChannelAdapter: unknown messageId ${ref.messageId}`);
    }
    // Re-encode callback_data so updates honor any new action set.
    const stored = this.#cards.get(ref.messageId);
    if (!stored) return;
    const newData: string[] = [];
    for (const action of card.actions) {
      const data = callbackDataForAction(card.approvalId, action, stored.callbackNonce);
      const bytes = new TextEncoder().encode(data).byteLength;
      if (bytes > CALLBACK_DATA_LIMIT_BYTES) {
        throw new Error(
          `TelegramShapeFakeChannelAdapter: updateCard callback_data for action "${action.kind}" is ${bytes}B, exceeds ${CALLBACK_DATA_LIMIT_BYTES}B limit`,
        );
      }
      newData.push(data);
    }
    this.#cards.set(ref.messageId, { callbackNonce: stored.callbackNonce, callbackData: newData });
  }

  async editText(ref: MessageRef, body: string): Promise<void> {
    this.#assertRunning("editText");
    requireCapability(this.capabilities, "canEditMessage");
    this.#edits.push({ messageRef: ref, text: body });
  }

  async answerAction(callbackHandle: string, ack: ActionAck): Promise<void> {
    this.#assertRunning("answerAction");
    const stored = this.#callbacks.get(callbackHandle);
    if (!stored) {
      throw new Error(`TelegramShapeFakeChannelAdapter: unknown callback handle ${callbackHandle}`);
    }
    const elapsed = Date.now() - stored.receivedAt.getTime();
    if (elapsed > ANSWER_CALLBACK_DEADLINE_MS) {
      throw new Error(
        `TelegramShapeFakeChannelAdapter: answer-callback-query deadline exceeded (${elapsed}ms > ${ANSWER_CALLBACK_DEADLINE_MS}ms; Telegram Bot API §answerCallbackQuery)`,
      );
    }
    this.#acks.push({ callbackHandle, ack });
  }

  async sendFile(target: Target, file: OutboundFile): Promise<MessageRef> {
    this.#assertRunning("sendFile");
    requireCapability(this.capabilities, "supportsAttachments");
    void file;
    return { target, messageId: this.#nextMessageId() };
  }

  // ─── Test-only injection + inspection ───────────────────────────────

  injectMessage(msg: InboundMessage): void {
    this.#assertRunning("injectMessage");
    for (const handler of this.#onMessage) {
      try {
        handler(msg);
      } catch {
        // Subscriber bug — swallow so other subscribers still fire.
        // Mirrors the broker's #emitPendingCreated semantics.
      }
    }
  }

  injectAction(action: InjectableInboundAction): void {
    this.#assertRunning("injectAction");
    const normalized: InboundAction = {
      ...action,
      rawCallbackData: action.rawCallbackData ?? `v1:${action.callbackNonce}`,
    };
    this.#callbacks.set(normalized.callbackHandle, { receivedAt: normalized.receivedAt });
    for (const handler of this.#onAction) {
      try {
        handler(normalized);
      } catch {
        // see above
      }
    }
  }

  _editsForTest(): ReadonlyArray<{ messageRef: MessageRef; text: string }> {
    return this.#edits;
  }

  _acksForTest(): ReadonlyArray<{ callbackHandle: string; ack: ActionAck }> {
    return this.#acks;
  }

  _callbackDataForTest(ref: MessageRef): readonly string[] {
    return this.#cards.get(ref.messageId)?.callbackData ?? [];
  }

  #assertRunning(method: string): void {
    if (!this.#started) {
      throw new Error(`TelegramShapeFakeChannelAdapter.${method}: adapter not started`);
    }
    if (this.#stopped) {
      throw new Error(`TelegramShapeFakeChannelAdapter.${method}: adapter is stopped`);
    }
  }
}

// T19 (Phase 2) — TelegramShapeFakeChannelAdapter round-trip tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T19
// (D17 / Codex P2 — TelegramShapeFakeChannelAdapter is the canonical reference)
//
// What "round-trip" covers:
//   - injectMessage(msg) → onMessage subscribers fire with msg
//   - injectAction(action) → onAction subscribers fire with action
//   - sendCard(card) → returns MessageRef + nonce; the SAME nonce is
//     surfaced on a subsequent injectAction tied to that approvalId
//   - sendText(target, body) → adapter records the bot-owned text send
//   - updateCard(ref, card) → second sendCard for same approvalId
//     succeeds (e.g. status flip from pending → resolved)
//   - editText(ref, body) → adapter records the edit
//   - answerAction(handle, ack) → adapter records the ack within the
//     deadline (test-only assertion; real Telegram would forward the ack)

import type { ApprovalCard } from "@codex-im/render";
import { describe, expect, it, vi } from "vitest";
import { TelegramShapeFakeChannelAdapter } from "../src/fake.js";

const SAMPLE_CARD: ApprovalCard = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-7",
  summary: "Run command: ls -la",
  target: { riskLevel: "high" },
  actions: [{ kind: "allow_once" }, { kind: "decline" }],
  status: "pending",
  createdAt: new Date(0),
};

describe("TelegramShapeFakeChannelAdapter — round-trip (T19)", () => {
  it("injectMessage triggers onMessage subscribers", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const seen = vi.fn();
    adapter.onMessage(seen);
    adapter.injectMessage({
      target: { platform: "fake-telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      text: "hello",
      receivedAt: new Date(),
      messageRef: {
        target: { platform: "fake-telegram", chatId: "c-1" },
        messageId: "m-1",
      },
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]?.text).toBe("hello");
    await adapter.stop();
  });

  it("sendCard returns MessageRef + nonce; injectAction round-trips the nonce", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const target = { platform: "fake-telegram", chatId: "c-1" };
    const sent = await adapter.sendCard(target, SAMPLE_CARD);
    expect(sent.messageRef.target.chatId).toBe("c-1");
    expect(sent.messageRef.messageId).toBeTruthy();
    expect(sent.callbackNonce).toBeTruthy();
    expect(sent.callbackNonce.length).toBeGreaterThanOrEqual(16);

    const seen = vi.fn();
    adapter.onAction(seen);
    adapter.injectAction({
      approvalId: SAMPLE_CARD.approvalId,
      uiAction: { kind: "allow_once" },
      target,
      sender: { userId: "u-1" },
      callbackNonce: sent.callbackNonce,
      receivedAt: new Date(),
      callbackHandle: "cb-q-1",
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]?.callbackNonce).toBe(sent.callbackNonce);
    await adapter.stop();
  });

  it("updateCard re-sends for the same approvalId (e.g. status flip)", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const target = { platform: "fake-telegram", chatId: "c-1" };
    const sent = await adapter.sendCard(target, SAMPLE_CARD);
    const resolved: ApprovalCard = { ...SAMPLE_CARD, status: "resolved" };
    await expect(adapter.updateCard(sent.messageRef, resolved)).resolves.toBeUndefined();
    await adapter.stop();
  });

  it("editText records the edit on a known MessageRef", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const target = { platform: "fake-telegram", chatId: "c-1" };
    const sent = await adapter.sendCard(target, SAMPLE_CARD);
    await expect(adapter.editText(sent.messageRef, "edited body")).resolves.toBeUndefined();
    expect(adapter._editsForTest()).toContainEqual({
      messageRef: sent.messageRef,
      text: "edited body",
    });
    await adapter.stop();
  });

  it("sendText returns a bot-owned MessageRef and records the text body", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const target = { platform: "fake-telegram", chatId: "c-1" };

    const messageRef = await adapter.sendText(target, "Codex is working...");

    expect(messageRef).toEqual({ target, messageId: "fake-msg-1" });
    expect(adapter._textsForTest()).toContainEqual({
      messageRef,
      text: "Codex is working...",
    });
    await adapter.stop();
  });

  it("answerAction acks a callback handle within the deadline", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    // Inject the action first so the adapter knows about the callback handle.
    adapter.injectAction({
      approvalId: "approval-7",
      uiAction: { kind: "allow_once" },
      target: { platform: "fake-telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      callbackNonce: "nonce-aaaaaaaaaaaaaaaa",
      receivedAt: new Date(),
      callbackHandle: "cb-q-1",
    });
    await expect(
      adapter.answerAction("cb-q-1", { ok: true, userMessage: "Approved." }),
    ).resolves.toBeUndefined();
    expect(adapter._acksForTest()).toContainEqual({
      callbackHandle: "cb-q-1",
      ack: { ok: true, userMessage: "Approved." },
    });
    await adapter.stop();
  });

  it("multiple onMessage subscribers all fire", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const a = vi.fn();
    const b = vi.fn();
    adapter.onMessage(a);
    adapter.onMessage(b);
    adapter.injectMessage({
      target: { platform: "fake-telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      text: "ping",
      receivedAt: new Date(),
      messageRef: {
        target: { platform: "fake-telegram", chatId: "c-1" },
        messageId: "m-2",
      },
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await adapter.stop();
  });

  it("onAction returns an unsubscribe function", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const seen = vi.fn();
    const unsub = adapter.onAction(seen);
    unsub();
    adapter.injectAction({
      approvalId: "approval-x",
      uiAction: { kind: "decline" },
      target: { platform: "fake-telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      callbackNonce: "nonce-aaaaaaaaaaaaaaa",
      receivedAt: new Date(),
      callbackHandle: "cb-q-x",
    });
    expect(seen).not.toHaveBeenCalled();
    await adapter.stop();
  });

  it("subscriber exceptions don't prevent other subscribers from firing", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const thrower = vi.fn(() => {
      throw new Error("subscriber bug");
    });
    const ok = vi.fn();
    adapter.onMessage(thrower);
    adapter.onMessage(ok);
    adapter.injectMessage({
      target: { platform: "fake-telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      text: "boom",
      receivedAt: new Date(),
      messageRef: {
        target: { platform: "fake-telegram", chatId: "c-1" },
        messageId: "m-3",
      },
    });
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    await adapter.stop();
  });
});

// T19 (Phase 2) — TelegramShapeFakeChannelAdapter callback_query
// 60-second answer deadline.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T19
// (cite Telegram Bot API §answerCallbackQuery; absolute 60-second
// deadline from when Telegram dispatched the callback_query;
// practical user-visible deadline ~10s before Telegram drops the
// loading state on the button.)
//
// What the fake enforces:
//   - Each callback_query has a wall-clock receivedAt.
//   - answerAction(handle, ...) inside the 60s window resolves.
//   - answerAction(handle, ...) outside the 60s window rejects with
//     a deadline-exceeded error.
//   - editText / answerAction after stop() also reject (lifecycle).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramShapeFakeChannelAdapter } from "../src/fake.js";
import type { InboundAction } from "../src/index.js";

const TARGET = { platform: "fake-telegram", chatId: "c-1" };
const FIXED_NOW = new Date("2026-05-01T12:00:00.000Z").getTime();

function actionAt(ts: number): InboundAction {
  return {
    approvalId: "approval-7",
    uiAction: { kind: "allow_once" },
    target: TARGET,
    sender: { userId: "u-1" },
    callbackNonce: "nonce-aaaaaaaaaaaaaaaa",
    rawCallbackData: "v1:nonce-aaaaaaaaaaaaaaaa",
    receivedAt: new Date(ts),
    callbackHandle: "cb-q-deadline",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TelegramShapeFakeChannelAdapter — answer-callback-query deadline (T19)", () => {
  it("answerAction inside the 60s window resolves", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    adapter.injectAction(actionAt(FIXED_NOW));
    // Advance 30 seconds (well within 60).
    vi.setSystemTime(FIXED_NOW + 30_000);
    await expect(
      adapter.answerAction("cb-q-deadline", { ok: true, userMessage: "OK" }),
    ).resolves.toBeUndefined();
    await adapter.stop();
  });

  it("answerAction past the 60s window rejects with deadline-exceeded", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    adapter.injectAction(actionAt(FIXED_NOW));
    // Advance 61 seconds — past the absolute deadline.
    vi.setSystemTime(FIXED_NOW + 61_000);
    await expect(
      adapter.answerAction("cb-q-deadline", { ok: true, userMessage: "OK" }),
    ).rejects.toThrow(/deadline/);
    await adapter.stop();
  });

  it("editText after stop() rejects", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const sent = await adapter.sendCard(TARGET, {
      schemaVersion: "approval-card.v1",
      kind: "file_change",
      approvalId: "approval-stop-1",
      summary: "x",
      target: { riskLevel: "low" },
      actions: [{ kind: "decline" }],
      status: "pending",
      createdAt: new Date(FIXED_NOW),
    });
    await adapter.stop();
    await expect(adapter.editText(sent.messageRef, "post-stop")).rejects.toThrow(/stop/);
  });

  it("answerAction after stop() rejects", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    adapter.injectAction(actionAt(FIXED_NOW));
    await adapter.stop();
    await expect(
      adapter.answerAction("cb-q-deadline", { ok: false, userMessage: "x" }),
    ).rejects.toThrow(/stop/);
  });

  it("answerAction with unknown callback handle rejects (no inject before answer)", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    await expect(
      adapter.answerAction("cb-q-never-injected", { ok: true, userMessage: "OK" }),
    ).rejects.toThrow(/unknown|callback/i);
    await adapter.stop();
  });
});

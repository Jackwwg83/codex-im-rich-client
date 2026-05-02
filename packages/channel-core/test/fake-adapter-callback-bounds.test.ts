// T19 (Phase 2) — TelegramShapeFakeChannelAdapter callback_data bounds.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T19
// (cite Telegram Bot API §inlineKeyboardButton.callback_data;
// real Telegram limit is 64 bytes. Fake enforces 62 bytes — strictly
// stricter — so adapter wire-up code that passes the fake is
// guaranteed to pass real Telegram with 2 bytes of headroom.)
//
// What the fake encodes into callback_data:
//   payload = `${approvalId}|${uiAction.kind}|${callbackNonce}` is a
//   typical encoding shape, but the fake's contract is just "the byte
//   length of the wire callback_data MUST be ≤ 62". Adapter wire-up
//   that violates this throws synchronously from sendCard so tests
//   catch the bug rather than the user discovering it as a Telegram
//   400 in production.

import type { ApprovalCard } from "@codex-im/render";
import { describe, expect, it } from "vitest";
import { TelegramShapeFakeChannelAdapter } from "../src/fake.js";

const TARGET = { platform: "fake-telegram", chatId: "c-1" };

function makeCard(approvalId: string): ApprovalCard {
  return {
    schemaVersion: "approval-card.v1",
    kind: "command_execution",
    approvalId,
    summary: "x",
    target: { riskLevel: "low" },
    actions: [{ kind: "allow_once" }, { kind: "decline" }],
    status: "pending",
    createdAt: new Date(0),
  };
}

describe("TelegramShapeFakeChannelAdapter — callback_data bounds (T19)", () => {
  it("realistic broker approvalId fits within the 62-byte budget", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    // Realistic broker-assigned id: `approval-${appServerRequestId}` where
    // request ids are short ints. Broker uses small sequential JSON-RPC
    // ids in production; "approval-99999" is a comfortable upper bound
    // for a long-running session. Encoding budget:
    //   14 (approvalId) + 1 (|) + 13 (allow_session, longest action) +
    //   1 (|) + 32 (16-byte hex nonce) = 61 bytes ≤ 62 budget.
    const sent = await adapter.sendCard(TARGET, makeCard("approval-99999"));
    const encoded = adapter._callbackDataForTest(sent.messageRef);
    expect(encoded.length).toBeGreaterThan(0);
    for (const data of encoded) {
      expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(62);
    }
    await adapter.stop();
  });

  it("approvalId that pushes payload over 62 bytes throws synchronously", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    // 70 ASCII chars in approvalId pushes ALL action payloads past 62 bytes.
    const huge = `approval-${"a".repeat(70)}`;
    await expect(adapter.sendCard(TARGET, makeCard(huge))).rejects.toThrow(/callback_data/);
    await adapter.stop();
  });

  it("parse_mode is not supported (Telegram fake intentionally omits)", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    expect(adapter.capabilities.supportsButtons).toBe(true);
    expect(adapter.capabilities.canEditMessage).toBe(true);
    expect(adapter.capabilities.maxCallbackDataBytes).toBe(62);
    // No parse_mode capability slot (fake exposes plain-text only).
    expect("parseMode" in adapter.capabilities).toBe(false);
    await adapter.stop();
  });
});

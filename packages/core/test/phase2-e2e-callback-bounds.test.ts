// T21.5 (Phase 2) — max-length callback_data fits (gstack T-G3).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T21.5
//
// Asserts that under realistic max-load assumptions for Phase 2:
//   - approvalId derived from a 6-digit appServerRequestId fits inside
//     the TelegramShapeFakeChannelAdapter's 62-byte callback_data
//     budget for ALL action kinds (longest = "allow_session" 13 chars).
//   - For larger ids (8-digit) the adapter THROWS synchronously rather
//     than silently emitting a bad payload — i.e. the test asserts the
//     overflow detection works for the e2e wire-up, not just the
//     adapter unit test.
//
// Phase 2 budget arithmetic:
//   "approval-" (9) + max-id (6) + "|" (1) + "allow_session" (13) +
//   "|" (1) + 32-char hex nonce = 62 bytes (exactly at limit).
//   For a comfortable headroom, real broker ids should stay 6-digit.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { TelegramShapeFakeChannelAdapter } from "@codex-im/channel-core";
import { projectAsRichBlock } from "@codex-im/render";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";

const TARGET = { platform: "fake-telegram", chatId: "c-bounds" };

async function makeRig(): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  adapter: TelegramShapeFakeChannelAdapter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide, {
    clientInfo: { name: "phase2-bounds", title: null, version: "0.0.0-t21.5" },
  });
  await client.start();
  const broker = new ApprovalBroker(client);
  broker.attach();
  broker.enablePendingMode("item/commandExecution/requestApproval");
  const adapter = new TelegramShapeFakeChannelAdapter();
  await adapter.start();
  return {
    client,
    fake,
    broker,
    adapter,
    cleanup: async () => {
      await adapter.stop();
      await client.stop();
    },
  };
}

describe("T21.5 — max-length callback_data fits within Telegram budget (gstack T-G3)", () => {
  it("6-digit appServerRequestId produces approvalId that fits all action encodings", async () => {
    const rig = await makeRig();
    try {
      // Wire-id = 999_999 (largest 6-digit). approvalId = "approval-999999"
      // (15 chars) — leaves 62 - 15 - 1 - 13 - 1 = 32 bytes for nonce.
      // The fake's 32-char hex nonce fits exactly.
      const id = 999_999;
      const approvalId = `approval-${id}`;
      const wirePromise = rig.fake
        .emitServerRequest("item/commandExecution/requestApproval", { command: "ls" }, id)
        .catch(() => undefined);
      // Yield + render the card via projectAsRichBlock + sendCard.
      let snap: import("../src/types.js").PendingApprovalSnapshot | null = null;
      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setImmediate(r));
        snap = rig.broker.getPending(approvalId);
        if (snap) break;
      }
      expect(snap).not.toBeNull();
      if (!snap) return;
      const block = projectAsRichBlock(snap);
      expect(block.type).toBe("approval");
      if (block.type !== "approval") return;
      const sent = await rig.adapter.sendCard(TARGET, block.card);
      expect(sent.callbackNonce.length).toBe(32);
      const encoded = rig.adapter._callbackDataForTest(sent.messageRef);
      expect(encoded.length).toBeGreaterThan(0);
      for (const data of encoded) {
        expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(62);
      }
      rig.broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await rig.cleanup();
    }
  });

  it("8-digit appServerRequestId triggers synchronous adapter throw (defense-in-depth)", async () => {
    const rig = await makeRig();
    try {
      // Wire-id = 99_999_999 (8 digits). approvalId = "approval-99999999"
      // (17 chars) — total: 17+1+13+1+32 = 64 bytes > 62 budget.
      const id = 99_999_999;
      const approvalId = `approval-${id}`;
      const wirePromise = rig.fake
        .emitServerRequest("item/commandExecution/requestApproval", { command: "ls" }, id)
        .catch(() => undefined);
      let snap: import("../src/types.js").PendingApprovalSnapshot | null = null;
      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setImmediate(r));
        snap = rig.broker.getPending(approvalId);
        if (snap) break;
      }
      expect(snap).not.toBeNull();
      if (!snap) return;
      const block = projectAsRichBlock(snap);
      if (block.type !== "approval") return;
      // Adapter MUST throw synchronously rather than silently send a
      // payload Telegram would reject with HTTP 400.
      await expect(rig.adapter.sendCard(TARGET, block.card)).rejects.toThrow(/callback_data/);
      rig.broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await rig.cleanup();
    }
  });
});

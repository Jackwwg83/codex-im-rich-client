import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";

async function makeBroker(): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide);
  await client.start();
  const broker = new ApprovalBroker(client);
  broker.attach();
  broker.enablePendingMode("item/fileChange/requestApproval");
  return {
    client,
    fake,
    broker,
    cleanup: async () => {
      broker.failPendingAsTransportLost();
      await client.stop();
      await fake.stop();
    },
  };
}

let seq = 7_300_000;
async function createPending(
  broker: ApprovalBroker,
  fake: FakeAppServer,
): Promise<{ id: number; approvalId: string; wirePromise: Promise<unknown> }> {
  seq += 1;
  const id = seq;
  const wirePromise = fake
    .emitServerRequest("item/fileChange/requestApproval", { synthetic: true }, id)
    .catch((err) => err);
  await new Promise((resolve) => setImmediate(resolve));
  const approvalId = `approval-${id}`;
  expect(broker.getPending(approvalId)?.id).toBe(approvalId);
  return { id, approvalId, wirePromise };
}

describe("ApprovalBroker.pruneTerminalRecords (Phase 3 T19e)", () => {
  it("removes terminal records older than maxAgeMs from both broker indexes", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const oldTerminal = await createPending(broker, fake);
      const recentTerminal = await createPending(broker, fake);

      broker.failPendingApprovalAsTransportLost(oldTerminal.approvalId);
      broker.failPendingApprovalAsTransportLost(recentTerminal.approvalId);
      await oldTerminal.wirePromise;
      await recentTerminal.wirePromise;

      const records = broker._pendingRecordsForTest();
      (records.get(oldTerminal.id) as { decidedAt: Date }).decidedAt = new Date(
        "2026-04-20T00:00:00.000Z",
      );
      (records.get(recentTerminal.id) as { decidedAt: Date }).decidedAt = new Date(
        "2026-05-02T00:00:00.000Z",
      );

      expect(
        broker.pruneTerminalRecords({
          maxAgeMs: 7 * 24 * 60 * 60 * 1000,
          now: new Date("2026-05-02T00:00:00.000Z"),
        }),
      ).toBe(1);
      expect(broker._pendingRecordsForTest().has(oldTerminal.id)).toBe(false);
      expect(broker._pendingRecordsForTest().has(recentTerminal.id)).toBe(true);
      expect(broker.approvalRecordCount()).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it("enforces maxCount with a bounded oldest-first batch and never prunes pending records", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const first = await createPending(broker, fake);
      const second = await createPending(broker, fake);
      const third = await createPending(broker, fake);
      const stillPending = await createPending(broker, fake);

      for (const pending of [first, second, third]) {
        broker.failPendingApprovalAsTransportLost(pending.approvalId);
        await pending.wirePromise;
      }

      const records = broker._pendingRecordsForTest();
      (records.get(first.id) as { decidedAt: Date }).decidedAt = new Date(
        "2026-05-02T00:00:01.000Z",
      );
      (records.get(second.id) as { decidedAt: Date }).decidedAt = new Date(
        "2026-05-02T00:00:02.000Z",
      );
      (records.get(third.id) as { decidedAt: Date }).decidedAt = new Date(
        "2026-05-02T00:00:03.000Z",
      );

      expect(
        broker.pruneTerminalRecords({
          maxAgeMs: 60_000,
          maxCount: 1,
          batchSize: 1,
          now: new Date("2026-05-02T00:00:04.000Z"),
        }),
      ).toBe(1);
      expect(broker._pendingRecordsForTest().has(first.id)).toBe(false);
      expect(broker._pendingRecordsForTest().has(second.id)).toBe(true);
      expect(broker._pendingRecordsForTest().has(third.id)).toBe(true);
      expect(broker._pendingRecordsForTest().get(stillPending.id)?.status).toBe("pending");
    } finally {
      await cleanup();
    }
  });
});

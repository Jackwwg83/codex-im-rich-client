import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it, vi } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";

async function makeBroker(): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  audit: AuditEmitter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide);
  await client.start();
  const audit = new AuditEmitter();
  const broker = new ApprovalBroker(client, { audit });
  broker.attach();
  broker.enablePendingMode("item/fileChange/requestApproval");
  return {
    client,
    fake,
    broker,
    audit,
    cleanup: async () => {
      await client.stop();
      await fake.stop();
    },
  };
}

let seq = 6_500_000;
function nextId(): number {
  seq += 1;
  return seq;
}

async function createPending(
  broker: ApprovalBroker,
  fake: FakeAppServer,
): Promise<{
  id: number;
  approvalId: string;
  wirePromise: Promise<unknown>;
}> {
  const id = nextId();
  const wirePromise = fake
    .emitServerRequest("item/fileChange/requestApproval", { synthetic: true }, id)
    .catch((err) => err);
  await new Promise((r) => setImmediate(r));
  const approvalId = `approval-${id}`;
  expect(broker.getPending(approvalId)?.id).toBe(approvalId);
  return { id, approvalId, wirePromise };
}

describe("ApprovalBroker.failPendingApprovalAsTransportLost (T6.5 / D40)", () => {
  it("settles only the requested pending approval and leaves siblings pending", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      const resolved = vi.fn();
      broker.onPendingResolved(resolved);

      const first = await createPending(broker, fake);
      const second = await createPending(broker, fake);

      broker.failPendingApprovalAsTransportLost(first.approvalId);
      await expect(first.wirePromise).resolves.toEqual({ decision: "decline" });

      const internal = broker._pendingRecordsForTest();
      expect(internal.get(first.id)?.status).toBe("transport_lost");
      expect(internal.get(second.id)?.status).toBe("pending");

      const transportLost = audit
        .recent()
        .filter((event) => event.kind === "approval.transport_lost");
      expect(transportLost).toHaveLength(1);
      expect(transportLost[0]?.approvalId).toBe(first.approvalId);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(resolved.mock.calls[0]?.[0].id).toBe(first.approvalId);
      expect(resolved.mock.calls[0]?.[1]).toEqual({
        kind: "system",
        reason: "transport_lost",
      });

      broker.failPendingApprovalAsTransportLost(second.approvalId);
      await second.wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("is a no-op for an unknown approval id", async () => {
    const { broker, audit, cleanup } = await makeBroker();
    try {
      broker.failPendingApprovalAsTransportLost("approval-does-not-exist");
      expect(audit.recent().filter((event) => event.kind === "approval.transport_lost")).toEqual(
        [],
      );
    } finally {
      await cleanup();
    }
  });

  it("is idempotent for an already-terminal approval id", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      const resolved = vi.fn();
      broker.onPendingResolved(resolved);
      const pending = await createPending(broker, fake);

      broker.failPendingApprovalAsTransportLost(pending.approvalId);
      broker.failPendingApprovalAsTransportLost(pending.approvalId);
      await pending.wirePromise;

      const transportLost = audit
        .recent()
        .filter((event) => event.kind === "approval.transport_lost");
      expect(transportLost).toHaveLength(1);
      expect(resolved).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });
});

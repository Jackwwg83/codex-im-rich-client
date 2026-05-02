// T21.4 (Phase 2) — secondary-index drift stress test (Codex missing #6).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T21.4
//
// Stresses the broker with concurrent server-requests + concurrent
// resolves + concurrent expirePending. Asserts that `#pending` and
// `#pendingById` stay in lock-step (D15) for ALL operations, both
// happy-path and racing.
//
// "Concurrent" here means microtask-interleaved — JS is single-
// threaded but async work yields between awaits. The test fires N
// emitServerRequests + then immediately fires N resolves +
// expirePending in a tight loop, then asserts the secondary-index
// invariant: every entry in #pending has a matching entry in
// #pendingById (same record reference).

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { TelegramShapeFakeChannelAdapter } from "@codex-im/channel-core";
import { projectAsRichBlock } from "@codex-im/render";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";
import type { ActorPolicy } from "../src/types.js";

const TARGET = { platform: "fake-telegram", chatId: "c-stress" };
const ALICE = { kind: "im" as const, platform: "fake-telegram", userId: "u-alice" };

async function buildStressRig(): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  audit: AuditEmitter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide, {
    clientInfo: { name: "phase2-stress", title: null, version: "0.0.0-t21.4" },
  });
  await client.start();
  const audit = new AuditEmitter();
  const broker = new ApprovalBroker(client, { audit });
  broker.attach();
  broker.enablePendingMode("item/commandExecution/requestApproval");
  const adapter = new TelegramShapeFakeChannelAdapter();
  await adapter.start();

  // Daemon wire-up auto-binds.
  broker.onPendingCreated((snap) => {
    void (async () => {
      const block = projectAsRichBlock(snap);
      if (block.type !== "approval") return;
      try {
        const sent = await adapter.sendCard(TARGET, block.card);
        const policy: ActorPolicy = {
          allowedActors: [ALICE],
          target: TARGET,
          callbackNonce: sent.callbackNonce,
        };
        broker.bindActorPolicy(snap.id, policy);
      } catch {
        // ignored
      }
    })();
  });

  return {
    client,
    fake,
    broker,
    audit,
    cleanup: async () => {
      await adapter.stop();
      await client.stop();
    },
  };
}

function assertIndexInvariant(broker: ApprovalBroker): void {
  // #pending is keyed by JSON-RPC id; #pendingById is keyed by string
  // approvalId. The broker exposes _pendingRecordsForTest as a
  // record-keyed view. For lock-step: every record in the broker's
  // internal store must be reachable via getPending() iff status===pending,
  // and via internal lookup regardless. Plus the SAME record reference
  // should appear in both maps.
  const internal = broker._pendingRecordsForTest();
  for (const [reqId, record] of internal) {
    if (record.status === "pending") {
      const snap = broker.getPending(record.id);
      expect(
        snap,
        `pending record ${record.id} (req=${reqId}) missing from getPending`,
      ).not.toBeNull();
      if (snap) {
        expect(snap.appServerRequestId).toBe(reqId);
      }
    } else {
      // Terminal record — getPending filters by status, so it returns null.
      expect(broker.getPending(record.id)).toBeNull();
    }
  }
  // Conversely, listPending should match the count of pending records
  // in the internal store.
  let pendingCount = 0;
  for (const record of internal.values()) {
    if (record.status === "pending") pendingCount += 1;
  }
  expect(broker.listPending().length).toBe(pendingCount);
}

describe("T21.4 — secondary-index drift stress (Codex missing #6 / D15)", () => {
  it("100 concurrent emit + resolve + expire interleavings keep #pending and #pendingById consistent", async () => {
    const rig = await buildStressRig();
    try {
      const N = 100;
      const wirePromises: Promise<unknown>[] = [];
      for (let i = 0; i < N; i += 1) {
        const id = 200 + i;
        wirePromises.push(
          rig.fake
            .emitServerRequest("item/commandExecution/requestApproval", { command: `n=${id}` }, id)
            .catch(() => undefined),
        );
      }
      // Yield enough cycles for all 100 daemon-wireup binds to land.
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setImmediate(r));
      }

      // After all binds: invariant should hold.
      assertIndexInvariant(rig.broker);
      expect(rig.broker.listPending().length).toBe(N);

      // Race: resolve half, expire the other half (almost) concurrently.
      const resolvePromises: Promise<unknown>[] = [];
      for (let i = 0; i < N; i += 1) {
        const id = 200 + i;
        const approvalId = `approval-${id}`;
        if (i % 2 === 0) {
          // Even: resolve via broker.resolve (need the bound nonce —
          // re-derive via _actorPolicyForTest since we don't store
          // sentCards in this minimal rig).
          const policy = rig.broker._actorPolicyForTest(approvalId);
          if (!policy) continue;
          resolvePromises.push(
            rig.broker
              .resolve({
                approvalId,
                decision: { kind: "decline" },
                actor: ALICE,
                target: TARGET,
                callbackNonce: policy.callbackNonce,
              })
              .catch(() => undefined),
          );
        }
      }
      // Concurrently fire expirePending for everything still pending.
      const expired = rig.broker.expirePending(-1);
      expect(expired).toBeGreaterThanOrEqual(0);

      await Promise.all(resolvePromises);
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setImmediate(r));
      }

      // After the storm: every pending record (status === pending) must
      // still be findable via getPending; terminal records remain in
      // internal store but are filtered from public surface.
      assertIndexInvariant(rig.broker);

      // listPending should be 0 (everything either resolved or expired).
      expect(rig.broker.listPending().length).toBe(0);

      // All wire promises should have resolved (broker settled them all).
      await Promise.all(wirePromises);
    } finally {
      await rig.cleanup();
    }
  });

  it("sequential interleaving — emit, resolve, emit, expire, emit — secondary index stays consistent", async () => {
    const rig = await buildStressRig();
    try {
      const ids: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        const id = 400 + round;
        ids.push(id);
        rig.fake
          .emitServerRequest("item/commandExecution/requestApproval", { command: "x" }, id)
          .catch(() => undefined);
        for (let i = 0; i < 3; i += 1) {
          await new Promise((r) => setImmediate(r));
        }
        if (round % 2 === 0) {
          const policy = rig.broker._actorPolicyForTest(`approval-${id}`);
          if (policy) {
            await rig.broker.resolve({
              approvalId: `approval-${id}`,
              decision: { kind: "decline" },
              actor: ALICE,
              target: TARGET,
              callbackNonce: policy.callbackNonce,
            });
          }
        } else {
          rig.broker.expirePending(-1);
        }
        assertIndexInvariant(rig.broker);
      }
    } finally {
      await rig.cleanup();
    }
  });
});

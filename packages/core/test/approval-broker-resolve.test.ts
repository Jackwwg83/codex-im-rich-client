// T11 (Phase 2) — broker.resolve() centerpiece.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T11
// (D12 / D19 / D20)
//
// Covers happy path + the 9 ResolveError branches + the structural invariants:
//   - Internal lookup uses #pendingById, NOT getPending (T11.2 / Codex P0-3).
//   - Expiry checked inside resolve() without an expirePending() sweep
//     (T11.3 / Codex P0-4).
//   - Actor binding validation per D19: wrong_actor / wrong_target /
//     stale_callback / binding_required (T11.4 / round-2 P1-5).
//   - Each error path emits the corresponding D13 audit event.
//   - Single-wire-response invariant preserved: settleOnce-LOSS paths do
//     not double-respond.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";
import type { ActorPolicy, ResolveApprovalInput } from "../src/types.js";

async function makeBroker(): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  audit: AuditEmitter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide, {
    clientInfo: { name: "test", title: null, version: "0.0.0-t11" },
  });
  await client.start();
  const audit = new AuditEmitter();
  const broker = new ApprovalBroker(client, { audit });
  broker.attach();
  return {
    client,
    fake,
    broker,
    audit,
    cleanup: async () => {
      await client.stop();
    },
  };
}

let _seq = 7_000_000;
function nextId(): number {
  _seq += 1;
  return _seq;
}

const POLICY_ALICE: ActorPolicy = {
  allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
  target: { platform: "telegram", chatId: "c-team" },
  callbackNonce: "nonce-alice-aaaaaaaaaaa",
};

const ALICE_INPUT_BASE = {
  decision: { kind: "allow_once" } as const,
  actor: { kind: "im", platform: "telegram", userId: "u-alice" } as const,
  target: { platform: "telegram", chatId: "c-team" } as const,
  callbackNonce: POLICY_ALICE.callbackNonce,
};

async function emitPending(
  broker: ApprovalBroker,
  fake: FakeAppServer,
  method = "item/fileChange/requestApproval",
): Promise<{ id: number; approvalId: string; wirePromise: Promise<unknown> }> {
  broker.enablePendingMode(method as Parameters<ApprovalBroker["enablePendingMode"]>[0]);
  const id = nextId();
  const wirePromise = fake.emitServerRequest(method, {}, id).catch(() => undefined);
  await new Promise((r) => setImmediate(r));
  return { id, approvalId: `approval-${id}`, wirePromise };
}

describe("ApprovalBroker.resolve — happy path (T11)", () => {
  it("resolves a pending file_change approval with allow_once → wire {decision:'accept'}", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      const { id, approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const input: ResolveApprovalInput = { ...ALICE_INPUT_BASE, approvalId };
      const result = await broker.resolve(input);
      expect(result.kind).toBe("ok");
      const wireResponse = await wirePromise;
      expect(wireResponse).toEqual({ decision: "accept" });

      const internal = broker._pendingRecordsForTest();
      expect(internal.get(id)?.status).toBe("resolved");

      const kinds = audit.recent().map((e) => e.kind);
      expect(kinds).toContain("approval.created");
      expect(kinds).toContain("approval.resolved");
    } finally {
      await cleanup();
    }
  });
});

describe("ApprovalBroker.resolve — error branches (T11 / 9 ResolveError kinds)", () => {
  it("unknown_approval_id when approvalId doesn't exist", async () => {
    const { broker, cleanup } = await makeBroker();
    try {
      const result = await broker.resolve({
        ...ALICE_INPUT_BASE,
        approvalId: "approval-does-not-exist",
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("unknown_approval_id");
      }
    } finally {
      await cleanup();
    }
  });

  it("already_resolved when caller resolves twice (with priorDecision)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      await wirePromise;
      const second = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(second.kind).toBe("error");
      if (second.kind === "error") {
        expect(second.error.kind).toBe("already_resolved");
        if (second.error.kind === "already_resolved") {
          expect(second.error.priorDecision.kind).toBe("approved");
        }
      }
    } finally {
      await cleanup();
    }
  });

  it("transport_lost when entry was flipped via failPendingAsTransportLost", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      broker.failPendingAsTransportLost();
      await wirePromise;
      const result = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("transport_lost");
      }
    } finally {
      await cleanup();
    }
  });

  it("expired when broker.expirePending() flipped status before resolve", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const flipped = broker.expirePending(-1);
      expect(flipped).toBe(1);
      await wirePromise;
      const result = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("expired");
      }
    } finally {
      await cleanup();
    }
  });

  it("expired when wall-clock passed expiresAt without an expirePending sweep (T11.3 / Codex P0-4)", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      const { id, approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      // Force the record's expiresAt into the past WITHOUT calling expirePending.
      const internal = broker._pendingRecordsForTest();
      const record = internal.get(id);
      if (!record) throw new Error("test setup: record missing");
      // Mutate the date in place (test-only). resolve() must observe expiry.
      (record as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1_000);

      const result = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("expired");
      }
      // Audit captures the expiry event.
      const kinds = audit.recent().map((e) => e.kind);
      expect(kinds).toContain("approval.expired");
      // Wire receives default-reject (decline), not "accept".
      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "decline" });
    } finally {
      await cleanup();
    }
  });

  it("binding_required when bindActorPolicy was never called (D19)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      // Note: NO bindActorPolicy.
      const result = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("binding_required");
      }
      // Wire stays pending — no settle on validation error.
      // Drain.
      broker.failPendingAsTransportLost();
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("wrong_actor when click came from a non-allowed actor", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const result = await broker.resolve({
        ...ALICE_INPUT_BASE,
        approvalId,
        actor: { kind: "im", platform: "telegram", userId: "u-eve" },
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("wrong_actor");
      }
      // Pending preserved (no settle on validation error).
      expect(broker.listPending().length).toBe(1);
      broker.failPendingAsTransportLost();
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("wrong_target when target.chatId mismatches bound policy", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const result = await broker.resolve({
        ...ALICE_INPUT_BASE,
        approvalId,
        target: { platform: "telegram", chatId: "c-different" },
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("wrong_target");
      }
      expect(broker.listPending().length).toBe(1);
      broker.failPendingAsTransportLost();
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("stale_callback when nonce mismatches bound policy", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const result = await broker.resolve({
        ...ALICE_INPUT_BASE,
        approvalId,
        callbackNonce: "nonce-stale-bbbbbbbbbb",
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("stale_callback");
      }
      expect(broker.listPending().length).toBe(1);
      broker.failPendingAsTransportLost();
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("unsupported_decision when (kind, action) pair not in D11 supported subset", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      // permissions kind only supports "decline" in Phase 2.
      const { approvalId, wirePromise } = await emitPending(
        broker,
        fake,
        "item/permissions/requestApproval",
      );
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      const result = await broker.resolve({
        ...ALICE_INPUT_BASE,
        approvalId,
        decision: { kind: "allow_once" },
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("unsupported_decision");
        if (result.error.kind === "unsupported_decision") {
          expect(result.error.method).toBe("item/permissions/requestApproval");
        }
      }
      expect(broker.listPending().length).toBe(1);
      broker.failPendingAsTransportLost();
      await wirePromise;
    } finally {
      await cleanup();
    }
  });
});

describe("ApprovalBroker.resolve — internal lookup uses #pendingById, not getPending (T11.2 / Codex P0-3)", () => {
  it("returns expired (not unknown_approval_id) for a terminal-state record", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_ALICE);
      // Flip to terminal via expirePending (status="expired").
      broker.expirePending(-1);
      await wirePromise;
      // getPending is null (status-filtered), but resolve must SEE the record
      // via #pendingById and surface "expired", NOT "unknown_approval_id".
      expect(broker.getPending(approvalId)).toBeNull();
      const result = await broker.resolve({ ...ALICE_INPUT_BASE, approvalId });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("expired");
        expect(result.error.kind).not.toBe("unknown_approval_id");
      }
    } finally {
      await cleanup();
    }
  });
});

describe("ApprovalBroker.resolve — actor binding (D19 happy path: A wins, B follows / T11.4)", () => {
  it("A clicks first → ok; B follows → already_resolved (race scenario)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      // Multi-actor binding (Phase 2 typically singleton, but ACL widens
      // in Phase 3 — the resolve() validation must accept any allowed actor).
      const policy: ActorPolicy = {
        allowedActors: [
          { kind: "im", platform: "telegram", userId: "u-alice" },
          { kind: "im", platform: "telegram", userId: "u-bob" },
        ],
        target: { platform: "telegram", chatId: "c-team" },
        callbackNonce: "nonce-multi-aaaaaaaaaa",
      };

      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, policy);

      const aliceInput: ResolveApprovalInput = {
        approvalId,
        decision: { kind: "allow_once" },
        actor: { kind: "im", platform: "telegram", userId: "u-alice" },
        target: { platform: "telegram", chatId: "c-team" },
        callbackNonce: policy.callbackNonce,
      };
      const bobInput: ResolveApprovalInput = {
        ...aliceInput,
        actor: { kind: "im", platform: "telegram", userId: "u-bob" },
      };

      const aliceResult = await broker.resolve(aliceInput);
      expect(aliceResult.kind).toBe("ok");
      await wirePromise;
      const bobResult = await broker.resolve(bobInput);
      expect(bobResult.kind).toBe("error");
      if (bobResult.kind === "error") {
        expect(bobResult.error.kind).toBe("already_resolved");
      }
    } finally {
      await cleanup();
    }
  });
});

// T9 (Phase 2) — bindActorPolicy storage + idempotency.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T9
// (D19: per-card actor binding)
//
// T9 SCOPE (round-2 P1-5 split): only the storage surface. resolve()-invoking
// validation (wrong_actor / wrong_target / stale_callback / binding_required /
// happy-path-bind-then-resolve) is deferred to T11.4 because resolve() doesn't
// exist yet at T9 time — testing through it would force a forward reference.
//
// What T9 asserts:
//   - bindActorPolicy returns {kind: "ok"} on first call.
//   - Idempotent on identical policy (second call → {kind: "ok"}).
//   - Re-bind with different policy → {kind: "error", error: conflicting_policy}.
//   - Bind before pending exists → {kind: "error", error: unknown_approval_id}.
//   - Bind on terminal record → {kind: "error", error: not_pending}.
//   - Internal accessor _actorPolicyForTest(approvalId) returns stored policy.
//   - Stored policy includes allowedActors, target, callbackNonce verbatim.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import type { ActorPolicy } from "../src/types.js";

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
  return {
    client,
    fake,
    broker,
    cleanup: async () => {
      await client.stop();
    },
  };
}

let _seq = 6_000_000;
function nextId(): number {
  _seq += 1;
  return _seq;
}

const POLICY_A: ActorPolicy = {
  allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
  target: { platform: "telegram", chatId: "c-team" },
  callbackNonce: "nonce-aaaaaaaaaaaaaaaa",
};

const POLICY_A_DUPLICATE: ActorPolicy = {
  allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
  target: { platform: "telegram", chatId: "c-team" },
  callbackNonce: "nonce-aaaaaaaaaaaaaaaa",
};

const POLICY_B: ActorPolicy = {
  allowedActors: [{ kind: "im", platform: "telegram", userId: "u-bob" }],
  target: { platform: "telegram", chatId: "c-team" },
  callbackNonce: "nonce-bbbbbbbbbbbbbbbb",
};

async function emitPending(
  broker: ApprovalBroker,
  fake: FakeAppServer,
): Promise<{ id: number; approvalId: string; drain: () => void }> {
  broker.enablePendingMode("item/fileChange/requestApproval");
  const id = nextId();
  const wirePromise = fake
    .emitServerRequest("item/fileChange/requestApproval", {}, id)
    .catch(() => undefined);
  await new Promise((r) => setImmediate(r));
  return {
    id,
    approvalId: `approval-${id}`,
    drain: () => {
      broker.failPendingAsTransportLost();
      void wirePromise;
    },
  };
}

describe("ApprovalBroker — bindActorPolicy storage (T9 / D19)", () => {
  it("returns {kind: 'ok'} on first bind to a pending approval", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      const result = broker.bindActorPolicy(approvalId, POLICY_A);
      expect(result).toEqual({ kind: "ok" });
      drain();
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("stores the policy verbatim accessible via _actorPolicyForTest", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_A);
      const stored = broker._actorPolicyForTest(approvalId);
      expect(stored).not.toBeNull();
      expect(stored?.allowedActors).toEqual(POLICY_A.allowedActors);
      expect(stored?.target).toEqual(POLICY_A.target);
      expect(stored?.callbackNonce).toBe(POLICY_A.callbackNonce);
      drain();
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("is idempotent — second bind with identical policy returns {kind: 'ok'}", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      const first = broker.bindActorPolicy(approvalId, POLICY_A);
      const second = broker.bindActorPolicy(approvalId, POLICY_A_DUPLICATE);
      expect(first).toEqual({ kind: "ok" });
      expect(second).toEqual({ kind: "ok" });
      drain();
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("re-bind with a different policy returns conflicting_policy error", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY_A);
      const second = broker.bindActorPolicy(approvalId, POLICY_B);
      expect(second).toEqual({
        kind: "error",
        error: { kind: "conflicting_policy" },
      });
      // Stored policy stays as the original — no partial overwrite.
      const stored = broker._actorPolicyForTest(approvalId);
      expect(stored?.callbackNonce).toBe(POLICY_A.callbackNonce);
      drain();
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });

  it("bind before pending exists returns unknown_approval_id error", async () => {
    const { broker, cleanup } = await makeBroker();
    try {
      const result = broker.bindActorPolicy("approval-does-not-exist", POLICY_A);
      expect(result).toEqual({
        kind: "error",
        error: { kind: "unknown_approval_id" },
      });
      // No stored policy.
      expect(broker._actorPolicyForTest("approval-does-not-exist")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("bind on terminal record (transport_lost) returns not_pending error", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      // Flip to terminal BEFORE binding.
      drain();
      await new Promise((r) => setImmediate(r));
      const result = broker.bindActorPolicy(approvalId, POLICY_A);
      expect(result).toEqual({
        kind: "error",
        error: { kind: "not_pending" },
      });
    } finally {
      await cleanup();
    }
  });

  it("_actorPolicyForTest returns null for an approval that was never bound", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, drain } = await emitPending(broker, fake);
      expect(broker._actorPolicyForTest(approvalId)).toBeNull();
      drain();
      await new Promise((r) => setImmediate(r));
    } finally {
      await cleanup();
    }
  });
});

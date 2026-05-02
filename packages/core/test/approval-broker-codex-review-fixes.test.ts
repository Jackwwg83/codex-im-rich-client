// T7-T12 Codex outside-voice review fixes — regression tests.
//
// Pins the five fixes applied in response to the post-T12 Codex review
// (verdict was NO_GO before these landed):
//   P0   defensive copy in #toSnapshot — snap.expiresAt mutation must
//        NOT change broker-internal expiresAt, so D20 in-resolve expiry
//        stays load-bearing.
//   P1.1 #handle emits approval.unsupported_method before throwing -32601.
//   P1.2 terminal resolve() branches emit approval.duplicate_attempt.
//   P1.3 policiesEqual is key-order-insensitive.
//   P2   approvalTtlMs constructor option + validation.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";
import type { ActorPolicy, ApprovalActor, Target } from "../src/types.js";

async function makeBroker(opts?: {
  audit?: AuditEmitter;
  approvalTtlMs?: number;
}): Promise<{
  client: AppServerClient;
  fake: FakeAppServer;
  broker: ApprovalBroker;
  audit: AuditEmitter;
  cleanup: () => Promise<void>;
}> {
  const fake = new FakeAppServer();
  const client = new AppServerClientCtor(fake.clientSide);
  await client.start();
  const audit = opts?.audit ?? new AuditEmitter();
  const broker = new ApprovalBroker(client, {
    audit,
    ...(opts?.approvalTtlMs !== undefined && { approvalTtlMs: opts.approvalTtlMs }),
  });
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

let _seq = 9_000_000;
function nextId(): number {
  _seq += 1;
  return _seq;
}

const POLICY: ActorPolicy = {
  allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
  target: { platform: "telegram", chatId: "c-team" },
  callbackNonce: "nonce-codex-review-aaaaa",
};

async function emitPending(
  broker: ApprovalBroker,
  fake: FakeAppServer,
): Promise<{ id: number; approvalId: string; wirePromise: Promise<unknown> }> {
  broker.enablePendingMode("item/fileChange/requestApproval");
  const id = nextId();
  const wirePromise = fake
    .emitServerRequest("item/fileChange/requestApproval", { synthetic: true }, id)
    .catch(() => undefined);
  await new Promise((r) => setImmediate(r));
  return { id, approvalId: `approval-${id}`, wirePromise };
}

// ─── P0 — snapshot defensive copy ─────────────────────────────────────────

describe("Codex P0 — #toSnapshot defensive copy (snap.expiresAt cannot subvert D20)", () => {
  it("snap.expiresAt is a different Date instance than the broker-internal record", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { id, wirePromise } = await emitPending(broker, fake);
      const list = broker.listPending();
      expect(list.length).toBe(1);
      const snap = list[0];
      expect(snap).toBeDefined();
      const internal = broker._pendingRecordsForTest();
      const internalRecord = internal.get(id);
      expect(internalRecord).toBeDefined();
      // Different Date OBJECTS (=== false) so caller mutations don't reach broker.
      expect(snap?.expiresAt).not.toBe(internalRecord?.expiresAt);
      expect(snap?.createdAt).not.toBe(internalRecord?.createdAt);
      // Same MOMENT (.getTime() equal) so they semantically match.
      expect(snap?.expiresAt.getTime()).toBe(internalRecord?.expiresAt.getTime());
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("mutating snap.expiresAt via setTime does NOT change record.expiresAt (the D20 expiry guard)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { id, wirePromise } = await emitPending(broker, fake);
      const snap = broker.listPending()[0];
      expect(snap).toBeDefined();
      const originalRecordExpiry = broker._pendingRecordsForTest().get(id)?.expiresAt.getTime();
      // Caller-side mutation attempt (the prior bug allowed this to subvert
      // resolve()-time expiry by reaching INTO broker state via shared ref).
      snap?.expiresAt.setTime(0);
      const afterRecordExpiry = broker._pendingRecordsForTest().get(id)?.expiresAt.getTime();
      expect(afterRecordExpiry).toBe(originalRecordExpiry);
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("snap.params is a structured-clone — mutating snap.params doesn't change record.params", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { id, wirePromise } = await emitPending(broker, fake);
      const snap = broker.listPending()[0];
      expect(snap).toBeDefined();
      // params is structuredClone'd so the shared object reference is severed.
      const internalParams = broker._pendingRecordsForTest().get(id)?.params;
      expect(snap?.params).not.toBe(internalParams);
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });
});

// ─── P1.1 — unsupported method audit ──────────────────────────────────────

describe("Codex P1.1 — #handle emits approval.unsupported_method on unknown method", () => {
  it("emits approval.unsupported_method before throwing -32601", async () => {
    const audit = new AuditEmitter();
    const { fake, cleanup } = await makeBroker({ audit });
    try {
      // Unknown method → broker throws -32601 → fake-side rejects, but the
      // important assertion is the audit emit.
      await fake.emitServerRequest("future/unseen/method", {}, nextId()).catch(() => undefined);
      const kinds = audit.recent().map((e) => e.kind);
      expect(kinds).toContain("approval.unsupported_method");
      const event = audit.recent({ kind: "approval.unsupported_method" })[0];
      expect(event?.metadata?.method).toBe("future/unseen/method");
    } finally {
      await cleanup();
    }
  });
});

// ─── P1.2 — terminal-resolve duplicate_attempt audit ──────────────────────

describe("Codex P1.2 — terminal resolve() branches emit approval.duplicate_attempt", () => {
  const ALICE_INPUT = {
    decision: { kind: "allow_once" } as const,
    actor: {
      kind: "im",
      platform: "telegram",
      userId: "u-alice",
    } as const satisfies NonNullable<ApprovalActor>,
    target: { platform: "telegram", chatId: "c-team" } satisfies Target,
    callbackNonce: POLICY.callbackNonce,
  };

  it("already_resolved branch emits approval.duplicate_attempt", async () => {
    const audit = new AuditEmitter();
    const { broker, fake, cleanup } = await makeBroker({ audit });
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY);
      await broker.resolve({ ...ALICE_INPUT, approvalId });
      await wirePromise;
      const beforeCount = audit.recent({ kind: "approval.duplicate_attempt" }).length;
      const second = await broker.resolve({ ...ALICE_INPUT, approvalId });
      expect(second.kind).toBe("error");
      const after = audit.recent({ kind: "approval.duplicate_attempt" });
      expect(after.length).toBe(beforeCount + 1);
      expect(after[after.length - 1]?.metadata?.attemptedKind).toBe("approval.resolved");
      expect(after[after.length - 1]?.metadata?.terminalStatus).toBe("resolved");
    } finally {
      await cleanup();
    }
  });

  it("expired branch emits approval.duplicate_attempt", async () => {
    const audit = new AuditEmitter();
    const { broker, fake, cleanup } = await makeBroker({ audit });
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY);
      broker.expirePending(-1);
      await wirePromise;
      const before = audit.recent({ kind: "approval.duplicate_attempt" }).length;
      const result = await broker.resolve({ ...ALICE_INPUT, approvalId });
      expect(result.kind).toBe("error");
      const after = audit.recent({ kind: "approval.duplicate_attempt" });
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1]?.metadata?.attemptedKind).toBe("approval.expired");
    } finally {
      await cleanup();
    }
  });

  it("transport_lost branch emits approval.duplicate_attempt", async () => {
    const audit = new AuditEmitter();
    const { broker, fake, cleanup } = await makeBroker({ audit });
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      broker.bindActorPolicy(approvalId, POLICY);
      broker.failPendingAsTransportLost();
      await wirePromise;
      const before = audit.recent({ kind: "approval.duplicate_attempt" }).length;
      const result = await broker.resolve({ ...ALICE_INPUT, approvalId });
      expect(result.kind).toBe("error");
      const after = audit.recent({ kind: "approval.duplicate_attempt" });
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1]?.metadata?.attemptedKind).toBe("approval.transport_lost");
    } finally {
      await cleanup();
    }
  });
});

// ─── P1.3 — policiesEqual key-order insensitive ───────────────────────────

describe("Codex P1.3 — bindActorPolicy idempotency is key-order-insensitive", () => {
  it("rebind with policy whose target keys are in different insertion order returns ok (not conflicting_policy)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      // Build target with a different field-insertion order on purpose.
      const target1: Target = { platform: "telegram", chatId: "c-team", topicId: "t-1" };
      const target2: Target = { topicId: "t-1", chatId: "c-team", platform: "telegram" };
      const policy1: ActorPolicy = { ...POLICY, target: target1 };
      const policy2: ActorPolicy = { ...POLICY, target: target2 };
      const first = broker.bindActorPolicy(approvalId, policy1);
      const second = broker.bindActorPolicy(approvalId, policy2);
      expect(first).toEqual({ kind: "ok" });
      expect(second).toEqual({ kind: "ok" });
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("rebind with actor in different field order still equal", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { approvalId, wirePromise } = await emitPending(broker, fake);
      const policy1: ActorPolicy = {
        ...POLICY,
        allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
      };
      const policy2: ActorPolicy = {
        ...POLICY,
        // Different key order on the actor object.
        allowedActors: [{ userId: "u-alice", platform: "telegram", kind: "im" }],
      };
      expect(broker.bindActorPolicy(approvalId, policy1)).toEqual({ kind: "ok" });
      expect(broker.bindActorPolicy(approvalId, policy2)).toEqual({ kind: "ok" });
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });
});

// ─── P2 — approvalTtlMs constructor option ────────────────────────────────

describe("Codex P2 — approvalTtlMs constructor option (D20 honored)", () => {
  it("uses constructor-provided ttl when set", async () => {
    const { broker, fake, cleanup } = await makeBroker({ approvalTtlMs: 60_000 });
    try {
      const { id, wirePromise } = await emitPending(broker, fake);
      const record = broker._pendingRecordsForTest().get(id);
      expect(record).toBeDefined();
      const ttl = (record?.expiresAt.getTime() ?? 0) - (record?.createdAt.getTime() ?? 0);
      expect(ttl).toBe(60_000);
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("defaults to 30 minutes when no option provided", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const { id, wirePromise } = await emitPending(broker, fake);
      const record = broker._pendingRecordsForTest().get(id);
      const ttl = (record?.expiresAt.getTime() ?? 0) - (record?.createdAt.getTime() ?? 0);
      expect(ttl).toBe(30 * 60 * 1000);
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("rejects non-positive / non-finite ttl at construction time", async () => {
    const fake = new FakeAppServer();
    const client = new AppServerClientCtor(fake.clientSide);
    await client.start();
    expect(() => new ApprovalBroker(client, { approvalTtlMs: 0 })).toThrow(/positive/);
    expect(() => new ApprovalBroker(client, { approvalTtlMs: -1 })).toThrow(/positive/);
    expect(() => new ApprovalBroker(client, { approvalTtlMs: Number.NaN })).toThrow(/positive/);
    expect(() => new ApprovalBroker(client, { approvalTtlMs: Number.POSITIVE_INFINITY })).toThrow(
      /positive/,
    );
    await client.stop();
  });
});

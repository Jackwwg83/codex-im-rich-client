// T8 (Phase 2) — broker pending-mode bootstrap tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T8
// (D18: enablePendingMode<M>(method))
//
// IM-driven flow: enablePendingMode marks a method as "settle externally". When
// codex emits a server-request for that method, the broker creates a
// PendingEntry but does NOT run a handler IIFE. The completion stays open
// until external resolve() / expirePending() / failPendingAsTransportLost
// settles it. The wire-response is whatever the winning settler put on the
// completion — exactly the same single-wire-response invariant that handler-
// mode preserves (B-clean).
//
// Compared to T7 (which uses a registered never-resolving handler to keep an
// entry pending), T8 proves the broker reaches the same pending state via the
// pending-mode dispatch arm — no IIFE, no handler invocation. T11 will exercise
// the resolve() side; T8 only proves the bootstrap lands.
//
// Also asserts the Phase 1 invariant: a method NOT in pending-mode (and with
// no handler) still default-rejects synchronously. T8 cannot regress that.

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
  const client = new AppServerClientCtor(fake.clientSide, {
    clientInfo: { name: "test", title: null, version: "0.0.0-t8" },
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

let _seq = 5_000_000;
function nextId(): number {
  _seq += 1;
  return _seq;
}

describe("ApprovalBroker — enablePendingMode (T8 / D18)", () => {
  it("creates a PendingEntry without running a handler when method is in pending-mode", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      broker.enablePendingMode("item/fileChange/requestApproval");

      const id = nextId();
      // Don't await — pending-mode never settles without external resolve.
      const wirePromise = fake
        .emitServerRequest("item/fileChange/requestApproval", { synthetic: true }, id)
        .catch(() => undefined);
      // Yield once so #handle's microtask registers the entry.
      await new Promise((r) => setImmediate(r));

      // Entry visible on the public surface.
      const list = broker.listPending();
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe(`approval-${id}`);
      expect(broker.getPending(`approval-${id}`)).not.toBeNull();

      // No wire response yet — pending-mode awaits external settle.
      // We can't assert "wirePromise still pending" cleanly without a race,
      // but we can assert no audit "approval.resolved" event has fired.
      const kinds = audit.recent().map((e) => e.kind);
      expect(kinds).toContain("approval.created");
      expect(kinds).not.toContain("approval.resolved");

      // Drain by forcing transport-loss so cleanup resolves the wire.
      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("emits onPendingCreated exactly once for pending-mode bootstrap", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      const created = vi.fn();
      broker.onPendingCreated(created);
      broker.enablePendingMode("item/fileChange/requestApproval");

      const id = nextId();
      const wirePromise = fake
        .emitServerRequest("item/fileChange/requestApproval", {}, id)
        .catch(() => undefined);
      await new Promise((r) => setImmediate(r));

      expect(created).toHaveBeenCalledTimes(1);
      const snap = created.mock.calls[0]?.[0];
      expect(snap?.id).toBe(`approval-${id}`);

      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("default-rejects when method is NOT in pending-mode (Phase 1 invariant preserved)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      // No enablePendingMode call, no handler. Phase 1 path must still fire.
      const id = nextId();
      const wireResponse = await fake.emitServerRequest("item/fileChange/requestApproval", {}, id);
      // Default-reject for fileChange = { decision: "decline" }.
      expect(wireResponse).toEqual({ decision: "decline" });
      // No PendingEntry was created — listPending is empty.
      expect(broker.listPending()).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("disablePendingMode reverts to default-reject", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      broker.enablePendingMode("item/fileChange/requestApproval");
      broker.disablePendingMode("item/fileChange/requestApproval");

      const id = nextId();
      const wireResponse = await fake.emitServerRequest("item/fileChange/requestApproval", {}, id);
      expect(wireResponse).toEqual({ decision: "decline" });
      expect(broker.listPending()).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("enablePendingMode is idempotent (calling twice is fine)", async () => {
    const { broker, fake, cleanup } = await makeBroker();
    try {
      broker.enablePendingMode("item/fileChange/requestApproval");
      broker.enablePendingMode("item/fileChange/requestApproval");
      const id = nextId();
      const wirePromise = fake
        .emitServerRequest("item/fileChange/requestApproval", {}, id)
        .catch(() => undefined);
      await new Promise((r) => setImmediate(r));
      expect(broker.listPending().length).toBe(1);

      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;
    } finally {
      await cleanup();
    }
  });

  it("pending-mode entries flip to transport_lost on failPendingAsTransportLost", async () => {
    const { broker, fake, audit, cleanup } = await makeBroker();
    try {
      broker.enablePendingMode("item/fileChange/requestApproval");
      const id = nextId();
      const wirePromise = fake
        .emitServerRequest("item/fileChange/requestApproval", {}, id)
        .catch(() => undefined);
      await new Promise((r) => setImmediate(r));

      broker.failPendingAsTransportLost();
      await new Promise((r) => setImmediate(r));
      await wirePromise;

      // Internal store retains terminal record (D6 invariant).
      const internal = broker._pendingRecordsForTest();
      expect(internal.get(id)?.status).toBe("transport_lost");

      const kinds = audit.recent().map((e) => e.kind);
      expect(kinds).toContain("approval.created");
      expect(kinds).toContain("approval.transport_lost");
    } finally {
      await cleanup();
    }
  });
});

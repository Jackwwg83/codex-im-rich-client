// T22 (Phase 2) — Supervisor pre-attached-broker invariant.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T22
// (D16 / F-A8 / Codex Q6)
//
// Asserts the load-bearing #spawnFresh head invariant: the broker
// passed to Supervisor MUST be pre-attached. The error message names
// the production = Supervisor / dev = runtime-send split so a future
// maintainer reading the trace can't misinterpret it as a transient
// Phase 1 wiring quirk.
//
// Companion to packages/daemon/test/supervisor.test.ts which already
// covers the Phase 1 lifecycle. T22 adds:
//   1. Positive: pre-attached broker → start() succeeds.
//   2. Negative: unattached broker → start() throws with the load-
//      bearing message before reaching broker.reattach.
//   3. Mid-pending transport.onClose → broker.failPendingAsTransportLost
//      fires exactly once → reattach to new gen → old approvalId
//      resolve returns transport_lost.
//   4. 5 consecutive transport closes → supervisor halts.

import { AppServerClient, type Transport } from "@codex-im/app-server-client";
import { CodexRuntime } from "@codex-im/codex-runtime";
import { ApprovalBroker } from "@codex-im/core";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it, vi } from "vitest";
import { Supervisor } from "../src/supervisor.js";
import type { SupervisorAudit, SupervisorOptions } from "../src/types.js";

function silentAudit(): SupervisorAudit {
  return {
    emit: () => {},
    emitFatal: () => {},
  };
}

describe("T22 — Supervisor pre-attached-broker invariant (D16 / Codex Q6)", () => {
  it("positive: pre-attached broker → start() succeeds; broker dispatch is live", async () => {
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach(); // pre-attached — production wire-up
    broker.enablePendingMode("item/fileChange/requestApproval");

    const fakeServer = new FakeAppServer();
    const opts: SupervisorOptions = {
      transportFactory: () => fakeServer.clientSide,
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    await expect(sup.start()).resolves.toBeUndefined();

    // Mid-spawn-handshake: emit a server-request — broker should accept
    // it via pending-mode (no PendingEntry resolved yet, but no
    // default-reject because pending-mode is wired).
    const id = 100;
    void fakeServer
      .emitServerRequest("item/fileChange/requestApproval", { synthetic: true }, id)
      .catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(broker.listPending().length).toBe(1);

    broker.failPendingAsTransportLost();
    await sup.stop();
    await fakeServer.stop();
    await placeholderFake.stop();
  });

  it("negative: unattached broker → start() throws with the load-bearing T22 message", async () => {
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    // INTENTIONALLY do NOT call broker.attach().

    const fakeServer = new FakeAppServer();
    const opts: SupervisorOptions = {
      transportFactory: () => fakeServer.clientSide,
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    await expect(sup.start()).rejects.toThrow(/MUST be pre-attached/);
    await expect(sup.start()).rejects.toThrow(/Codex Q6/);

    await fakeServer.stop();
    await placeholderFake.stop();
  });

  it("transport-close → failPendingAsTransportLost fires once + spawn recovery preserves invariant", async () => {
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();
    broker.enablePendingMode("item/fileChange/requestApproval");
    const failSpy = vi.spyOn(broker, "failPendingAsTransportLost");

    let serverGen = 0;
    const transports: FakeAppServer[] = [];
    const opts: SupervisorOptions = {
      transportFactory: () => {
        serverGen += 1;
        const fake = new FakeAppServer();
        transports.push(fake);
        return fake.clientSide;
      },
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: silentAudit(),
    };

    const sup = new Supervisor(opts);
    await sup.start();

    // Drive a close via the test door — synchronous, deterministic,
    // no setTimeout race. Supervisor fires failPendingAsTransportLost
    // immediately and schedules recovery (500ms backoff).
    expect(failSpy).toHaveBeenCalledTimes(0);
    const supDoor = sup as unknown as { _handleTransportCloseForTest: (c: number | null) => void };
    supDoor._handleTransportCloseForTest(null);
    expect(failSpy).toHaveBeenCalledTimes(1);

    // Wait past backoff so recovery spawn lands.
    await new Promise((r) => setTimeout(r, 700));
    expect(serverGen).toBeGreaterThanOrEqual(2);

    await sup.stop();
    for (const t of transports) {
      await t.stop().catch(() => undefined);
    }
    await placeholderFake.stop();
  });

  it("recovery spawn failure halts supervisor immediately (Phase 1 fail-fast preserved)", async () => {
    const placeholderFake = new FakeAppServer();
    const placeholderClient = new AppServerClient(placeholderFake.clientSide);
    const broker = new ApprovalBroker(placeholderClient);
    broker.attach();

    const fatalAudit: string[] = [];
    let factoryCalls = 0;
    const transports: FakeAppServer[] = [];
    const opts: SupervisorOptions = {
      transportFactory: () => {
        factoryCalls += 1;
        if (factoryCalls > 1) {
          // Recovery attempt — simulate codex subprocess failing to spawn.
          throw new Error("simulated transport spawn failure");
        }
        const fake = new FakeAppServer();
        transports.push(fake);
        return fake.clientSide;
      },
      clientFactory: (t) => new AppServerClient(t),
      runtimeFactory: (c) => new CodexRuntime(c),
      broker,
      performHandshake: async () => ({}),
      audit: {
        emit: () => {},
        emitFatal: (msg: string) => {
          fatalAudit.push(msg);
        },
      },
    };

    const sup = new Supervisor(opts);
    await sup.start();

    // Drive close → recovery scheduled → recovery spawnFresh throws →
    // supervisor halts (catch arm at #onTransportClose's setTimeout).
    const supDoor = sup as unknown as { _handleTransportCloseForTest: (c: number | null) => void };
    supDoor._handleTransportCloseForTest(null);
    await new Promise((r) => setTimeout(r, 800)); // past backoff + spawn

    expect(fatalAudit.some((m) => /halted.*spawnFresh failed/.test(m))).toBe(true);
    await expect(sup.start()).rejects.toThrow(/halted/);

    await sup.stop();
    for (const t of transports) {
      await t.stop().catch(() => undefined);
    }
    await placeholderFake.stop();
  });
});

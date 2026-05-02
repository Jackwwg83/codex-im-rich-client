// T12 (Phase 2) — broker fake e2e happy path.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T12
//
// Wires every Phase 2 broker piece end-to-end with FakeAppServer +
// AppServerClient + ApprovalBroker. No protocol mocking; no shape stubs;
// the test exercises:
//   1. attach()                                                — broker installed (T7-baseline)
//   2. enablePendingMode("item/commandExecution/requestApproval") — pending-mode dispatch (T8)
//   3. fake.emitServerRequest(...)                              — wire arrives, PendingEntry created
//   4. onPendingCreated subscriber observes the snapshot         — emitter wiring (T7)
//   5. broker.bindActorPolicy(approvalId, policy)                — per-card binding (T9)
//   6. broker.resolve({ allow_once, alice, target, nonce })      — D11 mapper + D19 validation (T10/T11)
//   7. wire response = {decision: "accept"}                      — T11 wire-mapping correctness
//   8. audit ring contains approval.created + approval.resolved  — T7 / T11 emit sites
//
// If any wire is loose between T2-T11, this test fails. Conversely, if it
// passes the full pipeline composes and Phase 2 P2.10 minimum bar is met.

import {
  type AppServerClient,
  AppServerClient as AppServerClientCtor,
} from "@codex-im/app-server-client";
import { FakeAppServer } from "@codex-im/testkit";
import { describe, expect, it, vi } from "vitest";
import { ApprovalBroker } from "../src/approval-broker.js";
import { AuditEmitter } from "../src/audit.js";
import type { ActorPolicy } from "../src/types.js";

describe("ApprovalBroker fake e2e happy path (T12 / proves T2-T11 wired)", () => {
  it("attach → enablePendingMode → emit → bind → resolve(allow_once) → wire accept", async () => {
    const fake = new FakeAppServer();
    const client: AppServerClient = new AppServerClientCtor(fake.clientSide);
    await client.start();
    const audit = new AuditEmitter();
    const broker = new ApprovalBroker(client, { audit });
    broker.attach();

    const created = vi.fn();
    broker.onPendingCreated(created);

    broker.enablePendingMode("item/commandExecution/requestApproval");

    // Codex emits a server-request for approval. wirePromise resolves once
    // resolve() lands the wire response.
    const wireId = 88_001;
    const wirePromise = fake.emitServerRequest(
      "item/commandExecution/requestApproval",
      { commandLineExpanded: "ls -la", cwd: "/tmp" },
      wireId,
    );

    // Yield once so #handle's microtask plants the entry + fires
    // onPendingCreated.
    await new Promise((r) => setImmediate(r));

    expect(created).toHaveBeenCalledTimes(1);
    const snap = created.mock.calls[0]?.[0];
    expect(snap?.id).toBe(`approval-${wireId}`);

    const approvalId = `approval-${wireId}`;
    const policy: ActorPolicy = {
      allowedActors: [{ kind: "im", platform: "telegram", userId: "u-alice" }],
      target: { platform: "telegram", chatId: "c-team" },
      callbackNonce: "nonce-e2e-aaaaaaaaaaaa",
    };
    const bindResult = broker.bindActorPolicy(approvalId, policy);
    expect(bindResult).toEqual({ kind: "ok" });

    const resolveResult = await broker.resolve({
      approvalId,
      decision: { kind: "allow_once" },
      actor: { kind: "im", platform: "telegram", userId: "u-alice" },
      target: { platform: "telegram", chatId: "c-team" },
      callbackNonce: policy.callbackNonce,
    });
    expect(resolveResult.kind).toBe("ok");

    const wireResponse = await wirePromise;
    expect(wireResponse).toEqual({ decision: "accept" });

    const kinds = audit.recent().map((e) => e.kind);
    expect(kinds).toContain("approval.created");
    expect(kinds).toContain("approval.resolved");
    // Order: created BEFORE resolved.
    expect(kinds.indexOf("approval.created")).toBeLessThan(kinds.indexOf("approval.resolved"));

    // Final state: record terminal-resolved, removed from listPending,
    // present in internal map for audit.
    expect(broker.listPending()).toEqual([]);
    expect(broker.getPending(approvalId)).toBeNull();
    const internal = broker._pendingRecordsForTest();
    expect(internal.get(wireId)?.status).toBe("resolved");

    await client.stop();
  });
});

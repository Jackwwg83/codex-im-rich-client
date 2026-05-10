import { describe, expect, it, vi } from "vitest";
import {
  type PruneStuckIssuedTracker,
  PruneSweep,
  type PruneSweepRepository,
} from "../src/prune-sweep.js";

const NOW = new Date("2026-05-10T00:00:00.000Z");

function makeTracker(): PruneStuckIssuedTracker {
  return {
    stuckIssuedApprovalIds: new Set(),
    transportLostStuckIssuedApprovalIds: new Set(),
  };
}

function makeRepository(overrides?: Partial<{ callbackTokenRepository: object; broker: object }>) {
  const callbackTokenRepository = overrides?.callbackTokenRepository ?? {
    pruneExpired: vi.fn(() => []),
    revokeStuckIssued: vi.fn(() => []),
  };
  const broker = overrides?.broker ?? {
    approvalRecordCount: vi.fn(() => 0),
    failPendingApprovalAsTransportLost: vi.fn(),
    expirePending: vi.fn(() => 0),
    pruneTerminalRecords: vi.fn(() => 0),
  };
  return { callbackTokenRepository, broker } as unknown as PruneSweepRepository;
}

describe("PruneSweep.schedule", () => {
  it("uses the injected schedulePrune function when provided", () => {
    const schedulePrune = vi.fn((_handler: () => void, _ms: number) => () => undefined);
    const sweep = new PruneSweep(makeRepository(), makeTracker(), vi.fn(), () => NOW, {
      pruneIntervalMs: 12_000,
      schedulePrune,
    });
    const unsub = sweep.schedule();
    expect(schedulePrune).toHaveBeenCalledTimes(1);
    expect(schedulePrune.mock.calls[0]?.[1]).toBe(12_000);
    expect(typeof unsub).toBe("function");
  });

  it("falls back to setInterval when no schedulePrune is configured", () => {
    const sweep = new PruneSweep(makeRepository(), makeTracker(), vi.fn(), () => NOW);
    const unsub = sweep.schedule();
    expect(typeof unsub).toBe("function");
    unsub?.();
  });
});

describe("PruneSweep.maybeTriggerEager", () => {
  it("runs a sweep when terminalRecordMaxCount is 0 (treated as 'always sweep')", () => {
    const broker = { approvalRecordCount: vi.fn(() => 0), expirePending: vi.fn() } as object;
    const repo = makeRepository({ broker });
    const sweep = new PruneSweep(repo, makeTracker(), vi.fn(), () => NOW, {
      terminalRecordMaxCount: 0,
    });
    sweep.maybeTriggerEager();
    expect(
      (broker as { expirePending: ReturnType<typeof vi.fn> }).expirePending,
    ).toHaveBeenCalled();
  });

  it("runs when broker count >= 80% of terminalRecordMaxCount", () => {
    const broker = {
      approvalRecordCount: vi.fn(() => 800),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
    } as object;
    const sweep = new PruneSweep(makeRepository({ broker }), makeTracker(), vi.fn(), () => NOW, {
      terminalRecordMaxCount: 1_000,
    });
    sweep.maybeTriggerEager();
    expect(
      (broker as { expirePending: ReturnType<typeof vi.fn> }).expirePending,
    ).toHaveBeenCalled();
  });

  it("skips when broker count is below 80%", () => {
    const broker = {
      approvalRecordCount: vi.fn(() => 500),
      expirePending: vi.fn(),
      pruneTerminalRecords: vi.fn(),
    } as object;
    const sweep = new PruneSweep(makeRepository({ broker }), makeTracker(), vi.fn(), () => NOW, {
      terminalRecordMaxCount: 1_000,
    });
    sweep.maybeTriggerEager();
    expect(
      (broker as { expirePending: ReturnType<typeof vi.fn> }).expirePending,
    ).not.toHaveBeenCalled();
  });
});

describe("PruneSweep.run", () => {
  it("is reentrant-safe: a second call while in-flight is a no-op", () => {
    const expirePending = vi.fn(() => {
      // re-enter while still running
      sweep.run();
    });
    const broker = {
      approvalRecordCount: vi.fn(),
      failPendingApprovalAsTransportLost: vi.fn(),
      expirePending,
      pruneTerminalRecords: vi.fn(),
    } as object;
    const sweep: PruneSweep = new PruneSweep(
      makeRepository({ broker }),
      makeTracker(),
      vi.fn(),
      () => NOW,
    );
    sweep.run();
    expect(expirePending).toHaveBeenCalledTimes(1);
  });

  it("calls callbackTokenRepository.pruneExpired with the clock-derived ISO timestamp", () => {
    const pruneExpired = vi.fn(() => []);
    const repo = makeRepository({
      callbackTokenRepository: { pruneExpired, revokeStuckIssued: vi.fn(() => []) },
    });
    const sweep = new PruneSweep(repo, makeTracker(), vi.fn(), () => NOW);
    sweep.run();
    expect(pruneExpired).toHaveBeenCalledWith(NOW.toISOString(), 100);
  });

  it("revokes stuck-issued IDs past the grace cutoff and flags them transport-lost on the broker", () => {
    const tracker = makeTracker();
    tracker.stuckIssuedApprovalIds.add("approval-1");
    tracker.stuckIssuedApprovalIds.add("approval-2");

    const revokeStuckIssued = vi.fn(() => [{ approvalId: "approval-1" } as { approvalId: string }]);
    const failTransportLost = vi.fn();
    const repo = makeRepository({
      callbackTokenRepository: { pruneExpired: vi.fn(() => []), revokeStuckIssued },
      broker: {
        approvalRecordCount: vi.fn(),
        failPendingApprovalAsTransportLost: failTransportLost,
        expirePending: vi.fn(),
        pruneTerminalRecords: vi.fn(),
      },
    });
    const sweep = new PruneSweep(repo, tracker, vi.fn(), () => NOW, {
      stuckIssuedGraceMs: 5_000,
    });
    sweep.run();

    const expectedCutoff = new Date(NOW.getTime() - 5_000).toISOString();
    expect(revokeStuckIssued).toHaveBeenCalledWith(
      expectedCutoff,
      ["approval-1", "approval-2"],
      100,
    );
    expect(failTransportLost).toHaveBeenCalledWith("approval-1");
    expect(tracker.transportLostStuckIssuedApprovalIds.has("approval-1")).toBe(true);
  });

  it("clears tracker entries when revoke returns nothing (all stuck IDs resolved)", () => {
    const tracker = makeTracker();
    tracker.stuckIssuedApprovalIds.add("a");
    tracker.transportLostStuckIssuedApprovalIds.add("a");

    const repo = makeRepository({
      callbackTokenRepository: {
        pruneExpired: vi.fn(() => []),
        revokeStuckIssued: vi.fn(() => []),
      },
    });
    const sweep = new PruneSweep(repo, tracker, vi.fn(), () => NOW);
    sweep.run();

    expect(tracker.stuckIssuedApprovalIds.size).toBe(0);
    expect(tracker.transportLostStuckIssuedApprovalIds.size).toBe(0);
  });

  it("invokes broker.expirePending and pruneTerminalRecords every sweep", () => {
    const expirePending = vi.fn();
    const pruneTerminalRecords = vi.fn();
    const repo = makeRepository({
      broker: {
        approvalRecordCount: vi.fn(),
        failPendingApprovalAsTransportLost: vi.fn(),
        expirePending,
        pruneTerminalRecords,
      },
    });
    const sweep = new PruneSweep(repo, makeTracker(), vi.fn(), () => NOW, {
      terminalRecordMaxAgeMs: 86_400_000,
      terminalRecordMaxCount: 5_000,
      pruneBatchSize: 250,
    });
    sweep.run();
    expect(expirePending).toHaveBeenCalledTimes(1);
    expect(pruneTerminalRecords).toHaveBeenCalledWith({
      maxAgeMs: 86_400_000,
      maxCount: 5_000,
      batchSize: 250,
      now: NOW,
    });
  });

  it("emits an audit event on error and clears the in-flight flag", () => {
    const audit = vi.fn();
    const repo = makeRepository({
      callbackTokenRepository: {
        pruneExpired: vi.fn(() => {
          throw new Error("storage exploded");
        }),
        revokeStuckIssued: vi.fn(() => []),
      },
    });
    const sweep = new PruneSweep(repo, makeTracker(), audit, () => NOW);
    sweep.run();
    expect(audit).toHaveBeenCalledWith(
      "approval.prune_sweep_failed",
      expect.objectContaining({
        result: "failed",
        metadata: { error: "storage exploded" },
      }),
    );
    // verify the next run is not blocked by the in-flight flag
    sweep.run();
    expect(audit).toHaveBeenCalledTimes(2);
  });
});

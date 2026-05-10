// Slice 2 Cut 3 — periodic + eager prune sweep extracted from daemon.ts.
//
// Responsibilities:
//   - schedule a periodic call to runSweep (default every 60s)
//   - allow callers to trigger an "eager" sweep when the broker's terminal-
//     record count crosses 80% of its configured max
//   - per sweep: prune expired callback tokens, revoke stuck issued tokens
//     past their grace period, fail-as-transport-lost the corresponding
//     pending approvals, then run the broker's own expirePending +
//     pruneTerminalRecords
//
// The two stuck-issued ID tracking Sets are passed in by reference because
// the daemon's approval path also writes to them when a callback enters the
// "issued" stuck state. PruneSweep reads + clears entries; the daemon's
// approval path adds entries. This is a deliberate shared-mutable boundary
// documented in the constructor types.

import type { DaemonBroker, DaemonCallbackTokenRepository } from "./daemon.js";

export type PruneAuditEmitter = (event: string, detail: object) => void;

/** Callback that returns the current Date — injected so tests can fake it. */
export type PruneClock = () => Date;

/** Repository handles the manager touches every sweep. */
export interface PruneSweepRepository {
  readonly callbackTokenRepository: DaemonCallbackTokenRepository | undefined;
  readonly broker: DaemonBroker | undefined;
}

/**
 * Mutable trackers shared with the daemon's approval path. The daemon's
 * approval-issued path adds approval IDs here when it observes a stuck
 * "issued" state; PruneSweep reads the current set, asks storage to revoke
 * tokens past their grace period, then deletes IDs that resolved.
 */
export interface PruneStuckIssuedTracker {
  readonly stuckIssuedApprovalIds: Set<string>;
  readonly transportLostStuckIssuedApprovalIds: Set<string>;
}

export interface PruneSweepConfig {
  readonly pruneIntervalMs?: number | undefined;
  readonly pruneBatchSize?: number | undefined;
  readonly stuckIssuedGraceMs?: number | undefined;
  readonly terminalRecordMaxAgeMs?: number | undefined;
  readonly terminalRecordMaxCount?: number | undefined;
  readonly schedulePrune?:
    | ((handler: () => void, intervalMs: number) => (() => void) | undefined)
    | undefined;
}

const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
const DEFAULT_TERMINAL_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TERMINAL_RECORD_MAX_COUNT = 10_000;
const DEFAULT_PRUNE_BATCH_SIZE = 100;
const DEFAULT_STUCK_ISSUED_GRACE_MS = 5_000;
const EAGER_PRUNE_RATIO = 0.8;

export class PruneSweep {
  readonly #repository: PruneSweepRepository;
  readonly #tracker: PruneStuckIssuedTracker;
  readonly #audit: PruneAuditEmitter;
  readonly #clock: PruneClock;
  readonly #config: PruneSweepConfig;
  #inFlight = false;

  constructor(
    repository: PruneSweepRepository,
    tracker: PruneStuckIssuedTracker,
    audit: PruneAuditEmitter,
    clock: PruneClock,
    config: PruneSweepConfig = {},
  ) {
    this.#repository = repository;
    this.#tracker = tracker;
    this.#audit = audit;
    this.#clock = clock;
    this.#config = config;
  }

  /**
   * Start the periodic sweep. Returns an unsubscribe; caller is expected to
   * register it with the daemon's #subscribe lifecycle.
   *
   * If `config.schedulePrune` is provided (test injection), it is preferred
   * over `setInterval` so tests can drive the timer manually.
   */
  schedule(): (() => void) | undefined {
    const intervalMs = positiveInteger(this.#config.pruneIntervalMs, DEFAULT_PRUNE_INTERVAL_MS);
    const handler = () => this.run();
    const scheduled = this.#config.schedulePrune?.(handler, intervalMs);
    if (scheduled !== undefined) {
      return scheduled;
    }
    const timer = setInterval(handler, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /**
   * Trigger an immediate sweep when the broker is at or above 80% of its
   * terminal-record cap. Cheap to call; no-op if the broker is healthy.
   * If the configured max is 0 (unlimited disabled), every call sweeps.
   */
  maybeTriggerEager(): void {
    const maxCount = nonNegativeInteger(
      this.#config.terminalRecordMaxCount,
      DEFAULT_TERMINAL_RECORD_MAX_COUNT,
    );
    if (maxCount === 0) {
      this.run();
      return;
    }
    const count = this.#repository.broker?.approvalRecordCount?.();
    if (count !== undefined && count >= Math.floor(maxCount * EAGER_PRUNE_RATIO)) {
      this.run();
    }
  }

  /**
   * Run one sweep. Public so tests can drive it without going through the
   * scheduler. Re-entrant calls are no-ops via #inFlight.
   */
  run(): void {
    if (this.#inFlight) {
      return;
    }
    this.#inFlight = true;
    try {
      const now = this.#clock();
      const batchSize = positiveInteger(this.#config.pruneBatchSize, DEFAULT_PRUNE_BATCH_SIZE);

      this.#repository.callbackTokenRepository?.pruneExpired?.(now.toISOString(), batchSize);

      const flaggedApprovalIds = Array.from(this.#tracker.stuckIssuedApprovalIds);
      if (flaggedApprovalIds.length > 0) {
        const cutoff = new Date(
          now.getTime() -
            positiveInteger(this.#config.stuckIssuedGraceMs, DEFAULT_STUCK_ISSUED_GRACE_MS),
        ).toISOString();
        const revoked =
          this.#repository.callbackTokenRepository?.revokeStuckIssued?.(
            cutoff,
            flaggedApprovalIds,
            batchSize,
          ) ?? [];
        const revokedIds = new Set(revoked.map((record) => record.approvalId));
        for (const record of revoked) {
          if (!this.#tracker.transportLostStuckIssuedApprovalIds.has(record.approvalId)) {
            this.#repository.broker?.failPendingApprovalAsTransportLost?.(record.approvalId);
            this.#tracker.transportLostStuckIssuedApprovalIds.add(record.approvalId);
          }
        }
        if (revoked.length === 0) {
          for (const approvalId of flaggedApprovalIds) {
            this.#tracker.stuckIssuedApprovalIds.delete(approvalId);
            this.#tracker.transportLostStuckIssuedApprovalIds.delete(approvalId);
          }
        } else if (revoked.length < batchSize) {
          for (const approvalId of flaggedApprovalIds) {
            if (!revokedIds.has(approvalId)) {
              this.#tracker.stuckIssuedApprovalIds.delete(approvalId);
              this.#tracker.transportLostStuckIssuedApprovalIds.delete(approvalId);
            }
          }
        }
      }

      this.#repository.broker?.expirePending?.();
      this.#repository.broker?.pruneTerminalRecords?.({
        maxAgeMs: positiveInteger(
          this.#config.terminalRecordMaxAgeMs,
          DEFAULT_TERMINAL_RECORD_MAX_AGE_MS,
        ),
        maxCount: nonNegativeInteger(
          this.#config.terminalRecordMaxCount,
          DEFAULT_TERMINAL_RECORD_MAX_COUNT,
        ),
        batchSize,
        now,
      });
    } catch (error) {
      this.#audit("approval.prune_sweep_failed", {
        result: "failed",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      this.#inFlight = false;
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

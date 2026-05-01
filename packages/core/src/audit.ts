// Phase 2 T3 — AuditEmitter skeleton (D13).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §1 D13 + §5 T3
//
// Phase 2 audit emission for the approval lifecycle. 12 enumerated event
// kinds (see `AuditEventKind` below; sources tracked in plan §1 D13).
// Storage is an in-memory FIFO ring (default 1000 entries, hard MAX
// 100_000 — Codex round-2 Q4) plus an optional structured logger sink.
//
// What T3 ships:
//   - `AuditEventKind` (12-arm union)
//   - `AuditEvent` shape (basic fields; `target?: Target` deferred to T6)
//   - `AuditEventInput` (caller-supplied; emitter generates `id` + `createdAt`)
//   - `AuditLogger` minimal duck-typed interface (Approved T3 decision —
//     keeps core free of a pino runtime dep; see test header)
//   - `AuditEmitter` class with constructor validation, FIFO ring,
//     `emit()`, `recent({ limit, kind? })`, and `_auditRingForTest()`
//   - `AUDIT_RING_HARD_MAX` exported constant
//
// What T3 does NOT ship (deferred to later tasks per plan):
//   - Redaction inside `emit()` — T5 wires `redact.ts` (Codex P1-3 / F10).
//     T3's `emit()` stores event metadata verbatim; T5 will wrap.
//   - `target?: Target` field on `AuditEvent` — T6 introduces `Target` in
//     core/types.ts alongside `ActorPolicy` / `ResolveApprovalInput`. T3
//     ships AuditEvent without target; T6 amends. Same forward-compat
//     pattern as Phase 1 T5's `ApprovalActor`.
//   - Public re-export from `packages/core/src/index.ts` — T3's plan file
//     list is strictly `{audit.ts, audit.test.ts}`. Internal callers
//     (broker work in T7+) import via relative path; external consumers
//     (daemon wire-up in Phase 3) get the export when a later task adds it.
//
// Phase 3 SQLite migration replaces the ring with a repository, leaving
// the `emit()` API stable.

import type { ApprovalActor } from "./types.js";

/**
 * Hard ceiling on the in-memory audit ring (Codex round-2 Q4 / D13).
 *
 * Constructor throws if `opts.ringSize > AUDIT_RING_HARD_MAX`. Reasonable
 * Phase 2 sessions emit O(100s–1000s) of events; the cap protects against
 * configuration bugs that would let the ring grow unbounded under
 * adversarial load. Phase 3 SQLite migration removes this cap.
 */
export const AUDIT_RING_HARD_MAX = 100_000;

/**
 * The 12 enumerated audit event kinds for Phase 2 approval lifecycle
 * emission. Each call-site in the broker / resolve / settle paths emits
 * exactly one of these (T7–T10 wire the emit sites; T21 e2e tests assert
 * one kind per failure-branch).
 */
export type AuditEventKind =
  | "approval.created"
  | "approval.resolved"
  | "approval.expired"
  | "approval.transport_lost"
  | "approval.duplicate_attempt"
  | "approval.wrong_actor"
  | "approval.wrong_target"
  | "approval.stale_callback"
  | "approval.binding_required"
  | "approval.unknown_approval_id"
  | "approval.unsupported_method"
  | "approval.unsupported_decision";

/**
 * Minimal structural type for the optional structured-log sink.
 *
 * `pino.Logger.info(obj, msg?)` and any `console`-shaped wrapper that
 * accepts a single object argument satisfy this interface. Daemon
 * wire-up passes a real pino logger; tests pass `vi.fn()` mocks. Core
 * carries no runtime dep on pino (Approved T3 decision; see audit.test.ts
 * header).
 */
export interface AuditLogger {
  info(payload: object): void;
}

/**
 * The shape of a stored audit event. `id` is broker-generated at emit
 * time; `createdAt` is the same. Other fields are caller-supplied via
 * `AuditEventInput`; absent fields are simply omitted (consistent with
 * `exactOptionalPropertyTypes`).
 *
 * `target?: Target` (per D13) is deferred to T6 — see file header.
 */
export type AuditEvent = {
  readonly id: string;
  readonly kind: AuditEventKind;
  readonly approvalId?: string;
  readonly appServerRequestId?: string | number;
  readonly actor?: ApprovalActor;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
};

/**
 * What the caller passes to `emit()` — the `AuditEvent` shape minus the
 * fields the emitter generates (`id`, `createdAt`). Use `Omit` so any
 * future field additions to `AuditEvent` automatically flow through.
 */
export type AuditEventInput = Omit<AuditEvent, "id" | "createdAt">;

/**
 * Constructor options for `AuditEmitter`. Both fields are optional;
 * defaults are documented per field.
 */
export interface AuditEmitterOptions {
  /**
   * Maximum number of events retained in the FIFO ring. Default 1000.
   * Throws on construction if ≤ 0, non-integer, or > AUDIT_RING_HARD_MAX
   * (= 100_000).
   */
  readonly ringSize?: number;
  /**
   * Optional structured-log sink. If provided, every `emit()` call
   * additionally invokes `logger.info(eventPayload)` with a flat object
   * containing the audit event fields. If absent, events are stored in
   * the ring only.
   */
  readonly logger?: AuditLogger;
}

/**
 * Phase 2 audit emitter. In-memory FIFO ring + optional structured-log
 * sink. T5 will extend `emit()` to apply `redact()` to event metadata
 * BEFORE both ring storage and logger emit (Codex P1-3 / F10) — T3
 * ships the skeleton with no redaction.
 *
 * Lifecycle:
 *   - Construct with options (or none). Constructor validates ringSize.
 *   - Call `emit(input)` per audit event. Emitter generates `id` and
 *     `createdAt`, pushes to ring, drops oldest if ring is full, and
 *     emits to logger if configured.
 *   - Call `recent({ limit?, kind? })` to read recent events (defensive
 *     copy; safe to mutate).
 *   - `_auditRingForTest()` is the test escape hatch (Phase 1
 *     `_pendingRecordsForTest` pattern).
 *
 * Thread-safety: Node.js single-threaded by default. The ring is
 * mutated synchronously inside `emit()`; no locks needed.
 */
export class AuditEmitter {
  readonly #ring: AuditEvent[] = [];
  readonly #maxSize: number;
  readonly #logger: AuditLogger | null;
  #idCounter = 0;

  constructor(opts: AuditEmitterOptions = {}) {
    const ringSize = opts.ringSize ?? 1000;
    if (!Number.isInteger(ringSize)) {
      throw new RangeError(`AuditEmitter: ringSize must be an integer; got ${ringSize}`);
    }
    if (ringSize <= 0) {
      throw new RangeError(`AuditEmitter: ringSize must be positive; got ${ringSize}`);
    }
    if (ringSize > AUDIT_RING_HARD_MAX) {
      throw new RangeError(
        `AuditEmitter: ringSize ${ringSize} exceeds hard MAX ${AUDIT_RING_HARD_MAX} (Codex round-2 Q4 / D13)`,
      );
    }
    this.#maxSize = ringSize;
    this.#logger = opts.logger ?? null;
  }

  /**
   * Emit one audit event. Generates `id` + `createdAt`, pushes to ring
   * (dropping oldest if at capacity), and writes a structured info-level
   * log line if a logger was provided at construction.
   *
   * The logger payload is a flat shallow copy of the stored event — log
   * consumers can filter on `kind`, `approvalId`, etc. without traversing
   * a wrapper. T5 will refine this so metadata strings are passed through
   * `redact()` before either ring storage or logger emit.
   */
  emit(input: AuditEventInput): void {
    const event: AuditEvent = {
      ...input,
      id: this.#nextId(),
      createdAt: new Date(),
    };
    this.#ring.push(event);
    if (this.#ring.length > this.#maxSize) {
      this.#ring.shift();
    }
    if (this.#logger !== null) {
      this.#logger.info({ ...event });
    }
  }

  /**
   * Read recent audit events. Returned array is a defensive copy —
   * callers may mutate it without affecting the ring.
   *
   * - `recent()` → all events in chronological order (oldest first).
   * - `recent({ limit })` → last N events.
   * - `recent({ kind })` → all events matching kind.
   * - `recent({ kind, limit })` → last N matching events.
   */
  recent(filter: { limit?: number; kind?: AuditEventKind } = {}): readonly AuditEvent[] {
    let result: AuditEvent[] = this.#ring.slice();
    if (filter.kind !== undefined) {
      result = result.filter((ev) => ev.kind === filter.kind);
    }
    if (filter.limit !== undefined) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  /**
   * Test-only accessor — returns a defensive copy of the underlying ring
   * in chronological (oldest-first) order. Mirrors the Phase 1
   * `_pendingRecordsForTest()` pattern. Production code should use
   * `recent()` instead; this exists so tests can assert ring state
   * without going through the public read API's filter semantics.
   */
  _auditRingForTest(): readonly AuditEvent[] {
    return this.#ring.slice();
  }

  /**
   * Generate a unique audit event id. Phase 2 uses
   * `audit-${epochMs}-${counter}-${random}`; Phase 3 may switch to ulid
   * or uuid for storage interchange. The contract is: non-empty string,
   * unique within an emitter instance.
   */
  #nextId(): string {
    this.#idCounter += 1;
    return `audit-${Date.now()}-${this.#idCounter}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

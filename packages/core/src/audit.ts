// Phase 2 T3 — AuditEmitter skeleton (D13).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §1 D13 + §5 T3
//
// Phase 2 audit emission for the approval lifecycle. 12 enumerated event
// kinds (see `AuditEventKind` below; sources tracked in plan §1 D13).
// Phase 6 extends the same audit pipe for Computer Use provider boundary
// failures.
// Storage is an in-memory FIFO ring (default 1000 entries, hard MAX
// 100_000 — Codex round-2 Q4) plus an optional structured logger sink.
//
// What T3 ships:
//   - `AuditEventKind` (approval lifecycle union + Phase 6 CU events)
//   - `AuditEvent` shape (basic fields; `target?: Target` deferred to T6)
//   - `AuditEventInput` (caller-supplied; emitter generates `id` + `createdAt`)
//   - `AuditLogger` minimal duck-typed interface (Approved T3 decision —
//     keeps core free of a pino runtime dep; see test header)
//   - `AuditEmitter` class with constructor validation, FIFO ring,
//     `emit()`, `recent({ limit, kind? })`, and `_auditRingForTest()`
//   - `AUDIT_RING_HARD_MAX` exported constant
//
// What T3 does NOT ship (deferred to later tasks per plan):
//   - `target?: Target` field on `AuditEvent` — T6 introduces `Target` in
//     core/types.ts alongside `ActorPolicy` / `ResolveApprovalInput`. T3
//     ships AuditEvent without target; T6 amends. Same forward-compat
//     pattern as Phase 1 T5's `ApprovalActor`.
//   - Public re-export from `packages/core/src/index.ts` — T3's plan file
//     list is strictly `{audit.ts, audit.test.ts}`. Internal callers
//     (broker work in T7+) import via relative path; external consumers
//     (daemon wire-up in Phase 3) get the export when a later task adds it.
//
// Wired in T5 (Codex P1-3 / F10):
//   `emit()` now deep-walks `event.metadata` (recursive into nested
//   objects + arrays) AND every string-typed root field through
//   `redact()` from `./redact.js` BEFORE pushing to the ring AND BEFORE
//   calling `logger.info()`. Caller's input is never mutated — the walk
//   is also a defensive copy. Non-string values (numbers, booleans,
//   null, Dates, Buffers, custom-class instances) are preserved as-is.
//   Object keys are preserved verbatim — only values are redacted.
//
// Phase 3 SQLite migration replaces the ring with a repository, leaving
// the `emit()` API stable.

import { redact } from "./redact.js";
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
 * Enumerated audit event kinds for approval lifecycle emission and Phase 6
 * Computer Use provider boundaries.
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
  | "approval.unsupported_decision"
  | "computer_use.provider_unavailable"
  | "computer_use.tool_denied"
  | "computer_use.sensitive_step_blocked"
  | "computer_use.tool_executed";

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
 * sink. `emit()` deep-walks every string in the event tree (metadata
 * recursive + root string fields) through `redact()` BEFORE both ring
 * storage AND logger emit (T5 / Codex P1-3 / F10). The same redacted
 * object instance reaches both sinks — no divergence. Caller's input
 * is never mutated; the walk is also a defensive copy. Non-string
 * values (numbers, booleans, null, Dates, Buffers, custom-class
 * instances) are preserved as-is via prototype check.
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
   * Emit one audit event. Generates `id` + `createdAt`, deep-walks every
   * string in the input (metadata recursive + root string fields) through
   * `redact()` from `./redact.js` (T5 / Codex P1-3 / F10), pushes to the
   * ring (dropping oldest if at capacity), and writes a structured info-
   * level log line if a logger was provided at construction.
   *
   * Redaction order — same redacted value reaches BOTH ring AND logger:
   *
   *   input (caller-owned; never mutated)
   *      ↓ redactInput() — recursive walk, defensive copy
   *   redacted (new object tree, secrets replaced by ***REDACTED:***)
   *      ↓ + id + createdAt
   *   event (the AuditEvent stored in the ring)
   *      ↓ shallow {...event}
   *   logger.info(payload)
   */
  emit(input: AuditEventInput): void {
    // T5: deep-walk strings through redact() BEFORE ring + logger.
    // `redactInput` is module-level pure; see file footer.
    const redacted = redactInput(input);
    const event: AuditEvent = {
      ...redacted,
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

// ─── Module-level redaction helpers (T5) ───────────────────────────────────
//
// Pure functions; no class state. Kept module-level (not class methods) so
// `redactValue` is genuinely reusable as a building block and so
// AuditEmitter doesn't accidentally close over `this` inside the recursion.

/**
 * Deep-walk the caller's `AuditEventInput` and return a NEW object whose
 * strings have been passed through `redact()`. Caller's input is never
 * mutated — the walk also serves as a defensive deep copy along every
 * branch we touch.
 *
 * Why walk the WHOLE input (root + metadata + actor) and not just
 * metadata: plan §5 T5.3 says "deep-walk event.metadata (and any string
 * field at the event root) through redact()". Defense in depth: if a
 * future caller stuffs a credential into `actor.username` or
 * `appServerRequestId` (string form), the redactor still catches it.
 * Broker-controlled fields like `kind` and the to-be-emitter-generated
 * `id` are passed through `redact()` too, but they never match a
 * redaction regex by construction (the ID format is `audit-${ms}-...`,
 * which has no embedded secret shape).
 *
 * Undefined values are skipped (consistent with `exactOptionalPropertyTypes`).
 */
function redactInput(input: AuditEventInput): AuditEventInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    out[key] = redactValue(value);
  }
  return out as AuditEventInput;
}

/**
 * Recursively walk a value:
 *   - `string`                       → `redact(value)`
 *   - `Array`                        → `array.map(redactValue)`
 *   - plain object (Object.prototype)→ for each [k, v], `[k, redactValue(v)]`
 *                                       (keys preserved verbatim — only values walked)
 *   - everything else (`null`,
 *     primitives, `Date`, `Buffer`,
 *     `Map`, `Set`, custom classes)  → preserved as-is
 *
 * The plain-object check uses `Object.getPrototypeOf(v) === Object.prototype`
 * (or `null`-prototype) so wrapped objects with semantic identity (Date,
 * Buffer, RegExp, Map, Set, custom classes) are NOT walked — walking
 * them would either lose semantic information (Date converted to
 * `{}`-shaped POJO) or recurse into private state of a class. Conservative
 * by design.
 *
 * Idempotency: T4's `redact()` is a fixed point on its own output, so
 * `redactValue(redactValue(x)) === redactValue(x)` for every reachable
 * input value (verified by the audit-redaction.test.ts idempotency suite).
 */
function redactValue(v: unknown): unknown {
  if (typeof v === "string") {
    return redact(v);
  }
  if (Array.isArray(v)) {
    return v.map(redactValue);
  }
  if (v === null || typeof v !== "object") {
    return v;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== null && proto !== Object.prototype) {
    // Date / Buffer / Map / Set / RegExp / custom-class instance — preserve.
    return v;
  }
  // Plain object — walk values, preserve keys.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    out[key] = redactValue(value);
  }
  return out;
}

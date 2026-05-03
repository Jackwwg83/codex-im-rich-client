// T3.1 (Phase 2) — failing test for the AuditEmitter skeleton.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §1 D13 + §5 T3
//
// Phase 2 audit event surface. 12 enumerated kinds (D13 round-2 v2.2):
//   approval.created / resolved / expired / transport_lost
//   approval.duplicate_attempt (late settle that lost the race)
//   approval.wrong_actor / wrong_target / stale_callback (bindActorPolicy validation)
//   approval.binding_required (resolve before bindActorPolicy)
//   approval.unknown_approval_id (resolve with id not in #pendingById)
//   approval.unsupported_method (wire-level unknown method)
//   approval.unsupported_decision (mapper rejected (decision, kind) pair)
//
// Constructor invariants:
//   - default ringSize 1000
//   - ringSize ≤ AUDIT_RING_HARD_MAX (= 100_000) accepted
//   - ringSize > 100_000 throws on construction (Codex round-2 Q4)
//
// Storage invariants:
//   - emit() pushes to in-memory ring AND writes a structured pino line
//     (when a logger is provided)
//   - ring is FIFO; drops oldest when full
//   - recent({limit, kind?}) returns most-recent matching events
//   - _auditRingForTest() returns a defensive copy (Phase 1
//     _pendingRecordsForTest pattern)
//
// Redaction is NOT wired in T3 — that's T5. T3 ships the skeleton; T5
// extends `emit()` to apply redact to event.metadata BEFORE log emit AND
// ring storage (Codex P1-3 / F10). Tests for redaction land in T5's
// `audit-redaction.test.ts`.
//
// Approved T3 decision: core uses a duck-typed AuditLogger to avoid a
// pino runtime dependency.
//   D13 names `pino.Logger` as the constructor option type. However,
//   `@codex-im/core` does not currently depend on pino (only
//   app-server-client / codex-runtime / daemon / cli do). Adding pino as
//   a core runtime dep is unnecessary because we only need a structured
//   info-level emit. The minimal duck-typed `AuditLogger` interface
//   (`info(payload: object): void`) is naturally satisfied by
//   `pino.Logger`; daemon wire-up passes a real pino logger, tests pass
//   `vi.fn()` mocks. This keeps `@codex-im/core` logger-implementation-
//   agnostic — same principle as F13's "channel-core has no @codex-im/
//   core runtime dep". Behaviorally identical to D13's intent.
//
// Forward-compat note (target field):
//   D13 lists `target?: Target` as an AuditEvent field. `Target` is
//   defined in T6 (types extension) when ActorPolicy + ResolveApprovalInput
//   are introduced. T3 ships AuditEvent without the target field; T6
//   amends. The same forward-compat pattern was used for ApprovalActor in
//   Phase 1 T5 (forward-compat'd before any IM adapter existed).
//
// TDD posture: this test is written BEFORE audit.ts exists. Expected
// failure is "module not found" — NOT a guessed AuditEvent field name.

import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_RING_HARD_MAX,
  AuditEmitter,
  type AuditEvent,
  type AuditEventInput,
  type AuditEventKind,
  type AuditLogger,
} from "../src/audit.js";

describe("@codex-im/core AuditEmitter (T3.1)", () => {
  // ─── AuditEventKind union (16 kinds) ─────────────────────────────────────

  it("AuditEventKind is the exact 16-kind union (compile-time guard)", () => {
    // Mirrors the Phase 1 skeleton.test.ts pattern for ApprovalActor /
    // ApprovalDecision exhaustiveness.
    const all: AuditEventKind[] = [
      "approval.created",
      "approval.resolved",
      "approval.expired",
      "approval.transport_lost",
      "approval.duplicate_attempt",
      "approval.wrong_actor",
      "approval.wrong_target",
      "approval.stale_callback",
      "approval.binding_required",
      "approval.unknown_approval_id",
      "approval.unsupported_method",
      "approval.unsupported_decision",
      "computer_use.provider_unavailable",
      "computer_use.tool_denied",
      "computer_use.sensitive_step_blocked",
      "computer_use.tool_executed",
    ];
    expect(all.length).toBe(16);
  });

  it("AuditEventKind rejects unknown kinds at the type level", () => {
    // @ts-expect-error — kinds outside the 16-arm union must not be assignable
    const bad: AuditEventKind = "approval.computer_use_invocation";
    expect(bad).toBeDefined();
  });

  // ─── AUDIT_RING_HARD_MAX constant ────────────────────────────────────────

  it("AUDIT_RING_HARD_MAX is exported and equals 100_000 (Codex round-2 Q4)", () => {
    expect(AUDIT_RING_HARD_MAX).toBe(100_000);
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  it("constructor with no opts uses default ring size 1000", () => {
    const e = new AuditEmitter();
    // Defensive: emit > 1000 events; ring should retain only the last 1000.
    for (let i = 0; i < 1100; i++) {
      e.emit(makeEvent("approval.created", { approvalId: `appr-${i}` }));
    }
    expect(e._auditRingForTest().length).toBe(1000);
    expect(e._auditRingForTest()[0]?.approvalId).toBe("appr-100"); // first 100 dropped
    expect(e._auditRingForTest()[999]?.approvalId).toBe("appr-1099");
  });

  it("constructor with ringSize: 100_000 succeeds", () => {
    const e = new AuditEmitter({ ringSize: 100_000 });
    expect(e._auditRingForTest()).toEqual([]);
  });

  it("constructor with ringSize: 100_001 throws (hard MAX guard)", () => {
    expect(() => new AuditEmitter({ ringSize: 100_001 })).toThrow(/100_?000|hard\s*MAX|maximum/i);
  });

  it("constructor with ringSize: 0 throws (size must be positive)", () => {
    expect(() => new AuditEmitter({ ringSize: 0 })).toThrow();
  });

  it("constructor with ringSize: -1 throws (size must be positive)", () => {
    expect(() => new AuditEmitter({ ringSize: -1 })).toThrow();
  });

  it("constructor with ringSize: 1.5 throws (size must be integer)", () => {
    expect(() => new AuditEmitter({ ringSize: 1.5 })).toThrow();
  });

  // ─── emit() + ring storage ───────────────────────────────────────────────

  it("emit() pushes event to ring with auto-generated id + createdAt", () => {
    const e = new AuditEmitter({ ringSize: 5 });
    const before = Date.now();
    e.emit(makeEvent("approval.created", { approvalId: "appr-1" }));
    const after = Date.now();
    const ring = e._auditRingForTest();
    expect(ring.length).toBe(1);
    expect(ring[0]?.kind).toBe("approval.created");
    expect(ring[0]?.approvalId).toBe("appr-1");
    expect(typeof ring[0]?.id).toBe("string");
    expect(ring[0]?.id.length).toBeGreaterThan(0);
    expect(ring[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(ring[0]?.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("emit() generates unique ids across calls", () => {
    const e = new AuditEmitter({ ringSize: 10 });
    for (let i = 0; i < 5; i++) {
      e.emit(makeEvent("approval.resolved"));
    }
    const ids = new Set(e._auditRingForTest().map((ev) => ev.id));
    expect(ids.size).toBe(5);
  });

  it("ring is FIFO — drops oldest when full", () => {
    const e = new AuditEmitter({ ringSize: 3 });
    e.emit(makeEvent("approval.created", { approvalId: "appr-1" }));
    e.emit(makeEvent("approval.created", { approvalId: "appr-2" }));
    e.emit(makeEvent("approval.created", { approvalId: "appr-3" }));
    e.emit(makeEvent("approval.created", { approvalId: "appr-4" }));
    const ring = e._auditRingForTest();
    expect(ring.length).toBe(3);
    expect(ring.map((ev) => ev.approvalId)).toEqual(["appr-2", "appr-3", "appr-4"]);
  });

  it("emit() writes a structured info-level line when a logger is provided", () => {
    const info = vi.fn();
    const logger: AuditLogger = { info };
    const e = new AuditEmitter({ logger });
    e.emit(makeEvent("approval.resolved", { approvalId: "appr-42" }));
    expect(info).toHaveBeenCalledTimes(1);
    // First arg is the structured payload; carries the audit discriminator
    // so log consumers can filter.
    const payload = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload).toHaveProperty("kind", "approval.resolved");
    expect(payload).toHaveProperty("approvalId", "appr-42");
  });

  it("emit() does not throw when no logger is provided", () => {
    const e = new AuditEmitter();
    expect(() => e.emit(makeEvent("approval.expired"))).not.toThrow();
  });

  // ─── recent() filter ─────────────────────────────────────────────────────

  it("recent() returns events in chronological (oldest-first) order by default", () => {
    const e = new AuditEmitter({ ringSize: 10 });
    e.emit(makeEvent("approval.created", { approvalId: "a" }));
    e.emit(makeEvent("approval.resolved", { approvalId: "a" }));
    e.emit(makeEvent("approval.created", { approvalId: "b" }));
    const all = e.recent();
    expect(all.length).toBe(3);
    expect(all.map((ev) => ev.approvalId)).toEqual(["a", "a", "b"]);
  });

  it("recent({ limit }) returns the last N events", () => {
    const e = new AuditEmitter({ ringSize: 10 });
    for (let i = 0; i < 5; i++) {
      e.emit(makeEvent("approval.created", { approvalId: `appr-${i}` }));
    }
    const last2 = e.recent({ limit: 2 });
    expect(last2.length).toBe(2);
    expect(last2.map((ev) => ev.approvalId)).toEqual(["appr-3", "appr-4"]);
  });

  it("recent({ kind }) filters by kind", () => {
    const e = new AuditEmitter({ ringSize: 10 });
    e.emit(makeEvent("approval.created", { approvalId: "a" }));
    e.emit(makeEvent("approval.resolved", { approvalId: "a" }));
    e.emit(makeEvent("approval.created", { approvalId: "b" }));
    e.emit(makeEvent("approval.expired", { approvalId: "c" }));
    const created = e.recent({ kind: "approval.created" });
    expect(created.length).toBe(2);
    expect(created.every((ev) => ev.kind === "approval.created")).toBe(true);
    expect(created.map((ev) => ev.approvalId)).toEqual(["a", "b"]);
  });

  it("recent({ kind, limit }) combines filter and limit", () => {
    const e = new AuditEmitter({ ringSize: 10 });
    for (let i = 0; i < 5; i++) {
      e.emit(makeEvent("approval.created", { approvalId: `appr-${i}` }));
    }
    e.emit(makeEvent("approval.resolved", { approvalId: "other" }));
    const lastTwoCreated = e.recent({ kind: "approval.created", limit: 2 });
    expect(lastTwoCreated.length).toBe(2);
    expect(lastTwoCreated.map((ev) => ev.approvalId)).toEqual(["appr-3", "appr-4"]);
  });

  it("recent() with empty ring returns []", () => {
    const e = new AuditEmitter();
    expect(e.recent()).toEqual([]);
  });

  // ─── _auditRingForTest() defensive copy ─────────────────────────────────

  it("_auditRingForTest() returns a defensive copy (mutating it does not affect the ring)", () => {
    const e = new AuditEmitter({ ringSize: 5 });
    e.emit(makeEvent("approval.created", { approvalId: "a" }));
    const snap1 = e._auditRingForTest();
    // attempt to mutate; if it's a defensive copy, the next snapshot is unaffected
    (snap1 as unknown as AuditEvent[]).push(
      makeFullEvent("approval.expired", { approvalId: "injected" }),
    );
    const snap2 = e._auditRingForTest();
    expect(snap2.length).toBe(1);
    expect(snap2[0]?.approvalId).toBe("a");
  });

  // ─── AuditEvent shape (T3 skeleton — target field deferred to T6) ────────

  it("AuditEvent admits the documented optional fields (basic shape)", () => {
    // Type-level smoke: each field below is admissible without a type
    // suppression directive. The `target?: Target` field is deferred to
    // T6; T3 does not test it.
    const ev: AuditEvent = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "approval.resolved",
      approvalId: "appr-1",
      appServerRequestId: 42,
      actor: { kind: "im", platform: "telegram", userId: "u-1" },
      metadata: { reason: "user clicked allow" },
      createdAt: new Date(),
    };
    expect(ev.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(ev.kind).toBe("approval.resolved");
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

/** Build an AuditEventInput (caller provides; emit fills id + createdAt). */
function makeEvent(
  kind: AuditEventKind,
  extras: Partial<Omit<AuditEventInput, "kind">> = {},
): AuditEventInput {
  return { kind, ...extras };
}

/** Build a full AuditEvent for tests that need to mutate the ring directly. */
function makeFullEvent(
  kind: AuditEventKind,
  extras: Partial<Omit<AuditEvent, "kind" | "id" | "createdAt">> = {},
): AuditEvent {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    kind,
    createdAt: new Date(),
    ...extras,
  };
}

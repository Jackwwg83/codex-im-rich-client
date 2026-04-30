// T5 (Phase 1): @codex-im/core skeleton.
//
// Validates the type surface that T9a's ApprovalBroker will consume:
//   ApprovalDecision   — discriminated decision the broker maps from IM
//                        button payloads (allowed once / session / deny / abort)
//   ApprovalActor      — Phase 2 forward-compat slot (P1-1). Phase 1
//                        callers always pass `null`; the type already
//                        admits the system + im shapes so Phase 2 doesn't
//                        need an audit-row migration.
//   ApprovalRecord     — broker's pending/resolved/expired bookkeeping.
//   SecurityPolicy     — Phase 1 noop interface (Phase 3 fills in).
//
// Logic-bearing tests (single-handler invariant, exhaustive method
// dispatch, transport-loss propagation) land in T9a/T9b.

import { describe, expect, it } from "vitest";
import type {
  ApprovalActor,
  ApprovalDecision,
  ApprovalRecord,
  SecurityPolicy,
} from "../src/index.js";

describe("@codex-im/core skeleton (T5)", () => {
  it("ApprovalDecision is a discriminated union narrowable on `kind`", () => {
    const d: ApprovalDecision = { kind: "approved" };
    if (d.kind === "approved") {
      // narrowing works
      const _check: "approved" = d.kind;
      expect(_check).toBe("approved");
    } else {
      throw new Error("expected approved");
    }
  });

  it("ApprovalDecision admits the four IM-layer outcomes", () => {
    const cases: ApprovalDecision[] = [
      { kind: "approved" },
      { kind: "approved_for_session" },
      { kind: "denied" },
      { kind: "denied", reason: "user pressed deny" },
      { kind: "abort" },
    ];
    expect(cases.length).toBe(5);
  });

  it("ApprovalActor admits null + system + im shapes (P1-1 forward-compat)", () => {
    const cases: ApprovalActor[] = [
      null,
      { kind: "system", reason: "transport_lost" },
      { kind: "im", platform: "telegram", userId: "u-123" },
      { kind: "im", platform: "lark", userId: "u-456", chatId: "c-789" },
    ];
    expect(cases.length).toBe(4);
  });

  it("ApprovalActor rejects unknown kinds at the type level (compile-time guard)", () => {
    // This ts-expect-error is the assertion: the type must NOT admit
    // a fourth kind. If a future maintainer accidentally widens
    // ApprovalActor to a less-restrictive type, this fails to compile.
    // @ts-expect-error — unknown kind must not be assignable
    const bad: ApprovalActor = { kind: "telegram-direct", platform: "x", userId: "y" };
    expect(bad).toBeDefined();
  });

  it("ApprovalRecord composes the four primitives", () => {
    const pending: ApprovalRecord = {
      id: "approval-1",
      appServerRequestId: 0,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t1", turnId: "u1", itemId: "call_X" },
      status: "pending",
      actor: null,
      createdAt: new Date(),
    };
    expect(pending.status).toBe("pending");
    expect(pending.actor).toBeNull();

    // Phase 1 system-resolved record — actor must be set, decision required
    const resolved: ApprovalRecord = {
      id: "approval-2",
      appServerRequestId: 1,
      method: "applyPatchApproval",
      params: {},
      status: "transport_lost",
      actor: { kind: "system", reason: "transport_lost" },
      createdAt: new Date(),
      decidedAt: new Date(),
      decision: { kind: "denied", reason: "transport_lost" },
    };
    expect(resolved.status).toBe("transport_lost");
    expect(resolved.actor).toMatchObject({ kind: "system" });
  });

  it("ApprovalRecord.status enumerates the four broker lifecycle states (no implicit string union)", () => {
    type S = ApprovalRecord["status"];
    const all: S[] = ["pending", "resolved", "expired", "transport_lost"];
    expect(all.length).toBe(4);
  });

  it("SecurityPolicy is a Phase 1 noop interface (Phase 3 fills in)", () => {
    const p: SecurityPolicy = { version: "phase1-noop" };
    expect(p.version).toBe("phase1-noop");
  });
});

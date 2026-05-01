// T6.1 (Phase 2) — failing type-only test for the resolve/binding/snapshot types.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T6
//
// T6 adds the Phase 2 type surface that T7 (broker `#pendingById` +
// listPending/getPending/onPendingCreated/onPendingResolved) and T11
// (broker.resolve()) consume. This file pins the type contract BEFORE
// T6.3 implementation lands; failure mode at T6.2 is `pnpm typecheck:
// tests` reporting type errors ("Module has no exported member ...").
//
// Coverage (plan T6.1 enumerated):
//   (a) PendingApprovalSnapshot — incl. expiresAt (D20).
//   (b) ResolveApprovalInput — requires target + callbackNonce (D19).
//   (c) ResolveError — 9-kind discriminated union (round-3 P1-1 fix).
//   (d) ActorPolicy — allowedActors + target + callbackNonce (D19).
//   (e) ApprovalRecord — extended with expiresAt: Date (D20).
//
// Plus implicit (D11/D19-derived):
//   - Target (D19): public type for IM platform addressing
//   - ApprovalUiAction (D11): UI-side enum the renderer surfaces
//   - ResolveApprovalResult (D12): ok-or-error discriminated
//   - BindResult / BindError (D19): bindActorPolicy outcome
//
// HOME DECISION (T6.1):
//   Plan §2.2 places `Target` in channel-core/src/types.ts and
//   `ApprovalUiAction` in render/src/approval-card.ts. Both target
//   packages don't exist yet at T6 time (channel-core = T18; render =
//   T13). Pragmatic resolution: T6 defines BOTH in core/src/types.ts
//   as the canonical home; channel-core (T18) and render (T14) will
//   re-export type-only. This matches F13 ("channel-core has no
//   @codex-im/core runtime dep") because type-only imports don't
//   create runtime deps.
//
// TYPE-ONLY POSTURE:
//   This file is mostly type-narrowing assertions wrapped in
//   `it()` blocks (pattern matches Phase 1 skeleton.test.ts). The
//   failure surfaces at `pnpm typecheck:tests` (tsc compile pass),
//   not at vitest runtime. A few minimal `expect(true).toBe(true)`
//   anchors keep vitest happy when running the file.

import { describe, expect, it } from "vitest";
import type {
  ActorPolicy,
  ApprovalActor,
  ApprovalDecision,
  ApprovalRecord,
  ApprovalUiAction,
  BindError,
  BindResult,
  PendingApprovalSnapshot,
  ResolveApprovalInput,
  ResolveApprovalResult,
  ResolveError,
  Target,
} from "../src/index.js";

describe("@codex-im/core T6 type extensions (T6.1)", () => {
  // ─── Target (D19; new in core for T6) ──────────────────────────────
  describe("Target — IM platform addressing (D19)", () => {
    it("admits the documented shape: platform + chatId + optional threadKey/topicId", () => {
      const t: Target = {
        platform: "telegram",
        chatId: "tg-100",
      };
      expect(t.platform).toBe("telegram");
      expect(t.chatId).toBe("tg-100");
    });

    it("admits optional threadKey + topicId", () => {
      const t: Target = {
        platform: "telegram",
        chatId: "tg-100",
        threadKey: "thread-1",
        topicId: "topic-1",
      };
      expect(t.threadKey).toBe("thread-1");
      expect(t.topicId).toBe("topic-1");
    });

    it("rejects extra/misnamed fields at the type level", () => {
      // @ts-expect-error — `chatID` isn't a valid Target field; chatId is correct
      const bad: Target = { platform: "telegram", chatID: "tg-100" };
      expect(bad).toBeDefined();
    });
  });

  // ─── ApprovalUiAction (D11; new in core for T6) ────────────────────
  describe("ApprovalUiAction — UI-side action enum (D11)", () => {
    it("admits the four documented kinds", () => {
      const cases: ApprovalUiAction[] = [
        { kind: "allow_once" },
        { kind: "allow_session" },
        { kind: "decline" },
        { kind: "abort" },
      ];
      expect(cases.length).toBe(4);
    });

    it("rejects unknown kinds at the type level", () => {
      // @ts-expect-error — only the 4 documented kinds are admitted
      const bad: ApprovalUiAction = { kind: "approve" };
      expect(bad).toBeDefined();
    });
  });

  // ─── ApprovalRecord extension (D20) ────────────────────────────────
  describe("ApprovalRecord — adds expiresAt: Date (D20)", () => {
    it("requires expiresAt: Date alongside the existing fields", () => {
      const rec: ApprovalRecord = {
        id: "approval-1",
        appServerRequestId: 0,
        method: "item/fileChange/requestApproval",
        params: { threadId: "t1", turnId: "u1", itemId: "call_X" },
        status: "pending",
        actor: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };
      expect(rec.expiresAt).toBeInstanceOf(Date);
      expect(rec.expiresAt.getTime()).toBeGreaterThan(rec.createdAt.getTime());
    });

    it("rejects an ApprovalRecord without expiresAt at the type level", () => {
      // @ts-expect-error — expiresAt is required after T6
      const bad: ApprovalRecord = {
        id: "approval-2",
        appServerRequestId: 1,
        method: "applyPatchApproval",
        params: {},
        status: "pending",
        actor: null,
        createdAt: new Date(),
      };
      expect(bad).toBeDefined();
    });

    it("preserves the existing four lifecycle states", () => {
      type S = ApprovalRecord["status"];
      const all: S[] = ["pending", "resolved", "expired", "transport_lost"];
      expect(all.length).toBe(4);
    });
  });

  // ─── PendingApprovalSnapshot (D12) ─────────────────────────────────
  describe("PendingApprovalSnapshot — public read-API shape (D12)", () => {
    it("admits the documented readonly fields incl. expiresAt", () => {
      const snap: PendingApprovalSnapshot = {
        id: "approval-1",
        appServerRequestId: 42,
        method: "item/commandExecution/requestApproval",
        params: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };
      expect(snap.id).toBe("approval-1");
      expect(snap.expiresAt).toBeInstanceOf(Date);
    });

    it("fields are readonly (compile-time guard)", () => {
      const snap: PendingApprovalSnapshot = {
        id: "approval-1",
        appServerRequestId: 42,
        method: "item/fileChange/requestApproval",
        params: {},
        createdAt: new Date(),
        expiresAt: new Date(),
      };
      // @ts-expect-error — id is readonly
      snap.id = "approval-2";
      // @ts-expect-error — expiresAt is readonly
      snap.expiresAt = new Date();
      expect(snap).toBeDefined();
    });

    it("rejects a snapshot missing expiresAt at the type level", () => {
      // @ts-expect-error — expiresAt is required (D20)
      const bad: PendingApprovalSnapshot = {
        id: "approval-1",
        appServerRequestId: 42,
        method: "item/fileChange/requestApproval",
        params: {},
        createdAt: new Date(),
      };
      expect(bad).toBeDefined();
    });
  });

  // ─── ResolveApprovalInput (D19) ────────────────────────────────────
  describe("ResolveApprovalInput — requires target + callbackNonce (D19)", () => {
    it("admits the documented shape", () => {
      const input: ResolveApprovalInput = {
        approvalId: "approval-1",
        decision: { kind: "allow_once" },
        actor: { kind: "im", platform: "telegram", userId: "tg-1" },
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-12345abcdef",
      };
      expect(input.approvalId).toBe("approval-1");
      expect(input.callbackNonce).toBe("nonce-12345abcdef");
    });

    it("rejects an input missing target (D19 redline)", () => {
      // @ts-expect-error — target is required per D19
      const bad: ResolveApprovalInput = {
        approvalId: "approval-1",
        decision: { kind: "decline" },
        actor: { kind: "im", platform: "telegram", userId: "tg-1" },
        callbackNonce: "nonce-1",
      };
      expect(bad).toBeDefined();
    });

    it("rejects an input missing callbackNonce (D19 redline)", () => {
      // @ts-expect-error — callbackNonce is required per D19
      const bad: ResolveApprovalInput = {
        approvalId: "approval-1",
        decision: { kind: "decline" },
        actor: { kind: "im", platform: "telegram", userId: "tg-1" },
        target: { platform: "telegram", chatId: "tg-100" },
      };
      expect(bad).toBeDefined();
    });

    it("rejects null actor (NonNullable<ApprovalActor> per D19)", () => {
      const bad: ResolveApprovalInput = {
        approvalId: "approval-1",
        decision: { kind: "decline" },
        // @ts-expect-error — D19: null actor not allowed; ResolveApprovalInput requires NonNullable<ApprovalActor>
        actor: null,
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-1",
      };
      expect(bad).toBeDefined();
    });

    it("decision is ApprovalUiAction (UI-side; broker's mapper translates to wire shape)", () => {
      const input: ResolveApprovalInput = {
        approvalId: "approval-1",
        decision: { kind: "allow_session" },
        actor: { kind: "im", platform: "telegram", userId: "tg-1" },
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-1",
      };
      // Type-narrowing on decision works:
      if (input.decision.kind === "allow_session") {
        expect(input.decision.kind).toBe("allow_session");
      }
    });
  });

  // ─── ResolveError — 9-kind discriminated union ─────────────────────
  describe("ResolveError — 9-kind discriminated union (round-3 P1-1 fix)", () => {
    it("admits all 9 documented kinds", () => {
      const cases: ResolveError[] = [
        { kind: "unknown_approval_id" },
        { kind: "already_resolved", priorDecision: { kind: "approved" } as ApprovalDecision },
        { kind: "expired", createdAt: new Date(0), expiredAt: new Date(1) },
        { kind: "transport_lost", lostAt: new Date() },
        { kind: "wrong_actor" },
        { kind: "wrong_target" },
        { kind: "stale_callback" },
        { kind: "binding_required" },
        { kind: "unsupported_decision", method: "item/permissions/requestApproval", reason: "..." },
      ];
      expect(cases.length).toBe(9);
    });

    it("each kind narrows to its specific payload shape", () => {
      const e: ResolveError = { kind: "expired", createdAt: new Date(0), expiredAt: new Date(1) };
      if (e.kind === "expired") {
        expect(e.createdAt).toBeInstanceOf(Date);
        expect(e.expiredAt).toBeInstanceOf(Date);
      }
    });

    it("rejects unknown error kinds at the type level", () => {
      // @ts-expect-error — kinds outside the 9-arm union must not be assignable
      const bad: ResolveError = { kind: "computer_use_denied" };
      expect(bad).toBeDefined();
    });

    it("each kind is structurally distinct (no payload-leak across variants)", () => {
      // unknown_approval_id has NO additional fields beyond `kind`
      const u: ResolveError = { kind: "unknown_approval_id" };
      // @ts-expect-error — `priorDecision` belongs to `already_resolved`, not unknown_approval_id
      const bad1: ResolveError = { kind: "unknown_approval_id", priorDecision: { kind: "denied" } };
      expect(u).toBeDefined();
      expect(bad1).toBeDefined();
    });
  });

  // ─── ResolveApprovalResult (D12) ───────────────────────────────────
  describe("ResolveApprovalResult — ok-or-error discriminated (D12)", () => {
    it("admits the ok shape with appliedAt timestamp", () => {
      const r: ResolveApprovalResult = { kind: "ok", appliedAt: new Date() };
      if (r.kind === "ok") {
        expect(r.appliedAt).toBeInstanceOf(Date);
      }
    });

    it("admits the error shape with ResolveError payload", () => {
      const r: ResolveApprovalResult = {
        kind: "error",
        error: { kind: "binding_required" },
      };
      if (r.kind === "error") {
        expect(r.error.kind).toBe("binding_required");
      }
    });

    it("rejects a result with both ok and error payloads", () => {
      const bad: ResolveApprovalResult = {
        kind: "ok",
        appliedAt: new Date(),
        // @ts-expect-error — discriminated union: kind:"ok" arm has no `error` field
        error: { kind: "binding_required" },
      };
      expect(bad).toBeDefined();
    });
  });

  // ─── ActorPolicy (D19) ─────────────────────────────────────────────
  describe("ActorPolicy — per-card binding (D19)", () => {
    it("admits the documented shape: allowedActors + target + callbackNonce", () => {
      const p: ActorPolicy = {
        allowedActors: [{ kind: "im", platform: "telegram", userId: "tg-1" }],
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-12345abcdef",
      };
      expect(p.allowedActors.length).toBe(1);
      expect(p.callbackNonce).toBe("nonce-12345abcdef");
    });

    it("allowedActors is readonly array of NonNullable<ApprovalActor>", () => {
      const p: ActorPolicy = {
        allowedActors: [
          { kind: "im", platform: "telegram", userId: "tg-1" },
          { kind: "im", platform: "lark", userId: "lark-2" },
        ],
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-1",
      };
      expect(p.allowedActors.length).toBe(2);
      const bad: ActorPolicy = {
        // @ts-expect-error — null is not assignable to NonNullable<ApprovalActor>
        allowedActors: [null],
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-1",
      };
      expect(bad).toBeDefined();
    });

    it("fields are readonly (compile-time guard)", () => {
      const p: ActorPolicy = {
        allowedActors: [{ kind: "im", platform: "telegram", userId: "tg-1" }],
        target: { platform: "telegram", chatId: "tg-100" },
        callbackNonce: "nonce-1",
      };
      // @ts-expect-error — callbackNonce is readonly
      p.callbackNonce = "new-nonce";
      expect(p).toBeDefined();
    });
  });

  // ─── BindResult + BindError (D19) ──────────────────────────────────
  describe("BindResult — ok-or-error from bindActorPolicy (D19)", () => {
    it("admits the ok shape", () => {
      const r: BindResult = { kind: "ok" };
      expect(r.kind).toBe("ok");
    });

    it("admits the error shape with BindError payload", () => {
      const r: BindResult = {
        kind: "error",
        error: { kind: "conflicting_policy" },
      };
      if (r.kind === "error") {
        expect(r.error.kind).toBe("conflicting_policy");
      }
    });

    it("BindError admits at least the documented operator-bug kinds", () => {
      const cases: BindError[] = [
        { kind: "unknown_approval_id" },
        { kind: "not_pending" },
        { kind: "conflicting_policy" },
      ];
      expect(cases.length).toBe(3);
    });
  });
});

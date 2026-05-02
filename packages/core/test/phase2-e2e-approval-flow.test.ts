// T21.2 (Phase 2) — full e2e approval flow: 15 paths.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T21.2
// (P2.10 + Codex missing tests + R4 round-2 audit-redaction-per-failure-branch)
//
// Each describe block exercises one of the 15 paths through the full
// pipeline (FakeAppServer → AppServerClient → ApprovalBroker →
// daemon-wireup → render → TelegramShapeFakeChannelAdapter → user click
// → broker.resolve → wire response). Per-path assertions cover:
//   (a) the matching ResolveError kind / wire response shape / no-wire behavior
//   (b) the matching AuditEvent.kind from D13's 12 enumerated kinds
//   (c) audit redaction: known-bad payloads (Telegram bot token,
//       absolute path, AWS-key shape) DO NOT appear verbatim in any
//       audit event's stringified content (R4 round-2)
//
// 15 paths (numbered T21.2.1 through T21.2.15):
//   1. allow_once happy path (command_execution)
//   2. decline (command_execution)
//   3. abort (file_change → wire "cancel", NOT "abort")
//   4. abort on permissions kind (renderer wouldn't surface it; defense-in-depth at broker)
//   5. duplicate click — first wins, second loses race
//   6. wrong actor BEFORE first decision (Codex missing #5)
//   7. wrong target (chat exfil attempt)
//   8. stale callback (nonce mismatch — card edited and re-bound)
//   9. binding_required (resolve before bind)
//   10. expired-without-sweeper (Codex missing #4: lazy expire in resolve)
//   11. transport_lost while pending
//   12. reattach + stale request (deferred to Phase 3 — supervisor lives in daemon)
//   13. unknown approval id
//   14. unknown method (broker level — -32601 + audit, no PendingEntry)
//   15. unknown kind (renderer-defensive C-P1 path)
//
// T21.3 audit-emit-before-wire-response is asserted inside path 1.

import { describe, expect, it, vi } from "vitest";
import {
  BAD_PAYLOAD_FIXTURES,
  type E2eRig,
  auditKinds,
  badParams,
  buildE2eRig,
  emitFakeServerRequest,
  flushAsync,
  injectUserClick,
  nextE2eId,
} from "./phase2-e2e-rig.js";

function assertNoBadPayloadInAudit(rig: E2eRig): void {
  const events = rig.audit.recent();
  const blob = JSON.stringify(events);
  expect(blob, "Telegram bot token leaked into audit").not.toContain(
    BAD_PAYLOAD_FIXTURES.telegramBotToken,
  );
  expect(blob, "absolute path leaked into audit").not.toContain(BAD_PAYLOAD_FIXTURES.absPath);
  // AWS-key shape may appear via redaction marker but never raw.
  expect(blob, "AWS key leaked into audit").not.toContain(BAD_PAYLOAD_FIXTURES.awsKeyShape);
}

// ─── Path 1 — allow_once happy path + T21.3 emit-before-wire ─────────────

describe("T21.2.1 + T21.3 — allow_once happy path (command_execution)", () => {
  it("emits approval.created BEFORE the wire promise resolves; allow_once → wire 'accept'", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      // T21.3: at this point the broker has already emitted approval.created
      // (synchronously inside #handle's await chain) BEFORE the wire response
      // could possibly land — wirePromise is still pending.
      expect(auditKinds(rig)).toContain("approval.created");

      // Daemon wire-up has rendered the card + bound the policy by now.
      injectUserClick(rig, approvalId, { kind: "allow_once" });
      await flushAsync();

      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "accept" });

      const kinds = auditKinds(rig);
      expect(kinds).toContain("approval.created");
      expect(kinds).toContain("approval.resolved");

      // Adapter recorded an ack with ok=true.
      const acks = rig.adapter._acksForTest();
      expect(acks.length).toBe(1);
      expect(acks[0]?.ack.ok).toBe(true);

      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 2 — decline ────────────────────────────────────────────────────

describe("T21.2.2 — decline (command_execution)", () => {
  it("decline → wire {decision:'decline'}; no 'accept' is ever sent", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      injectUserClick(rig, approvalId, { kind: "decline" });
      await flushAsync();

      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "decline" });
      expect(auditKinds(rig)).toContain("approval.resolved");
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 3 — abort (file_change → wire "cancel") ────────────────────────

describe("T21.2.3 — abort on file_change kind (wire 'cancel', not 'abort')", () => {
  it("abort on file_change maps to wire {decision:'cancel'} per D11", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig, {
        method: "item/fileChange/requestApproval",
      });
      injectUserClick(rig, approvalId, { kind: "abort" });
      await flushAsync();

      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "cancel" });
      expect(wire).not.toEqual({ decision: "abort" }); // legacy ReviewDecision is for legacy methods only
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 4 — abort on permissions kind (unsupported) ────────────────────

describe("T21.2.4 — abort on permissions kind (mapper rejects, no settle)", () => {
  it("permissions + abort → unsupported_decision audit + no wire response", async () => {
    const rig = await buildE2eRig({
      pendingModeMethods: ["item/permissions/requestApproval"],
    });
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig, {
        method: "item/permissions/requestApproval",
      });
      // Bypass renderer's decline-only restriction; daemon-wireup
      // forwards whatever uiAction the adapter injects.
      injectUserClick(rig, approvalId, { kind: "abort" });
      await flushAsync();

      expect(auditKinds(rig)).toContain("approval.unsupported_decision");
      // Pending stays open (no wire settle).
      expect(rig.broker.listPending().length).toBe(1);

      // Drain so cleanup doesn't leak the wire promise.
      rig.broker.failPendingAsTransportLost();
      await flushAsync();
      await wirePromise;
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 5 — duplicate click ───────────────────────────────────────────

describe("T21.2.5 — duplicate click (first wins; second is duplicate_attempt)", () => {
  it("two injectActions for same approvalId — first resolves, second logs duplicate_attempt", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      injectUserClick(rig, approvalId, { kind: "allow_once" });
      await flushAsync();
      await wirePromise;

      injectUserClick(
        rig,
        approvalId,
        { kind: "allow_once" },
        {
          callbackHandle: `cb-second-${approvalId}`,
        },
      );
      await flushAsync();

      const kinds = auditKinds(rig);
      expect(kinds).toContain("approval.duplicate_attempt");
      // The second ack should be ok:false.
      const acks = rig.adapter._acksForTest();
      expect(acks.length).toBe(2);
      expect(acks[1]?.ack.ok).toBe(false);
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 6 — wrong actor BEFORE first decision (Codex missing #5) ───────

describe("T21.2.6 — wrong_actor before first decision (B clicks; A still resolves)", () => {
  it("B's click fails wrong_actor; A's later click resolves cleanly", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      // Bob clicks first — not in allowedActors.
      injectUserClick(
        rig,
        approvalId,
        { kind: "allow_once" },
        {
          sender: { userId: "u-bob" },
          callbackHandle: `cb-bob-${approvalId}`,
        },
      );
      await flushAsync();

      expect(auditKinds(rig)).toContain("approval.wrong_actor");
      // Pending preserved.
      expect(rig.broker.listPending().length).toBe(1);

      // Alice (the bound actor) now clicks — should resolve.
      injectUserClick(
        rig,
        approvalId,
        { kind: "allow_once" },
        {
          callbackHandle: `cb-alice-${approvalId}`,
        },
      );
      await flushAsync();
      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "accept" });
      expect(auditKinds(rig)).toContain("approval.resolved");
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 7 — wrong target (chat exfil attempt) ──────────────────────────

describe("T21.2.7 — wrong_target (different chatId)", () => {
  it("Alice clicks but action.target.chatId mismatches bound policy → wrong_target", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      injectUserClick(
        rig,
        approvalId,
        { kind: "allow_once" },
        {
          target: { platform: "fake-telegram", chatId: "c-different" },
        },
      );
      await flushAsync();
      expect(auditKinds(rig)).toContain("approval.wrong_target");
      expect(rig.broker.listPending().length).toBe(1);

      rig.broker.failPendingAsTransportLost();
      await flushAsync();
      await wirePromise;
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 8 — stale callback (nonce mismatch) ────────────────────────────

describe("T21.2.8 — stale_callback (nonce mismatch)", () => {
  it("action.callbackNonce mismatches bound policy → stale_callback audit", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      injectUserClick(
        rig,
        approvalId,
        { kind: "allow_once" },
        {
          callbackNonce: "nonce-stale-bbbbbbbbbb",
        },
      );
      await flushAsync();
      expect(auditKinds(rig)).toContain("approval.stale_callback");
      expect(rig.broker.listPending().length).toBe(1);

      rig.broker.failPendingAsTransportLost();
      await flushAsync();
      await wirePromise;
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 9 — binding_required (resolve before bind) ─────────────────────

describe("T21.2.9 — binding_required (daemon wire-up never bound)", () => {
  it("daemon-wireup skipped bindActorPolicy → resolve fails binding_required + pending stays open", async () => {
    const rig = await buildE2eRig({ disableAutoBind: true });
    try {
      // sendCard still runs but no bindActorPolicy. Pending stays
      // unbound. Set waitForBind:false because sentCards never gets the
      // approval (rig only sets sentCards when bind succeeds in
      // production wire-up; in this test we deliberately skipped bind).
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig, {
        waitForBind: false,
      });
      const result = await rig.broker.resolve({
        approvalId,
        decision: { kind: "allow_once" },
        actor: rig.allowedActor,
        target: rig.target,
        callbackNonce: "nonce-anything",
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("binding_required");
      }
      expect(auditKinds(rig)).toContain("approval.binding_required");

      rig.broker.failPendingAsTransportLost();
      await flushAsync();
      await wirePromise;
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 10 — expired without sweeper (Codex missing #4) ────────────────

describe("T21.2.10 — expired without sweeper (lazy expire in resolve)", () => {
  it("Date.now() past expiresAt without expirePending() — resolve returns expired + audit", async () => {
    const rig = await buildE2eRig();
    try {
      const { id, approvalId, wirePromise } = await emitFakeServerRequest(rig);
      // Mutate the record's expiresAt to be in the past WITHOUT calling expirePending.
      const internal = rig.broker._pendingRecordsForTest();
      const record = internal.get(id);
      if (!record) throw new Error("test setup: record missing");
      (record as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1_000);

      injectUserClick(rig, approvalId, { kind: "allow_once" });
      await flushAsync();

      const kinds = auditKinds(rig);
      expect(kinds).toContain("approval.expired");
      // Wire is the kind-specific defaultReject — for command_execution that's "decline".
      const wire = await wirePromise;
      expect(wire).toEqual({ decision: "decline" });
      expect(wire).not.toEqual({ decision: "accept" });
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 11 — transport_lost while pending ──────────────────────────────

describe("T21.2.11 — transport_lost while pending", () => {
  it("transport-lost flips pending to terminal; subsequent resolve is duplicate_attempt", async () => {
    const rig = await buildE2eRig();
    try {
      const { approvalId, wirePromise } = await emitFakeServerRequest(rig);
      rig.broker.failPendingAsTransportLost();
      await flushAsync();
      await wirePromise;
      expect(auditKinds(rig)).toContain("approval.transport_lost");

      // Late click loses the race; broker emits duplicate_attempt.
      injectUserClick(rig, approvalId, { kind: "allow_once" });
      await flushAsync();
      expect(auditKinds(rig)).toContain("approval.duplicate_attempt");
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 12 — reattach + stale request (deferred to Phase 3 supervisor) ──

describe("T21.2.12 — reattach + stale request (deferred — supervisor in daemon, Phase 3 scope)", () => {
  it.skip("supervisor reattach scenario — deferred to phase 3 daemon wire-up", () => {
    // Phase 1 supervisor lives in @codex-im/daemon; Phase 2 e2e doesn't
    // construct the supervisor. Path 12 will move to a daemon-side test
    // when daemon wire-up is fully implemented.
  });
});

// ─── Path 13 — unknown approval id ───────────────────────────────────────

describe("T21.2.13 — unknown_approval_id (resolve with fabricated id)", () => {
  it("fabricated id → unknown_approval_id error + audit; no settle; bad payload in id is redacted", async () => {
    const rig = await buildE2eRig();
    try {
      // T18-T22 codex review P1(a): even when bad payload lives in the
      // resolve() input fields (approvalId / callbackNonce), audit
      // redaction must strip Telegram-token / abs-path substrings.
      // Each sensitive value is its own contiguous string so the
      // redact regexes (anchored on the full token shape) match.
      const badId = `approval-${BAD_PAYLOAD_FIXTURES.telegramBotToken}`;
      const result = await rig.broker.resolve({
        approvalId: badId,
        decision: { kind: "decline" },
        actor: rig.allowedActor,
        target: rig.target,
        callbackNonce: BAD_PAYLOAD_FIXTURES.absPath,
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error.kind).toBe("unknown_approval_id");
      }
      expect(auditKinds(rig)).toContain("approval.unknown_approval_id");
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 14 — unknown method (broker level, -32601) ─────────────────────

describe("T21.2.14 — unknown method at broker (no PendingEntry; audit + -32601)", () => {
  it("future/unseen/method → -32601 + approval.unsupported_method audit + no card sent", async () => {
    const rig = await buildE2eRig();
    try {
      const sendCardSpy = vi.spyOn(rig.adapter, "sendCard");
      const id = nextE2eId();
      // Wire response will be -32601 reject; catch to avoid unhandled.
      // Don't go through emitFakeServerRequest helper because it waits
      // for bind that never happens for an unknown method.
      const wirePromise = rig.fake
        .emitServerRequest("future/unseen/method", badParams(), id)
        .catch(() => undefined);
      await flushAsync();

      const kinds = auditKinds(rig);
      expect(kinds).toContain("approval.unsupported_method");
      expect(kinds).not.toContain("approval.created");
      expect(rig.broker.listPending().length).toBe(0);
      expect(sendCardSpy).not.toHaveBeenCalled();

      await wirePromise;
      assertNoBadPayloadInAudit(rig);
    } finally {
      await rig.cleanup();
    }
  });
});

// ─── Path 15 — unknown kind (renderer-defensive C-P1) ────────────────────

describe("T21.2.15 — renderer-defensive unknown-kind decline-only card (C-P1)", () => {
  it("hand-projecting an unknown-method snapshot yields decline-only card with critical risk", async () => {
    // Use the renderer directly — broker would have already filtered
    // unknown methods at #handle (path 14). This path tests the
    // renderer's defense-in-depth.
    const { projectAsRichBlock } = await import("@codex-im/render");
    const snapshot = {
      id: "approval-defensive",
      appServerRequestId: 999,
      method: "future/unseen/method",
      params: badParams(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const block = projectAsRichBlock(snapshot);
    expect(block.type).toBe("approval");
    if (block.type === "approval") {
      expect(block.card.kind).toBe("unknown");
      expect(block.card.actions).toEqual([{ kind: "decline" }]);
      expect(block.card.target.riskLevel).toBe("critical");
      expect(block.card.summary).not.toContain(BAD_PAYLOAD_FIXTURES.absPath);
    }
  });
});

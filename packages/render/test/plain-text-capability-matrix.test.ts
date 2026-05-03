// T17 (Phase 2) — plain-text capability fallback tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T17
// (Codex Q1 / gstack Q1)
//
// Capability matrix: supportsButtons × canEditMessage. Adapters with
// inline keyboards (Telegram, Lark interactive cards) get a body
// without a slash-command list — buttons handle action selection.
// Adapters without buttons (some webhook-only setups, plain text
// channels) get a non-actionable fallback. Phase 7 forbids raw
// approval ids, raw callback tokens, and slash-command approval hints
// in low-capability text channels.
//
// English default labels per Codex Q1; localization belongs to
// the adapter (D17 / 06-IM-ADAPTERS).
//
// canEditMessage matters for the "what happens next" footer:
//   true  → "This message will update when the request is decided."
//   false → "We'll post a follow-up when the request is decided."

import { describe, expect, it } from "vitest";
import type { ApprovalCard } from "../src/index.js";
import { formatPlainText } from "../src/plain-text.js";

const BASE_CARD: ApprovalCard = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-7",
  summary: "Run command: ls -la /tmp",
  target: { riskLevel: "high" },
  actions: [
    { kind: "allow_once" },
    { kind: "allow_session" },
    { kind: "decline" },
    { kind: "abort" },
  ],
  status: "pending",
  createdAt: new Date(0),
};

describe("formatPlainText (T17)", () => {
  it("includes risk-level header + approvalId when secure buttons carry the action", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: true, canEditMessage: true });
    expect(out).toMatch(/HIGH/i);
    expect(out).toContain("approval-7");
  });

  it("includes summary verbatim", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: false, canEditMessage: true });
    expect(out).toContain("Run command: ls -la /tmp");
  });

  it("supportsButtons=true → no slash-command list", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: true, canEditMessage: true });
    expect(out).not.toMatch(/^\s*\/(allow|decline|abort)/m);
  });

  it("supportsButtons=false → non-actionable fallback without ids, tokens, or commands", () => {
    const card: ApprovalCard = {
      ...BASE_CARD,
      approvalId: "approval-raw-123",
      actions: [
        { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
        { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
      ],
    };
    const out = formatPlainText(card, { supportsButtons: false, canEditMessage: true });
    expect(out).toContain("Decision controls are unavailable in this channel.");
    expect(out).not.toContain("approval-raw-123");
    expect(out).not.toContain("v1:ABCDEFGHIJKLMNOP");
    expect(out).not.toContain("v1:QRSTUVWXYZ234567");
    expect(out).not.toMatch(/^\s*\/(allow|decline|abort|deny|approve)/m);
  });

  it("supportsButtons=false → no slash-command list for any action in card", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: false, canEditMessage: true });
    expect(out).not.toContain("/allow_once");
    expect(out).not.toContain("/allow_session");
    expect(out).not.toContain("/decline");
    expect(out).not.toContain("/abort");
  });

  it("supportsButtons=false on decline-only card is still non-actionable", () => {
    const declineOnly: ApprovalCard = {
      ...BASE_CARD,
      kind: "permissions",
      actions: [{ kind: "decline" }],
    };
    const out = formatPlainText(declineOnly, { supportsButtons: false, canEditMessage: true });
    expect(out).toContain("Decision controls are unavailable in this channel.");
    expect(out).not.toContain("/decline");
    expect(out).not.toContain("/allow_once");
    expect(out).not.toContain("/allow_session");
    expect(out).not.toContain("/abort");
  });

  it("canEditMessage=true → 'this message will update' footer", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: true, canEditMessage: true });
    expect(out.toLowerCase()).toMatch(/update|edit/);
  });

  it("canEditMessage=false → 'follow-up' footer", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: true, canEditMessage: false });
    expect(out.toLowerCase()).toMatch(/follow.?up/);
  });

  it("renders a card with no actions (auth_token_refresh) without crashing", () => {
    const noActions: ApprovalCard = { ...BASE_CARD, kind: "auth_token_refresh", actions: [] };
    const out = formatPlainText(noActions, { supportsButtons: false, canEditMessage: false });
    expect(out).not.toContain("approval-7");
    // No slash-command lines because no actions.
    expect(out).not.toMatch(/^\s*\/(allow|decline|abort)/m);
  });

  it("uses English defaults (Codex Q1)", () => {
    const out = formatPlainText(BASE_CARD, { supportsButtons: false, canEditMessage: true });
    expect(out).toMatch(/Approval needed|Decision controls/);
  });

  it("status=resolved suppresses slash-command list (decision already made)", () => {
    const resolved: ApprovalCard = { ...BASE_CARD, status: "resolved" };
    const out = formatPlainText(resolved, { supportsButtons: false, canEditMessage: true });
    expect(out).not.toMatch(/^\s*\/(allow|decline|abort)/m);
    expect(out.toLowerCase()).toMatch(/resolved|decided/);
  });

  it("status=expired surfaces expiry, no commands", () => {
    const expired: ApprovalCard = { ...BASE_CARD, status: "expired" };
    const out = formatPlainText(expired, { supportsButtons: false, canEditMessage: true });
    expect(out.toLowerCase()).toContain("expired");
    expect(out).not.toMatch(/^\s*\/(allow|decline|abort)/m);
  });
});

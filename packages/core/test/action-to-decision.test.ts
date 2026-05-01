// T10 (Phase 2) — actionToDecision pure UI→decision-kind translator.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T10
//
// Pure function: ApprovalUiAction → ApprovalDecision (no protocol coupling).
// The decision-mapper (this file's sibling) maps the decision to a wire shape
// per ApprovalRequestKind; THIS function only does the UI→intent translation.
//
//   allow_once     → approved
//   allow_session  → approved_for_session
//   decline        → denied
//   abort          → abort

import { describe, expect, it } from "vitest";
import { actionToDecision } from "../src/action-to-decision.js";

describe("actionToDecision (T10)", () => {
  it("maps allow_once → approved", () => {
    expect(actionToDecision({ kind: "allow_once" })).toEqual({ kind: "approved" });
  });
  it("maps allow_session → approved_for_session", () => {
    expect(actionToDecision({ kind: "allow_session" })).toEqual({
      kind: "approved_for_session",
    });
  });
  it("maps decline → denied", () => {
    expect(actionToDecision({ kind: "decline" })).toEqual({ kind: "denied" });
  });
  it("maps abort → abort", () => {
    expect(actionToDecision({ kind: "abort" })).toEqual({ kind: "abort" });
  });
});

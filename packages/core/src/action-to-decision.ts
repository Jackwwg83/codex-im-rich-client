// T10 (Phase 2) — pure UI→decision-kind translator (D11 / F11).
//
// Decoupled from any protocol method literal: maps an ApprovalUiAction
// (the UI-layer button taxonomy) to an ApprovalDecision (the broker-layer
// intent enum). The decision-mapper sibling then maps that decision +
// the pending record's ApprovalRequestKind to a wire shape.
//
// Why a separate function: the daemon wire-up subscriber attaches an
// ActorPolicy + decision intent to each card BEFORE the wire shape is
// known (decision-mapper needs a record; the daemon just has a button
// click). Splitting the translation lets the daemon route purely on
// intent, with the wire-shape mapping happening only inside resolve().

import type { ApprovalDecision, ApprovalUiAction } from "./types.js";

export function actionToDecision(action: ApprovalUiAction): ApprovalDecision {
  switch (action.kind) {
    case "allow_once":
      return { kind: "approved" };
    case "allow_session":
      return { kind: "approved_for_session" };
    case "decline":
      return { kind: "denied" };
    case "abort":
      return { kind: "abort" };
  }
}

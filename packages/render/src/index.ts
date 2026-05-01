// @codex-im/render — public surface (T13 skeleton).
//
// Phase 2 fills this in incrementally:
//   - T14  RichBlock discriminated union (text / approval / unknown);
//          ApprovalCard shape; ApprovalUiAction (re-exported type-only
//          from @codex-im/core, which is the canonical home).
//   - T15  project-approval.ts — switches on ApprovalRequestKind from
//          @codex-im/core (NOT on protocol method strings) to render
//          a per-kind ApprovalCard.
//   - T16  redact-aware projection helpers.
//   - T17  plain-text capability fallback.
//
// Method-literal boundary (CLAUDE.md F1): this package MUST NOT contain
// any of the 9 ServerRequest method strings. Only `approval-broker.ts`
// (DispatchTable) and `approval-request-kind.ts` (METHOD_TO_KIND) in
// @codex-im/core may. Renderer switches on the classifier kind.
//
// T13 keeps this file as a placeholder so `pnpm typecheck` passes
// against the empty package; T14 lands the first real export.

export const __renderPackagePresent = true;

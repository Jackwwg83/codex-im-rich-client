// Phase 2 T2 — ApprovalRequestKind classifier (D18 / F1 / Codex round-1 P0-1).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §1 D18 + §5 T2
//
// Maps raw ServerRequest method strings → method-free `ApprovalRequestKind`.
// The classifier is the ONLY Phase 2 production source file allowed to
// contain raw approval server-request method literals (Phase 2 P2.9
// grep-guard exemption). Renderer (`@codex-im/render/src/project-approval.ts`),
// decision mapper (`@codex-im/core/src/decision-mapper.ts`), channel
// adapter (`@codex-im/channel-core/src/**`), and IM adapters all switch on
// `ApprovalRequestKind`, never on raw protocol method strings.
//
// Why this boundary matters:
//   - When codex 0.126 (or any future bump) renames or adds an approval
//     method, the change lands in ONE file (this one) instead of every
//     downstream consumer that ad-hoc-matched the method string.
//   - The 9 known method strings come from the Phase 1 `DispatchTable` in
//     `packages/core/src/approval-broker.ts` (lines 113-140), which is
//     validated as exhaustive over `ServerRequest["method"]` (the
//     ts-rs-generated union from
//     `packages/codex-protocol/src/generated/ServerRequest.ts`) via the
//     `_ExhaustiveDispatch` type-level guard. The classifier table below
//     mirrors those 9 keys; if codex adds a 10th method, the dispatch
//     table fails to compile FIRST, then this file is updated alongside
//     the new arm.
//
// Unknown-method behavior (fail-closed):
//   Any method not in the 9-entry table returns `"unknown"`. Downstream
//   `ApprovalBroker.#handle` treats `"unknown"`-classified pending requests
//   as wire-level unsupported (-32601), and renderer-defensive paths
//   produce a decline-only `ApprovalCard` (per plan §0.4 redline + T16.3).

import type { ServerRequest } from "@codex-im/protocol";

/**
 * Method-free classification of an approval server-request. Renderer,
 * decision mapper, channel adapter, and downstream IM code switch on
 * this kind — never on raw protocol method strings (see file header).
 *
 * 10 variants. The 9 known kinds map 1:1 to the 9 entries in
 * `METHOD_TO_KIND`; `"unknown"` is the fail-closed default for any
 * unrecognized method (e.g. a future codex method added between bumps,
 * a malformed wire frame, or a synthetic test name).
 */
export type ApprovalRequestKind =
  | "command_execution"
  | "file_change"
  | "permissions"
  | "tool_user_input"
  | "tool_call"
  | "mcp_elicitation"
  | "legacy_apply_patch"
  | "legacy_exec_command"
  | "auth_token_refresh"
  | "unknown";

/**
 * The single approved home for raw ServerRequest method-name literals
 * outside `packages/core/src/approval-broker.ts` (Phase 1 DispatchTable).
 *
 * Type shape: `as const satisfies Record<ServerRequest["method"], ...>`
 * — using the generated `ServerRequest["method"]` union as the key
 * constraint adds a load-bearing compile-time guard: if codex 0.126+ adds
 * a 10th ServerRequest variant, this declaration fails to compile until
 * the new method is added to this table. Without that, the table would
 * silently fail to classify the new method (always returning "unknown")
 * and downstream code would lose visibility into a new approval kind.
 *
 * The value type excludes `"unknown"` because every entry in this table
 * is, by construction, a known method. The `"unknown"` kind is reserved
 * for the fall-through branch in `classifyApprovalRequest` — methods
 * absent from the table.
 *
 * Note: keys are sorted by approval-broker.ts DispatchTable order so a
 * future maintainer can diff the two files and verify lock-step coverage.
 */
const METHOD_TO_KIND = {
  "item/commandExecution/requestApproval": "command_execution",
  "item/fileChange/requestApproval": "file_change",
  "item/permissions/requestApproval": "permissions",
  "item/tool/requestUserInput": "tool_user_input",
  "item/tool/call": "tool_call",
  "mcpServer/elicitation/request": "mcp_elicitation",
  applyPatchApproval: "legacy_apply_patch",
  execCommandApproval: "legacy_exec_command",
  "account/chatgptAuthTokens/refresh": "auth_token_refresh",
} as const satisfies Record<ServerRequest["method"], Exclude<ApprovalRequestKind, "unknown">>;

export type IMRoutableApprovalMethod = keyof typeof METHOD_TO_KIND;

export const IM_ROUTABLE_APPROVAL_METHODS = Object.freeze(
  Object.keys(METHOD_TO_KIND) as IMRoutableApprovalMethod[],
);

/**
 * Classify a raw ServerRequest method string into an `ApprovalRequestKind`.
 *
 * This is the ONLY function in Phase 2 production source (outside the
 * Phase 1 broker `DispatchTable`) that reads raw method strings.
 * Downstream consumers must call this once at the broker boundary and
 * carry the kind forward; ad-hoc method-string matching anywhere else
 * is a redline violation enforced by the `no-method-literals` grep guard
 * (T20).
 *
 * Behavior:
 *   - Known method (one of the 9 in `METHOD_TO_KIND`) → matching kind.
 *   - Any other input (synthetic test method, future-codex method,
 *     malformed wire frame, empty string) → `"unknown"`.
 *
 * `Object.hasOwn` is used (instead of `in` or property access) to reject
 * prototype-chain keys like `"toString"` or `"constructor"` — defense
 * against a wire frame whose method happened to match a built-in property
 * name. Same defensive pattern as the Phase 1 broker `#handle`
 * (`packages/core/src/approval-broker.ts:431`).
 */
export function classifyApprovalRequest(method: string): ApprovalRequestKind {
  if (Object.hasOwn(METHOD_TO_KIND, method)) {
    return METHOD_TO_KIND[method as keyof typeof METHOD_TO_KIND];
  }
  return "unknown";
}

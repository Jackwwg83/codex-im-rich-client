// Phase 1 core — public type surface.
//
// Phase 1 (T5) shipped:
//   ApprovalDecision  — IM-layer outcome the broker maps to wire-level
//                       responses (per-method response shape varies, see
//                       05-CODEX-APP-SERVER-PROTOCOL.md §4.1).
//   ApprovalActor     — Phase 2 forward-compat slot (P1-1 from
//                       plan-eng-review). Phase 1 callers always pass
//                       null; the type already admits the system + im
//                       shapes so Phase 2 doesn't have to migrate
//                       existing audit rows.
//   ApprovalRecord    — broker bookkeeping for pending / resolved /
//                       expired / transport_lost approvals.
//   SecurityPolicy    — Phase 1 noop interface; Phase 3 fills in the
//                       white-list / deny-pattern / Computer-Use policy.
//
// Logic-bearing additions (single-handler invariant, exhaustive method
// dispatch table, per-method v2 response mappers, transport-loss
// idempotence) land in T9a + T9b.
//
// Phase 2 (T6) additions (D11 / D12 / D19 / D20):
//   Target                  — IM platform addressing for ResolveApprovalInput
//                             and ActorPolicy. Lives in core (canonical home);
//                             channel-core T18 re-exports type-only.
//   ApprovalUiAction        — UI-side decision enum (allow_once / allow_session /
//                             decline / abort). Lives in core (canonical home);
//                             render T14 re-exports type-only. T10 decision-
//                             mapper translates ApprovalUiAction → wire shape.
//   PendingApprovalSnapshot — public read-API shape returned by listPending /
//                             getPending. Includes expiresAt.
//   ResolveApprovalInput    — broker.resolve() input. Requires target +
//                             callbackNonce per D19 actor-binding redline.
//   ResolveApprovalResult   — ok-or-error discriminated.
//   ResolveError            — 9-kind discriminated union covering every
//                             documented failure mode (round-3 P1-1 fix).
//   ActorPolicy             — bindActorPolicy storage shape (D19).
//   BindResult / BindError  — bindActorPolicy outcome (D19).
//   ApprovalRecord          — extended with `expiresAt: Date` (D20: resolve()
//                             checks expiry internally, doesn't depend on
//                             expirePending sweeper).

/**
 * Decision the IM layer emits when the user resolves an approval.
 *
 * The broker (T9a/T9b) maps these to wire-level response shapes that
 * vary per method. Per 05-PROTOCOL §4.1, the legacy patch and exec
 * approval requests return { decision: ReviewDecision } but the v2
 * *RequestApproval methods may return method-specific shapes — see
 * packages/codex-protocol/src/generated/v2/*RequestApprovalResponse.ts
 * (now exposed via the @codex-im/protocol facade per Pre-2). The exact
 * wire method names live only in packages/core/src/approval-broker.ts
 * (Codex T9a review medium-2 — boundary discipline).
 */
export type ApprovalDecision =
  | { kind: "approved" }
  | { kind: "approved_for_session" }
  | { kind: "denied"; reason?: string }
  | { kind: "abort" };

/**
 * Forward-compat slot for the IM actor that resolved the approval.
 *
 * Phase 1 callers always pass null (no IM layer yet). Phase 2 fills in
 * { kind: "im", platform, userId, chatId? } from the inbound action.
 * The system kind is reserved for non-IM-driven resolutions:
 *   - transport_lost (T11b): supervisor auto-fails pending approvals
 *   - expired         (T9b): expirePending() sweeps stale records
 *   - bootstrap       (Phase 3): security policy denies before user sees
 *
 * Putting all three kinds in the type now prevents a Phase 2 audit
 * migration. plan-eng-review P1-1.
 */
export type ApprovalActor =
  | null
  | { kind: "system"; reason: string }
  | { kind: "im"; platform: string; userId: string; chatId?: string };

/**
 * UI-side decision enum the renderer surfaces on an `ApprovalCard`.
 * Phase 2 D11. Distinct from `ApprovalDecision` (the wire-mapping enum
 * used by the broker's per-method mapper). The translation happens
 * inside core via `actionToDecision` + `mapDecisionForPending` (T10).
 *
 * Renderer / channel-adapter / IM consumers switch on this kind, never
 * on raw protocol method strings.
 *
 * Home rationale: lives in `@codex-im/core` (T6) even though plan §2.2
 * sketched render as the home — render (T13/T14) doesn't exist yet at
 * T6 time. Render T14 re-exports type-only from core; same pattern as
 * Target below. Type-only imports don't create runtime deps, so
 * Codex F13 ("channel-core has NO @codex-im/core runtime dep") is
 * preserved (channel-core T18 also imports type-only).
 */
export type ApprovalUiAction =
  | { kind: "allow_once" }
  | { kind: "allow_session" }
  | { kind: "decline" }
  | { kind: "abort" };

/**
 * IM platform addressing — identifies which chat / thread / topic
 * scope a card or action belongs to. Phase 2 D19 (`bindActorPolicy`)
 * uses this to bind a pending approval to its rendered card; resolve()
 * validates `input.target` against the bound policy and fails closed
 * on mismatch.
 *
 * Fields (per 06-IM-ADAPTERS §2):
 *   platform   — IM platform discriminator: "telegram" / "lark" /
 *                "dingtalk" / "fake" / future. Plain string (Phase 2
 *                doesn't pin a closed enum here — IM-platform list
 *                grows in Phase 4/5).
 *   chatId     — platform-native chat identifier.
 *   threadKey  — optional sub-thread / message-thread identifier
 *                where the platform supports it.
 *   topicId    — optional topic identifier (e.g. Telegram forum topics).
 *
 * Home rationale: same as ApprovalUiAction — channel-core T18 re-
 * exports type-only.
 */
export type Target = {
  readonly platform: string;
  readonly chatId: string;
  readonly threadKey?: string;
  readonly topicId?: string;
};

/**
 * Broker's record of one approval round-trip. Exactly four lifecycle
 * states; resolved/expired/transport_lost are terminal.
 */
export type ApprovalRecord = {
  /** Stable internal id (broker-assigned; survives codex restarts). */
  id: string;
  /** The wire id codex sent on the server-initiated request. */
  appServerRequestId: string | number;
  /**
   * Wire method name. Per 05-PROTOCOL §4 redline, the broker MUST read
   * this from the generated ServerRequest union and never hardcode it
   * outside @codex-im/core. T5's type cannot enforce that on its own
   * (codex outside-voice T5 review #3); the constraint is enforced by:
   *   - T9a's exhaustive Record<ServerRequest["method"], DispatcherSpec>
   *   - T9b's repo-wide grep guard over packages/{app-server-client,
   *     codex-runtime,daemon,cli}/src/** for approval method literals
   */
  method: string;
  /** Verbatim params from the wire frame (audit + cross-version compat). */
  params: unknown;
  /**
   * Lifecycle:
   *   pending         — awaiting decision
   *   resolved        — user (or system) decided; decision is set
   *   expired         — sat past timeout; auto-denied per D6 spirit
   *   transport_lost  — supervisor saw transport close; auto-denied (D6)
   *
   * The shape doesn't encode the (status, decision) correlation that
   * T9b enforces behaviorally — i.e. terminal statuses (resolved /
   * expired / transport_lost) MUST have decision + decidedAt set, and
   * pending MUST NOT. Codex outside-voice T5 review #4 flagged this as
   * a plan-compatible gap; T9b's broker-resolve and broker-expire paths
   * are the load-bearing enforcement.
   */
  status: "pending" | "resolved" | "expired" | "transport_lost";
  /** Phase 1: always null. Phase 2: filled in on resolve(). */
  actor: ApprovalActor;
  createdAt: Date;
  /**
   * Phase 2 D20: when this pending approval expires. `resolve()` checks
   * `Date.now() >= expiresAt.getTime()` BEFORE accepting any decision —
   * an expired approval fails closed even if the periodic
   * `expirePending()` sweep has not run. The broker sets this at
   * #handle-time as `createdAt + ttlMs` (default 30 min, broker-
   * constructor configurable).
   *
   * Round-3 deep-review P1-4: D20's resolve() emits
   * `approval.unknown_approval_id` for missing-id (NOT
   * `approval.unsupported_method`); `approval.expired` is the
   * lazy-expire-in-resolve audit kind.
   */
  expiresAt: Date;
  decidedAt?: Date;
  decision?: ApprovalDecision;
};

/**
 * Phase 1 noop sentinel. Phase 3 widens this into a discriminated
 * union, e.g.:
 *
 *   export type SecurityPolicy =
 *     | { readonly version: "phase1-noop" }
 *     | { readonly version: "phase3"; allowed: ...; deny: ...; ... };
 *
 * A `type` alias is used (not an `interface`) precisely so Phase 3 can
 * extend by adding a union arm without changing T5 callers — codex
 * outside-voice T5 review #2.
 *
 * Keeping the noop sentinel here in T5 lets T9a / T9b stub it out via
 * dependency injection (rather than a `null` SecurityPolicy field that
 * Phase 3 would have to reshape).
 */
export type SecurityPolicy = {
  readonly version: "phase1-noop";
};

// ─── Phase 2 T6 additions (D11 / D12 / D19 / D20) ──────────────────────────
//
// The types below are public-surface contracts for T7 (broker
// `#pendingById` + emitters), T9 (bindActorPolicy), T10 (decision
// mapper), and T11 (broker.resolve()). T6 ships the types only — no
// implementation logic — so downstream tasks can be written against a
// stable type contract.

/**
 * Public read-API shape for a pending approval. Returned by
 * `broker.listPending()` and `broker.getPending(approvalId)` (T7,
 * Phase 2 D12). Status filtering happens at the broker boundary —
 * snapshots returned here are always status="pending"; terminal-state
 * lookups happen via the broker's internal `#pendingById` (resolve()
 * uses that internal lookup directly, NOT this snapshot API).
 *
 * All fields are `readonly` — defensive copy semantic at the public
 * boundary. Mutation has no effect on broker state.
 */
export type PendingApprovalSnapshot = {
  /** Stable broker-assigned id (`approval-${appServerRequestId}`). */
  readonly id: string;
  /** Wire id codex sent on the server-initiated request. */
  readonly appServerRequestId: string | number;
  /**
   * Wire method name (verbatim from the server-request). Renderer must
   * NOT switch on this — it consumes `ApprovalRequestKind` from
   * `classifyApprovalRequest(method)`. Snapshot keeps the raw method
   * for audit / cross-version-compat purposes only.
   */
  readonly method: string;
  /** Verbatim params from the wire frame. Caller owns interpretation. */
  readonly params: unknown;
  readonly createdAt: Date;
  /**
   * D20: when the pending approval expires. Renderer uses this to display
   * a countdown / disable buttons past expiry; resolve() validates
   * server-side regardless.
   */
  readonly expiresAt: Date;
};

/**
 * Input to `broker.resolve()` (T11). Phase 2 D19 added required
 * `target` + `callbackNonce` so resolve() can validate against the
 * binding installed by `bindActorPolicy()` and fail closed on
 * actor / target / nonce mismatch.
 *
 * Why each field is required:
 *   approvalId      — which pending approval to resolve.
 *   decision        — UI-side action (allow_once / allow_session /
 *                     decline / abort). Mapper translates to wire shape.
 *   actor           — who clicked. NonNullable because resolve() requires
 *                     a real actor (system-driven settles use
 *                     expirePending / failPendingAsTransportLost paths,
 *                     not resolve()).
 *   target          — IM scope the click came from. Validated against
 *                     the bound policy's target.
 *   callbackNonce   — bound to the rendered card. Validated against
 *                     the bound policy's nonce. Mismatch → stale_callback.
 */
export type ResolveApprovalInput = {
  readonly approvalId: string;
  readonly decision: ApprovalUiAction;
  readonly actor: NonNullable<ApprovalActor>;
  readonly target: Target;
  readonly callbackNonce: string;
};

/**
 * Discriminated error union for `broker.resolve()` outcomes (round-3
 * P1-1 fix: 9 kinds, not 8 — `binding_required` was added per D19).
 *
 * Privacy posture (round-3 P2-2-adjacent design):
 *   `wrong_actor`, `wrong_target`, and `stale_callback` carry NO
 *   `expected` payload — leaking the bound state would defeat the
 *   purpose. Caller already knows what they sent. T11 audit emit
 *   captures the full diagnostic context.
 *   `already_resolved` carries `priorDecision` because the caller
 *   typically wants to display "already approved" / "already declined".
 *   `expired` carries timestamps (caller already knows them).
 *   `unsupported_decision` carries `method + reason` for debugging
 *   (the mapper's "unsupported (decision, kind) pair" diagnostic).
 *   `binding_required` is bare — operator/daemon-wireup bug; nothing
 *   to surface beyond "you didn't call bindActorPolicy first".
 */
export type ResolveError =
  | { kind: "unknown_approval_id" }
  | { kind: "already_resolved"; priorDecision: ApprovalDecision }
  | { kind: "expired"; createdAt: Date; expiredAt: Date }
  | { kind: "transport_lost"; lostAt: Date }
  | { kind: "wrong_actor" }
  | { kind: "wrong_target" }
  | { kind: "stale_callback" }
  | { kind: "binding_required" }
  | { kind: "unsupported_decision"; method: string; reason: string };

/**
 * Result discriminated union for `broker.resolve()`. Plan D12.
 *
 * `ok` carries `appliedAt` so the caller can audit/log the wall-clock
 * time the broker decided to settle. The wire response to codex is
 * sent asynchronously via the existing `#handle` await chain (D12 /
 * round-2 R-A2); `appliedAt` is the moment broker.resolve() decided
 * to win the settleOnce race, NOT the moment codex received the
 * wire response.
 */
export type ResolveApprovalResult =
  | { kind: "ok"; appliedAt: Date }
  | { kind: "error"; error: ResolveError };

/**
 * Per-card actor-binding policy installed by `broker.bindActorPolicy()`
 * (T9, Phase 2 D19). The daemon wire-up's onPendingCreated handler
 * computes the policy synchronously BEFORE invoking adapter.sendCard,
 * so the bound state exists by the time any user click can arrive.
 *
 * Validation in resolve():
 *   - input.actor must be assignable to one of `allowedActors` (deep
 *     structural equality on platform + userId; chatId is matched per
 *     target rather than per actor).
 *   - input.target must equal `target` (platform + chatId + threadKey +
 *     topicId all matching).
 *   - input.callbackNonce must equal `callbackNonce`.
 */
export type ActorPolicy = {
  readonly allowedActors: readonly NonNullable<ApprovalActor>[];
  readonly target: Target;
  readonly callbackNonce: string;
};

/**
 * Discriminated error union for `broker.bindActorPolicy()` outcomes.
 * Phase 2 D19. Three operator-bug kinds:
 *   unknown_approval_id  — the approvalId doesn't exist in `#pendingById`.
 *   not_pending          — the approval is in a terminal state already
 *                          (resolved / expired / transport_lost). Re-binding
 *                          a settled approval is a daemon wire-up bug.
 *   conflicting_policy   — re-bind with a different policy than the one
 *                          already stored. Idempotent rebind with the
 *                          SAME policy succeeds; with a DIFFERENT policy
 *                          fails (could be a stale handler subscriber
 *                          racing the daemon).
 */
export type BindError =
  | { kind: "unknown_approval_id" }
  | { kind: "not_pending" }
  | { kind: "conflicting_policy" };

/**
 * Result discriminated union for `broker.bindActorPolicy()`. Plan D19.
 */
export type BindResult = { kind: "ok" } | { kind: "error"; error: BindError };

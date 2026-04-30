# @codex-im/core

Phase 1 product core — ApprovalBroker, SecurityPolicy (Phase 3),
SessionRouter (Phase 2), CommandRouter (Phase 2). **No IM adapter, no
storage, no Computer Use.**

## T5 status: skeleton only

Currently exposes type primitives the upcoming ApprovalBroker (T9a/T9b)
will consume:

- `ApprovalDecision` — the four IM-layer outcomes: `approved`,
  `approved_for_session`, `denied`, `abort`. The broker maps these to
  per-method v2 response shapes (per 05-PROTOCOL §4.1; the legacy v1
  applyPatchApproval / execCommandApproval shapes share a
  `{ decision: ReviewDecision }` envelope, but the v2 `*RequestApproval`
  responses may differ).
- `ApprovalActor` — Phase 2 forward-compat slot. Phase 1 always sets
  `actor: null`; the `system` and `im` kinds are reserved for Phase 2
  to fill in without an audit-row migration.
- `ApprovalRecord` — broker bookkeeping with four lifecycle states.
- `SecurityPolicy` — Phase 1 noop interface; Phase 3 widens.

No runtime logic yet. T9a + T9b land the actual broker.

## Boundaries (don't violate)

- The broker is the **only** module allowed to call
  `client.setServerRequestHandler` (plan §1 D7). All other Phase 1
  modules go through the broker.
- Approval method-name string literals are allowed **only** in this
  package (and in generated code under `@codex-im/protocol`). The
  build-time grep guard added in T9b enforces this across
  `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`.
- Do NOT subscribe to `client.onNotification` here — that is
  `@codex-im/codex-runtime`'s `EventNormalizer`'s slot.
- Do NOT auto-approve any server request (CLAUDE.md redline).

## Tests

- `test/skeleton.test.ts` — type-level smoke (T5).
- `test/approval-broker.test.ts` — T9a single-handler invariant + happy-path dispatch.
- `test/approval-broker-dispatch.test.ts` — T9a per-method dispatch over the captured fixture.
- `test/approval-broker-fixture.test.ts` — T9b edges (timeout, throw, transport-loss).
- `test/dispatch-coverage.test.ts` — T9a exhaustive coverage of generated `ServerRequest` union.

All tests run via the default `pnpm test` unit project.

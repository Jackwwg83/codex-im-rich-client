# Phase 6 Plan v1 Review Response

Generated: 2026-05-03

Review report: `docs/phase-6/plan-v1-codex-review.md`

Verdict: `APPROVE_WITH_CHANGES`

## P1 Responses

### P1-1: Precise broker integration for `item/tool/call`

Closed in plan v1.1.

Changes:

- Added "Broker Integration" section to
  `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`.
- Explicitly forbids daemon code from calling
  `registerHandler("item/tool/call", ...)`.
- Requires a broker-owned typed API such as
  `registerDynamicToolCallHandler(handler)` so raw ServerRequest method
  literals stay in approved core homes.
- States provider execution must not use current pending-mode `tool_call`
  mapping, because that path only supports decline.
- States sensitive steps must use a deliberate broker-owned synthetic approval
  API or fail closed until that API exists.

### P1-2: JAC-96 was sequenced too early

Closed in plan v1.1.

Changes:

- JAC-96 is now scoped to "normal prompt cannot create Computer Use intent".
- Full "dynamic tool call without active `/cu` session fails closed" proof moved
  to JAC-97 after JAC-163/JAC-97 introduce the broker-owned handler and session
  registry.

## P2 Responses

### P2-1: JAC-163 capability evidence exit criteria

Closed in plan v1.1 and capability evidence doc.

JAC-163 now requires either:

- observed namespace/tool names, argument schema, redaction requirements, and a
  controlled trace; or
- a recorded blocker stating real provider capability is not verified.

### P2-2: Unknown/new app behavior

Closed in plan v1.1.

`require_approval_for_new_app` was replaced with `unknown_app_policy = "deny"`.
Unknown or unlisted apps are denied until the config allowlist is updated.

### P2-3: Sensitive-step cards must not expose allow-session

Closed in plan v1.1.

JAC-97 now has an explicit test target proving sensitive approval cards do not
include `allow_session`.

## Remaining Gate

Run plan v1.1 re-review. JAC-92 may start only if P1 findings are closed.


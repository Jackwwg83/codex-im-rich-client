# Phase 6 Plan v1.1 Codex Re-review Prompt

You are an outside-voice reviewer for the Codex IM Rich Client repo.

Review scope:

- Base tag: `phase-5-dingtalk-adapter-complete`
- Current branch: `codex/phase-6-computer-use`
- Plan v1.1: `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`
- Prior review: `docs/phase-6/plan-v1-codex-review.md`
- Review response: `docs/phase-6/plan-v1-review-response.md`
- Live status: `docs/handoffs/phase6-live-status.md`
- Capability evidence: `docs/phase-6/computer-use-capability-evidence.md`

Prior verdict:

- `APPROVE_WITH_CHANGES`
- P1-1: missing precise broker integration design for `item/tool/call`.
- P1-2: JAC-96 sequenced too early for full tool-call gate proof.
- P2-1: JAC-163 needed explicit provider/capability exit criteria.
- P2-2: unknown/new app behavior conflicted.
- P2-3: sensitive-step cards needed explicit no-allow-session test.

What changed in v1.1:

- Added "Broker Integration" section.
- Forbids daemon raw `registerHandler("item/tool/call", ...)`.
- Requires broker-owned typed API such as
  `registerDynamicToolCallHandler(handler)`.
- States provider execution must not rely on current pending-mode `tool_call`
  mapping.
- Requires sensitive steps to use a deliberate broker-owned synthetic approval
  API or fail closed until that API exists.
- Re-scoped JAC-96 to normal prompt cannot create Computer Use intent.
- Moved full dynamic tool gate/no-active-session proof to JAC-97.
- Expanded JAC-163 exit criteria: namespace/tool names, argument schema,
  redaction requirements, controlled trace or recorded blocker.
- Replaced `require_approval_for_new_app` with `unknown_app_policy = "deny"`.
- Added JAC-97 test target that sensitive-step cards cannot expose
  `allow_session`.

Please re-review only whether the P1/P2 findings are closed and whether JAC-92
may start.

Required output:

1. Verdict: `GO`, `GO_WITH_LOW_NITS`, `APPROVE_WITH_CHANGES`, or `REJECT`.
2. Remaining P0/P1/P2 findings, if any.
3. Whether original P1/P2 findings are closed.
4. Whether JAC-92 parser-only implementation may start.


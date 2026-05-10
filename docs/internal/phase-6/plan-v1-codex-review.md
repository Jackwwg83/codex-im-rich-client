Verdict: `APPROVE_WITH_CHANGES`

**P0 Findings**
None.

**P1 Findings**
1. The plan needs a precise broker integration design for `item/tool/call`.
   The generated protocol supports `item/tool/call` as the dynamic tool boundary, but the current broker either default-rejects it or routes it through pending approval mode, where `tool_call` only maps `decline` to `{ contentItems: [], success: false }` ([approval-broker.ts](/Users/jackwu/projects/codex-im-rich-client/packages/core/src/approval-broker.ts:483), [decision-mapper.ts](/Users/jackwu/projects/codex-im-rich-client/packages/core/src/decision-mapper.ts:60)). A Phase 6 provider path cannot safely rely on that pending-mode path.

   Required plan change: state that Computer Use dynamic calls are handled through a central broker-owned handler/API, not raw daemon `registerHandler("item/tool/call", ...)`, because raw ServerRequest method literals are only allowed in the broker and approval-kind table ([AGENTS.md](/Users/jackwu/projects/codex-im-rich-client/AGENTS.md:119), [AGENTS.md](/Users/jackwu/projects/codex-im-rich-client/AGENTS.md:167)). Also specify how sensitive-step approval is created: either add a deliberate core synthetic approval API, or deny sensitive calls until that API exists.

2. JAC-96 is sequenced too early for the full claim it makes.
   The plan says JAC-96 will prove `item/tool/call` without an active session is rejected and audited ([plan](/Users/jackwu/projects/codex-im-rich-client/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:319)), but the registry/gate that makes that meaningful is introduced later in JAC-97 ([plan](/Users/jackwu/projects/codex-im-rich-client/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:344)).

   Required plan change: either move JAC-96 after JAC-97, or split it into an early parser/daemon invariant test and a later full tool-call gate test after the registry exists.

**P2 Findings**
1. `item/tool/call` is the right current protocol boundary, but not enough evidence for a real provider.
   Generated protocol confirms the method and dynamic params shape ([ServerRequest.ts](/Users/jackwu/projects/codex-im-rich-client/packages/codex-protocol/src/generated/ServerRequest.ts:18), [DynamicToolCallParams.ts](/Users/jackwu/projects/codex-im-rich-client/packages/codex-protocol/src/generated/v2/DynamicToolCallParams.ts:6)). The capability evidence correctly blocks real provider work, but JAC-163 should have explicit exit criteria: observed namespace/tool names, argument schema, redaction requirements, and a controlled trace or a recorded blocker.

2. Clarify unknown/new app behavior.
   The config has `require_approval_for_new_app = true` ([plan](/Users/jackwu/projects/codex-im-rich-client/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:161)), while the gate rejects apps that are “denied or not allowed” ([plan](/Users/jackwu/projects/codex-im-rich-client/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:210)). Pick one. For Phase 6, I recommend fail-closed deny unless explicitly allowlisted.

3. Add an explicit test that sensitive-step approval cards cannot expose `allow_session`.
   The plan says ask-always/no allow-session ([plan](/Users/jackwu/projects/codex-im-rich-client/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:222)), but the JAC-97 test should assert the action surface, not only provider reachability.

**Answers**
1. The two-gate design closes the normal-prompt prompt-injection path if the second gate is a real broker/provider gate and not just prompt text.
2. `item/tool/call` is the right boundary from current generated protocol. A stronger capability spike is required before any real `codex-app` provider, not before JAC-92.
3. `ComputerUseSessionRegistry` belongs at the daemon/provider boundary because it depends on IM target, actor, project, route, thread, and turn lifecycle. Core should hold pure parser/policy/prompt types plus broker-owned method registration.
4. Denied apps before approval and sensitive ask-always are correct.
5. Sequencing is mostly safe after the JAC-96 split/move and the broker integration clarification.

JAC-92 may start after the P1 plan changes are patched into JAC-91. Parser-only work is safe: no provider, no desktop action, no protocol handler.
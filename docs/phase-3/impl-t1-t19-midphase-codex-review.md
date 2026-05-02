Verdict: APPROVE_WITH_CHANGES

Findings:
- [P1] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:953) — Project-level ACL is not enforced
  `SecurityPolicy` stores project ACL shape but only checks global user/chat lists, and `/use` binds any configured project without a project-aware policy check. This violates Phase 3 G2: unauthorized user/chat/project combinations must not trigger turns.
  Required change: add/enforce project-aware policy before `/use` bind and before prompt routing from restored bindings. Add tests for globally allowed user/chat denied on a specific project.

- [P1] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:448) — Deny-pattern command approvals bypass SecurityPolicy
  The pending-approval path only calls `checkApprovalDestination`; `SecurityPolicy.checkCommand()` exists but is not used for `command_execution` approvals. A denied command can still render allow buttons and be approved.
  Required change: classify command approvals, extract the command, run `checkCommand`, and route deny/admin-required through normal broker decline before token issue/render. Add the T-Sec-10 regression test.

- [P1] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:657) — Callback target deep-equality is missing
  The daemon validates message id/chat id, then passes `record.target` to `broker.resolve`. It never compares `action.target` to the hydrated record target, so broker `wrong_target` cannot catch platform/thread/topic target drift. This misses the plan’s T-Sec-3 requirement.
  Required change: deep-equal `record.target` vs inbound `target` before `broker.resolve`; fail closed with no CAS on mismatch. Cover platform/threadKey/topicId mismatches.

- [P1] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:534) — Fire-and-forget action/prune paths lack failure containment
  `onAction` discards the promise from `#handleInboundAction`, which has no top-level catch. If `answerAction`, `updateCard`, repo CAS, or broker code throws, it can become an unhandled rejection. In the accepted path, an ack/edit failure also skips sibling revocation after broker accepted the decision.
  Required change: contain action-handler errors, isolate post-resolve cleanup so sibling revocation still runs, and catch/log/audit prune sweep failures from the interval path.

- [P2] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:1027) — Stuck-issued sweep can drop the approval flag too early
  `revokeStuckIssued()` is batch-limited, but the daemon deletes the approval id from `#stuckIssuedApprovalIds` after any returned row. With `pruneBatchSize` below the number of issued action rows, remaining rows stay `issued` and will not be swept later.
  Required change: keep the approval id flagged until all old issued rows for that approval are gone, or revoke all rows for that approval atomically. Add a multi-action, `pruneBatchSize=1` test.

- [P2] [packages/daemon/src/daemon.ts](/Users/jackwu/projects/codex-im-rich-client/packages/daemon/src/daemon.ts:679) — Callback-level audit requirements are not wired
  The CAS-zero path force-marks used silently; the plan requires `audit.cas_unreachable_after_resolve`, and the attack table also names audit records for malformed/stale/policy-denied callback branches.
  Required change: add a daemon audit sink or explicitly wire existing `AuditRepository`/broker audit events for these branches before live adapter work.

Open Questions:
- What is the intended daemon-level audit dependency? `AuditRepository` exists, but `DaemonOptions` currently has no audit emitter/sink for callback-flow forensic events.

Positive Checks:
- No P0 findings.
- Scope is clean: no real Telegram adapter, no Lark/DingTalk, no Computer Use production flow, no public listener, and no CLI/TUI output parsing.
- D34 hash-only storage is implemented and tested; raw callback tokens do not persist to SQLite.
- D33 ordering is mostly correct: callback validation is read-only before `broker.resolve`, and bound→used CAS happens only after broker `ok`.
- D36, D40, D41, and D42 have good core coverage: policy auto-decline resolves through broker, single-approval transport loss exists, rawCallbackData/wirePayload boundary is in place, and synthetic events are appended before iterator completion.

Gate / Scope Notes:
- I reviewed HEAD `cbba712` with implementation through `49afab5`.
- I did not rerun `pnpm` gates because this session is read-only; even `git` emitted temp-cache permission warnings. Test inspection shows strong nominal T17/T19e coverage, but the findings above are not covered.

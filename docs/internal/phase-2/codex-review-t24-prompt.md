# Codex outside-voice review — Phase 2 T24 INTEGRATED (DEFERRED BACKFILL)

You are an independent reviewer running the deferred T24 integrated review across the entire range `phase-1-runtime-complete..phase-2-approval-im-surface-complete` (27 commits). The per-task T18-T22 backfill review just completed (verdict GO_WITH_LOW_NITS, 0 P0, 2 P1, 2 P2 — see `docs/phase-2/codex-review-t18-t22.md`). T24 is the higher-value integrated review: catch composition bugs that per-task reviews miss.

## Scope (the full Phase 2 diff)

Range: `phase-1-runtime-complete..phase-2-approval-im-surface-complete`
Plan: `docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md`

Commits (most recent first):
- 4ec2c51 docs(phase-2): live-status reflects tag-complete + Phase 3 implementation gate
- 3154f54 docs(phase-2): T24 deferred — record codex outside-voice backfill scope
- 0fa0c94 docs(phase-2): T23 close-out — handoff + roadmap + readme + todos + claude-md
- d452391 T22 Supervisor pre-attached-broker invariant (D16 / Codex Q6)
- 0a121e2 T21 full e2e (P2.10) — 14 paths + secondary-index stress + bounds
- 27c3c76 T20 method-literal grep guard scope extension
- acea679 T19 ChannelAdapter (D14) + TelegramShapeFakeChannelAdapter (D17)
- a08cc81 T18 channel-core skeleton + types + boundary tests (F13)
- 7f6b6a1 T13-T17 codex outside-voice review fixes (render package)
- 6e3516f T17 plain-text capability fallback
- 3f04f86 T16 project-approval per-kind projection
- 092e8dc T15 truncate + redact re-export
- e1993dd T14 RichBlock + ApprovalCard + ApprovalAction
- 4da5842 T13 render package skeleton
- 231f653 T7-T12 codex outside-voice review fixes (broker public surface)
- 704ed28 T12 fake e2e happy path
- 0a6a477 T11 broker.resolve centerpiece
- 34a3c2c T10 decision-mapper + actionToDecision
- 1b16471 T9 bindActorPolicy storage
- a2092c7 T8 enablePendingMode (D18 three-mode dispatcher)
- 9109e91 T7 broker public surface (#pendingById + emitters + #settleEntry)
- 4e95f50 T6 Phase 2 type surface
- 6530665 T5 audit emit applies redact
- bc7de48 T5 polish
- 782ecdb T4 redact relocated to core
- bd99dd1 T3 AuditEmitter + 12 kinds
- 89968ee T2 ApprovalRequestKind classifier

## Look hard for (composition / cross-task bugs)

P0 (would block 0.1.0-phase2-draft → 0.1.0-phase2 promotion):

1. Cross-task composition: how T7-T12 broker public surface interacts with T22 supervisor pre-attached invariant (in particular: does the broker's `attach()/reattach()/isAttached()` lifecycle match what `Supervisor.#spawnFresh` head-asserts?).
2. T20 grep guard scope: does the filesystem-walk allowlist correctly cover `packages/render/src/**`, `packages/channel-core/src/**`, `packages/core/src/decision-mapper.ts`? Are there legitimate ServerRequest method strings outside the two approved homes (`approval-broker.ts` DispatchTable, `approval-request-kind.ts` METHOD_TO_KIND)?
3. F13 channel-core boundary held end to end: zero runtime imports of `@codex-im/core`, `@codex-im/codex-runtime`, or `@codex-im/app-server-client` from `packages/channel-core/src/**`?
4. D11 wire-mapping: any path that emits the literal string `"approve"` (legacy v1 was `"approved"`; v2 is `"accept"`)?
5. D12 read-only snapshot: any path where `listPending()` / `getPending()` returns mutable internal state?
6. D15 secondary-index lock-step: any path where `#pendingById` and `#pending` can drift?
7. D19 actor binding: any path that grants approval permission without a prior `bindActorPolicy` call?
8. D20 lazy expiry: any settle path that bypasses the `Date.now() >= expiresAt` check inside `resolve()`?
9. D21 byte-identical `settleOnce`: any commit that modified `entry.settleOnce`'s body relative to the Phase 1 tag?
10. C-P1 unknown-snapshot defensive path: does the renderer's `projectAsRichBlock` return `kind: "unknown"` + `actions: [{kind: "decline"}]` + `target.riskLevel: "critical"` for `classifyApprovalRequest(method) === "unknown"`?

P1 (composition issues per-task review missed):

- T22's pre-attached-broker invariant interactions with Phase 1 supervisor cleanup (the Phase 1 test was updated; verify cleanup contract holds for OTHER spawn-failure paths too).
- T21 e2e rig's `disableAutoBind` test option leaking state across tests.
- TelegramShapeFakeChannelAdapter's module-scoped `_messageIdSeq` causing test isolation issues.
- channel-core `Target` vs core `Target` drift detection (T18-T22 already flagged this; check if any other duplicated-types issue exists).
- Audit + redact pipeline: redact applied at every audit emit boundary (no path that emits unredacted)?
- 12 enumerated `AuditEventKind` exhaustively used (no path emits a non-enumerated kind)?

P2 (style, JSDoc gaps, comment correctness, test gaps):
- Anything notable.

## Out of scope (do NOT re-flag)

- T2-T6, T7-T12 broker public surface, T13-T17 render — already reviewed and GO via `231f653` and `7f6b6a1` fix arcs.
- T18-T22 backfill review just completed; do not re-flag the 2 P1 + 2 P2 items already in `docs/phase-2/codex-review-t18-t22.md` (see that file for the list).
- The plan document itself (already polished through 3 round reviews).
- Phase 3 work (im-telegram, daemon wire-up, SecurityPolicy ACL, SQLite, launchd).

## Output format (strict)

```
VERDICT: GO | GO_WITH_LOW_NITS | NO_GO
SUMMARY: <one sentence>

P0 (blocks 0.1.0-phase2-draft → 0.1.0-phase2 promotion):
  - [file:line] <issue> — <why P0> — <suggested fix>
  (or "none")

P1 (fix on a phase-2-review-nits branch before promotion):
  - [file:line] <issue> — <why P1> — <suggested fix>
  (or "none")

P2 (nice-to-have):
  - [file:line] <issue> — <suggested fix>
  (or "none")

NOTES:
  - <anything notable about composition, regressions, redlines>
```

Read on disk; cite line numbers from the working tree.

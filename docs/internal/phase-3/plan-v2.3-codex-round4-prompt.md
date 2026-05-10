# Codex outside-voice review ROUND 4 — Phase 3 plan v2.3

You are the outside-voice reviewer for Phase 3 Plan v2.3, commit
`83bfd90` on branch `phase-3-planning`.

## Project boundary (do not violate)

This project is a **Codex App Server native IM Rich Client**. It must
NOT become a Codex CLI/TUI wrapper, terminal-output parser, OpenClaw
plugin, or generic LLM chat bot. Mac mini daemon controls codex via
Telegram (Phase 3) → Lark/DingTalk (Phase 4/5) → Computer Use (Phase 6).

## Review history (do not re-flag)

Convergence trajectory:

| Revision | Commit | Reviewer | Verdict | Findings |
|---|---|---|---|---|
| v1 | b60a67d | codex round 1 | REJECT | 6 P0 + 6 P1 + 3 P2 |
| v1 | b60a67d | gstack round 1 | APPROVE_WITH_CHANGES | 12 issues |
| v2 | ff1176b | gstack round 2 | APPROVE_WITH_CHANGES | 4 P1 + 4 P2, 0 P0 |
| v2.1 | 4edfd81 | codex round 2 | REJECT | 1 P0 + 5 P1 + 3 P2 |
| v2.2 | c606039 | codex round 3 | APPROVE_WITH_CHANGES | 0 P0 + 6 P1 + 3 P2 |
| **v2.3** | **83bfd90** | **codex round 4 (this review)** | **TBD** | **TBD** |

P0 count over revisions: 6 → 1 → 0 → (expected 0). v2.3 integrated
all 6 P1 + 3 P2 from codex round 3.

Do NOT re-flag findings already addressed in earlier revisions:

- The 6 round-1 codex P0s (all fixed in v2 — see plan v1 codex
  review at `docs/phase-3/plan-v1-codex-review.md`).
- The 4 gstack round-2 P1s (fixed in v2.1).
- The 1 P0 + 5 P1 + 3 P2 codex round-2 findings (fixed in v2.2 — see
  `docs/phase-3/plan-v2.1-codex-round2.md`).
- The 6 P1 + 3 P2 codex round-3 findings (claimed fixed in v2.3 —
  verify each, but don't re-flag the original v2.2 wording).

## Your job

You are reviewing **plan v2.3**. Verify two things:

1. **Each round-3 P1 and P2 is genuinely fixed in v2.3** (cite line
   refs from plan v2.3 text):

   **P1-1 D41 task plumbing**: §16.4b sub-block defines T-D41a /
   T-D41b / T-D41c / T-D41d. References to T18.1-T18.4 are gone.
   Existing T18 (Daemon.handleOnMessage) is unchanged. T-D41 tasks
   are sequenced before T16/T17.

   **P1-2 callbackNonce JSDoc drift**: §7 D41 amends
   `SendCardResult.callbackNonce` + `InboundAction.callbackNonce`
   JSDoc as "legacy fallback when wirePayload absent". T-D41c adds
   a JSDoc-stale assertion test that grep-checks the doc-string.

   **P1-3 duplicate_decision → already_resolved**: zero occurrences
   of `duplicate_decision` in plan; `already_resolved` is used
   consistently with priorDecision field surfaced. T17.12 mentions
   priorDecision in user message.

   **P1-4 CAS rowsAffected=0 semantics**: §10.3 step 5 "ok" branch
   now spells out: rowsAffected=0 unreachable defense-in-depth; on
   hit emit `audit.cas_unreachable_after_resolve` + force non-CAS
   UPDATE + still answerAction(ok:true) since broker accepted.

   **P1-5 §6 + D29 stale text**: §6 redline rewritten to mirror
   §10.3 (validation BEFORE broker.resolve; CAS only on ok). D29
   step 10 rewritten with explicit step ordering.

   **P1-6 D42 enqueue/drain**: §7 D42 sequence is `#enqueue(...)` →
   `#drain()` → `endOfStream()`. T6.7 has 5 tests including new (e)
   "waiter-already-blocked".

   **P2-1 stale v2/v2.1 refs**: T0.1-T0.8 sequencing updated for
   v2.3 round-4. §19 heading "(v2.3)".

   **P2-2 actor:null sketch**: §10.2 INSERT record sketch shows
   `actor_kind: 'im'` not `actor: null`.

   **P2-3 Keychain wrapper hardening**: T29a has `set -euo pipefail`
   + nonempty-token check + redacted `--dry-run` (length=N not
   value) + tests for empty-keychain + pipefail.

2. **NEW structural risks introduced by v2.3's edits**:

   - **T-D41 task plumbing**: are the 4 boundary tasks correctly
     ordered relative to T6.6 (core ApprovalUiAction extension) +
     T16/T17 (daemon wire-up that uses wirePayload + rawCallbackData)?
     Could T-D41a-d land out-of-order with the daemon tasks?

   - **T-D41b legacy-fallback JSDoc**: does it actually communicate
     to a future implementer that `callbackNonce` should NOT be used
     by production daemon code? Could a Phase 4/5 adapter author
     misinterpret the dual contract (production via rawCallbackData;
     legacy via callbackNonce) and reintroduce bind-after-send?

   - **CAS rowsAffected=0 unreachable**: is the audit
     `cas_unreachable_after_resolve` + force-update path actually
     reachable in tests? How would the test induce rowsAffected=0
     deterministically? The unreachable-by-design claim relies on
     Phase 2 broker's #settleEntry serialization — verify that
     claim is sound for the click-after-cleanup-of-stale-token
     edge case (e.g. user clicks RIGHT as the G9 sweep flips
     bound→expired).

   - **D42 #drain() between #enqueue and endOfStream**: does the
     existing Phase 1 EventNormalizer #drain() implementation
     handle a multi-event drain correctly? Could a synthetic
     event arrive at a parked waiter mid-drain? Could endOfStream's
     queue-empty check fire prematurely?

   - **§6 + D29 reordered text**: is the new ordering complete and
     consistent across §6, §7 D29 step 10, and §10.3? Any missed
     references? The redline at §6 is the most prominent guardrail
     text; downstream readers must see the same flow there as in
     §10.3.

   - **T29a Keychain wrapper**: `--dry-run` outputs `length=${#TOKEN}`.
     Is leaking the length itself a security concern (e.g. for
     known-token-length attacks)? Probably no for Telegram tokens
     (always similar length), but verify.

3. **Cross-section consistency**:
   - §7 D29 init-order steps 1-13 vs §16 T15.1-T15.8 — same gates?
   - §7 D33 token-issue flow vs §10.2 step list vs §16 T16.x — same
     field names?
   - §9 callback_tokens schema vs §7 D34 schema — single source of
     truth?
   - §7 D40 vs §16 T6.5 + T19e.4 — broker API consistent?
   - §7 D42 vs §16 T6.7 + T19d — EventNormalizer API consistent?
   - GSTACK REVIEW REPORT footer reflects rounds 1-4?

4. **Project redlines** still hold:
   - No raw `AppServerClient.request("...")` outside CodexRuntime.
   - No Telegram SDK / raw Update types / bot_token literal outside
     `packages/im-telegram/src/`.
   - Approval decisions go through `ApprovalBroker.resolve()` (or
     the new D40 API which still routes through `#settleEntry`).
   - SecurityPolicy runs BEFORE actionable buttons render
     (D33 step 0).
   - All security paths fail closed.
   - No tokens in plist / logs / fixtures / SQLite / docs.
   - No public TCP/UDP listener.
   - No Computer Use production flow in Phase 3.
   - No Lark/DingTalk in Phase 3.
   - No real implementation before review approval.

5. **Known non-plan blocker** (do not flag as plan defect):
   `pnpm protocol:check` fails on `phase-3-planning` because
   committed `CODEX_VERSION=0.125` vs local codex `0.128`. v2.3
   records this as T0.7 / R6.

## Files to read

Primary:
- `docs/superpowers/plans/2026-05-02-phase-3-plan.md` (v2.3 — 2759 lines)

Companion:
- `docs/phase-3/plan-v2-review-response.md` (full v1→v2.3 fix matrix)
- `docs/phase-3/plan-v2.2-codex-round3.md` (round-3 verdict on v2.2;
  the source of v2.3's fix list)
- `docs/phase-3/plan-v2.1-codex-round2.md` (round-2 verdict on v2.1)
- `docs/phase-3/plan-v2-gstack-round2-review.md` (gstack round-2 on v2)
- `docs/phase-3/plan-v1-codex-review.md` (round-1 on v1)

Project context:
- `CLAUDE.md`
- `01-PRD.md`, `02-TECHNICAL-DECISIONS.md`, `03-ARCHITECTURE.md`,
  `04-MODULE-DESIGN.md`, `06-IM-ADAPTERS.md`,
  `07-SECURITY-AND-COMPUTER-USE.md`, `08-DATA-MODEL.md`, `09-ROADMAP.md`
- `packages/core/src/approval-broker.ts`
- `packages/core/src/types.ts` (ApprovalActor / ApprovalUiAction;
  D41 amends here)
- `packages/channel-core/src/{adapter.ts,fake.ts,types.ts}`
  (D41 amends adapter contract + InboundAction)
- `packages/codex-runtime/src/event-normalizer.ts` (D42 adds
  endWithSynthetic here)

## Output format (strict)

```
VERDICT: APPROVE | APPROVE_WITH_CHANGES | REJECT
SUMMARY: <one sentence>

P0 (blocks Phase 3 T1 implementation start):
  - [section / file:line] <issue> — <why P0> — <suggested fix>
  (or "none")

P1 (required changes before T1):
  - [section / file:line] <issue> — <why P1> — <suggested fix>
  (or "none")

P2 (nice-to-have):
  - [section / file:line] <issue> — <suggested fix>
  (or "none")

NOTES:
  - Whether each round-3 codex finding is genuinely fixed in v2.3
    (cite line refs).
  - Whether v2.3 introduced any NEW structural risks not surfaced
    by earlier reviews.
  - Whether implementation can begin after this review's required
    changes are addressed.
```

Read on disk; cite section + line numbers from plan v2.3 (commit
`83bfd90`) and from referenced source files. No prose summaries
without line citations.

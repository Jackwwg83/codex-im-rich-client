# Codex outside-voice review ROUND 2 — Phase 3 plan v2.1

You are the outside-voice reviewer for Phase 3 Plan v2.1, commit
`4edfd81` on branch `phase-3-planning`.

## Project boundary (do not violate)

This project is a **Codex App Server native IM Rich Client**. It must
NOT become a Codex CLI/TUI wrapper, terminal-output parser, OpenClaw
plugin, or generic LLM chat bot. Mac mini daemon controls codex via
Telegram (Phase 3) → Lark/DingTalk (Phase 4/5) → Computer Use (Phase 6).

## Review history (do not re-flag)

**Round 1 on plan v1** (`b60a67d`):
- Codex outside-voice → REJECT, 6 P0 + 6 P1 + 3 P2 (callback identity,
  binding order, settlement semantics)
- gstack /plan-eng-review → APPROVE_WITH_CHANGES, 12 issues, 3 critical

**v1 → v2** (`ff1176b`): all 6 round-1 P0s + 12+ P1s integrated.
See `docs/phase-3/plan-v2-review-response.md` for the v1→v2 finding-to-fix matrix.

**Round 2 on plan v2** by gstack /plan-eng-review:
- Verdict: APPROVE_WITH_CHANGES, **0 P0**, 4 P1, 4 P2.
- Verified all 6 round-1 P0s are genuinely fixed in v2 plan text
  (line-cited evidence in `docs/phase-3/plan-v2-gstack-round2-review.md`).
- New v2-introduced issues found: P1-A (step-5 UPDATE failure), P1-B
  (Telegram null callback_query.message), P1-C (sweep CAS spec missing),
  P1-D (G8/G9 task expansion).

**v2 → v2.1** (`4edfd81`, this revision): 4 P1 + 2 P2 round-2 findings
integrated; 2 P2 deferred-justified.

## Your job

You are reviewing **plan v2.1**. Do NOT re-flag findings already
addressed in v2 or v2.1. Specifically, do NOT re-flag the 6 round-1
P0s (all fixed in v2 — see `docs/phase-3/plan-v1-codex-review.md` for
the originals) or the 4 round-2 P1s (all fixed in v2.1 — see
`docs/phase-3/plan-v2-gstack-round2-review.md`).

DO look for:

1. **NEW structural bugs in v2.1's redesigns** (D33 two-phase token
   flow, D34 callback_tokens schema, D35 messageRef validation, D36
   synthetic system actor, D37 shutdown order, D38 sync write-through,
   D39 SQLite preflight). The v1→v2 redesign was substantial; v2.1
   added more (T19d/T19e splits, step-5-failure handling). Verify
   each is internally consistent.

2. **Cross-section consistency**:
   - §10.2 D33 issue flow vs §10.3 action gating vs §16 T16/T17 vs §11
     test list. Do they describe the SAME flow?
   - §9 callback_tokens schema vs §10.2 INSERT vs §10.3 atomic CAS.
     Same column names, same status values, same hashing policy?
   - §7 D29 init order vs §16 T15.1-T15.5 vs §19 exit criterion #10.
     Same ordering, same gates?

3. **Concurrency / race risks the redesign may have re-introduced**:
   - Step-5 stuck-at-issued + sweep early-revoke (T19e.4) — can the
     sweep race with a click that arrives just after the stuck UPDATE
     finally succeeds (transient failure resolved)?
   - Atomic CAS in §10.3 step 3 — is the SQL `WHERE token_hash=? AND
     status='bound'` actually serialization-safe under SQLite WAL?
   - G8 synthetic turn_failed delivery (T19d.3) — can the synthetic
     event arrive AFTER the EventNormalizer's `endOfStream`?

4. **Missing test paths for the v2.1 additions**:
   - P3.T-Sec-step5-failure — does the test cover the retry-then-sweep
     handoff, including retry success scenarios?
   - P3.T-Sec-message-ref-unknown — does it cover the adapter side
     setting `messageId = "<unknown>"` deterministically?
   - T19e.1 CAS sweep — does the test cover the sweep racing with a
     concurrent click on the same token?
   - T19d.1-4 — does the G8 split actually result in a deliverable
     synthetic event the IM layer can render?

5. **Scope creep** — did v2 or v2.1 silently introduce work beyond the
   Phase 3 mission (Telegram MVP + production daemon wire-up + real
   SecurityPolicy ACL + persistent SessionRouter + launchd)?

6. **Project redlines** still hold:
   - No raw `AppServerClient.request("...")` outside CodexRuntime.
   - No Telegram SDK / raw Update types / bot_token literal outside
     `packages/im-telegram/src/`.
   - Approval decisions go through `ApprovalBroker.resolve()`.
   - SecurityPolicy runs BEFORE actionable buttons render.
   - All security paths fail closed.
   - No tokens in plist, logs, fixtures, SQLite, or docs.
   - No public TCP/UDP listener.
   - No Computer Use production flow in Phase 3.
   - No Lark/DingTalk in Phase 3.
   - No real implementation before review approval.

7. **Known non-plan blocker** (do not flag as plan defect):
   `pnpm protocol:check` fails on `phase-3-planning` because
   committed `CODEX_VERSION=0.125` vs local codex `0.128`. v2.1
   records this as T0.5 / R6. Implementation gates on T0.5 rebase
   onto `chore/codex-upgrade-0.128`, not on plan correctness.

## Files to read

Primary:
- `docs/superpowers/plans/2026-05-02-phase-3-plan.md` (v2.1 — 2304 lines)

Companion:
- `docs/phase-3/plan-v2-review-response.md` (v1→v2 + v2→v2.1 fix matrix)
- `docs/phase-3/plan-v2-gstack-round2-review.md` (round-2 verdict)
- `docs/phase-3/plan-v1-codex-review.md` (round-1 codex verdict — what
  v2 fixed)

Project context (cite line numbers from working tree):
- `CLAUDE.md` (project redlines)
- `docs/handoffs/2026-05-02-phase2-to-phase3.md` (Phase 2 → 3 handoff)
- `01-PRD.md`, `02-TECHNICAL-DECISIONS.md`, `03-ARCHITECTURE.md`,
  `04-MODULE-DESIGN.md`, `06-IM-ADAPTERS.md`,
  `07-SECURITY-AND-COMPUTER-USE.md`, `08-DATA-MODEL.md`, `09-ROADMAP.md`
- `packages/core/src/approval-broker.ts` (Phase 2 broker — D33/D34/D36
  build on this; do NOT re-flag the broker code itself)
- `packages/core/src/types.ts` (`ApprovalActor` already includes
  system kind — D36 needs no broker change)
- `packages/channel-core/src/{adapter.ts,fake.ts}` (closed adapter
  interface)
- `packages/codex-protocol/src/generated/RequestId.ts` (RequestId =
  string | number; D30 v2 short token addresses this)

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
  - Whether each round-1 P0 is genuinely fixed in v2 (cite line refs).
  - Whether each round-2 P1 is genuinely fixed in v2.1 (cite line refs).
  - Whether v2.1 introduced any NEW structural risks not surfaced by
    gstack round 2.
  - Whether implementation can begin after this review's required
    changes are addressed.
  - Cross-model alignment with gstack round 2.
```

Read on disk; cite section + line numbers from plan v2.1 (commit
`4edfd81`) and from referenced source files. No prose summaries
without line citations.

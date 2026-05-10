# Codex outside-voice review ROUND 3 — Phase 3 plan v2.2

You are the outside-voice reviewer for Phase 3 Plan v2.2, commit
`c606039` on branch `phase-3-planning`.

## Project boundary (do not violate)

This project is a **Codex App Server native IM Rich Client**. It must
NOT become a Codex CLI/TUI wrapper, terminal-output parser, OpenClaw
plugin, or generic LLM chat bot. Mac mini daemon controls codex via
Telegram (Phase 3) → Lark/DingTalk (Phase 4/5) → Computer Use (Phase 6).

## Review history (do not re-flag)

**Round 1 on plan v1** (`b60a67d`):
- Codex outside-voice → REJECT, 6 P0 + 6 P1 + 3 P2.
- gstack /plan-eng-review → APPROVE_WITH_CHANGES, 12 issues.
- See `docs/internal/phase-3/plan-v1-codex-review.md`.

**v1 → v2** (`ff1176b`): all 6 round-1 P0s + 12+ P1s integrated.

**Round 2a (gstack) on plan v2**: APPROVE_WITH_CHANGES, 4 P1 + 4 P2.
v2 → v2.1 (`4edfd81`) integrated round-2a P1s + 2 P2s; 2 P2s deferred.

**Round 2b (codex) on plan v2.1**: REJECT, 1 P0 + 5 P1 + 3 P2.
Codex confirmed all earlier-round P0s genuinely fixed but flagged
new defects v2.1's edits introduced. See
`docs/internal/phase-3/plan-v2.1-codex-round2.md`.

**v2.1 → v2.2** (this revision, `c606039`): integrates all 1 P0 + 5
P1 + 3 P2 round-2b codex findings.

## Your job

You are reviewing **plan v2.2**. Do NOT re-flag findings already
addressed in earlier revisions. Specifically, do NOT re-flag:

- The 6 round-1 codex P0s (all fixed in v2 — see plan §0 + plan-v1
  review).
- The 4 round-2a gstack P1s (all fixed in v2.1 — see
  plan-v2-gstack-round2-review.md).
- The 1 P0 + 5 P1 + 3 P2 round-2b codex findings (claimed fixed in
  v2.2 — verify each, but don't re-flag the original v2.1 wording).

DO look for:

1. **Whether each round-2b codex finding is genuinely fixed in v2.2**
   (cite line refs from the plan v2.2 text):
   - **Codex-R2-P0** boundary amendment (D41 + new tasks T6.6 / T18.1-T18.4
     + ApprovalUiAction.wirePayload + InboundAction.rawCallbackData):
     does the amendment actually fit the closed Phase 2 boundary
     under D14 escape-clause semantics? Is the wire-flow consistent
     end-to-end (daemon sets wirePayload, adapter passes through,
     adapter delivers rawCallbackData on inbound, daemon decodes)?
   - **Codex-R2-P1-1** schema action='abort' (was 'cancel'): does
     T6f cover all 4 ApprovalUiAction kinds round-trip?
   - **Codex-R2-P1-2** §10.3 step reorder (CAS only on broker.resolve
     ok): does the new ordering avoid burning tokens on non-settling
     errors? Are wrong_actor / wrong_target / stale_callback / etc.
     all listed as "token stays bound" outcomes?
   - **Codex-R2-P1-3** D40 broker extension
     (failPendingApprovalAsTransportLost): is the API spec sound?
     Routes through #settleEntry without affecting siblings?
     T6.5 sequenced before T17.x?
   - **Codex-R2-P1-4** D42 EventNormalizer.endWithSynthetic + G8
     turn_failed arm (not error): is the API spec sound?
     T19d.0-T19d.4 use the new method? T6.7 sequenced before T19d?
   - **Codex-R2-P1-5** T15.5 expanded to 13 steps + new T15.6-T15.8:
     do all D29 init steps now have failure/ordering tests?
   - **Codex-R2-P2-1/2/3** test wording, schema clarification, version
     references.

2. **NEW structural risks introduced by v2.2's edits**:
   - **D40 broker extension**: does the new
     `failPendingApprovalAsTransportLost(approvalId)` correctly route
     through Phase 2 D21 byte-identical `#settleEntry`? Is it
     idempotent? What's its interaction with the existing
     `failPendingAsTransportLost()` (all-pending) and `expirePending()`
     methods? Could a sibling pending approval be incorrectly settled?
   - **D41 boundary amendment**: is `wirePayload?: string` (optional
     per kind) the right shape, or should it be a single optional
     field on the entire ApprovalAction wrapper? Does fall-back to
     adapter internal encoding when wirePayload is undefined break
     any Phase 2 fake adapter tests? Does the new
     `InboundAction.rawCallbackData: string` (required) break any
     existing Phase 2 channel-core test rigs that don't supply it?
   - **D42 endWithSynthetic**: is enqueue-then-end-of-stream race-safe
     with concurrent producers? Does it correctly preserve FIFO order
     with already-buffered events? Could an in-flight `endOfStream()`
     call from elsewhere race with `endWithSynthetic`?
   - **§10.3 step reorder**: in the new order
     (lookup → messageRef → policy → broker.resolve → CAS), is the
     duplicate-click race fully covered? If two simultaneous clicks
     pass validation 1-3 and both call broker.resolve, does Phase 2
     broker's #settleEntry serialize them correctly so only one
     reaches the CAS step? What happens if the first click's CAS
     fails (rowsAffected=0) — does the second click see a
     consistent state?
   - **D-Op-1 launchd**: T29a `load-and-run.sh` Keychain wrapper —
     is the `security find-generic-password -w` invocation safe under
     all macOS versions? Any risk of token leaking to process listing
     via `ps`?

3. **Cross-section consistency**:
   - §7 D29 init order vs §16 T15 tests vs §19 exit criteria — same
     13 steps, same gates?
   - §7 D33 token-issue flow vs §10.2 step list vs §10.3 action gating
     vs §16 T16+T17 — same field names (wirePayload, rawCallbackData,
     token_hash, callback_nonce), same status transitions?
   - §9 callback_tokens schema vs §7 D34 schema — single source of
     truth?
   - §7 D40 vs §16 T6.5 + T19e.4 — broker API spec consistent?
   - §7 D42 vs §16 T6.7 + T19d — EventNormalizer API consistent?

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
   committed `CODEX_VERSION=0.125` vs local codex `0.128`. v2.2
   records this as T0.5 / R6.

## Files to read

Primary:
- `docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md` (v2.2 — 2613 lines)

Companion:
- `docs/internal/phase-3/plan-v2-review-response.md` (response matrix, v1→v2.2)
- `docs/internal/phase-3/plan-v2.1-codex-round2.md` (codex round-2 verdict on v2.1)
- `docs/internal/phase-3/plan-v2-gstack-round2-review.md` (gstack round-2 on v2)
- `docs/internal/phase-3/plan-v1-codex-review.md` (codex round-1 on v1)

Project context:
- `CLAUDE.md`
- `docs/internal/handoffs/2026-05-02-phase2-to-phase3.md`
- `01-PRD.md`, `02-TECHNICAL-DECISIONS.md`, `03-ARCHITECTURE.md`,
  `04-MODULE-DESIGN.md`, `06-IM-ADAPTERS.md`,
  `07-SECURITY-AND-COMPUTER-USE.md`, `08-DATA-MODEL.md`, `09-ROADMAP.md`
- `packages/core/src/approval-broker.ts` (Phase 2 broker)
- `packages/core/src/types.ts` (ApprovalActor / ApprovalUiAction —
  D41 amends ApprovalUiAction here)
- `packages/channel-core/src/{adapter.ts,fake.ts,types.ts}`
  (D41 amends InboundAction in types.ts; D41 amends adapter contract)
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
  - Whether each round-2b codex finding is genuinely fixed in v2.2
    (cite line refs).
  - Whether v2.2 introduced any NEW structural risks not surfaced by
    earlier reviews.
  - Whether implementation can begin after this review's required
    changes are addressed.
  - Cross-model alignment with gstack round 2.
```

Read on disk; cite section + line numbers from plan v2.2 (commit
`c606039`) and from referenced source files. No prose summaries
without line citations.

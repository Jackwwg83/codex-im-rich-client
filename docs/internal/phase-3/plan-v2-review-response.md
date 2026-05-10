# Phase 3 plan review response matrix (v1 → v2 → v2.1 → v2.2)

Companion to `docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md` (plan v2.2).

Tracks every Codex outside-voice + gstack `/plan-eng-review` finding
across 4 plan revisions and 3+ review rounds → where each is fixed.

| Revision | Commit | Trigger | Findings | Status |
|---|---|---|---|---|
| v1 | `b60a67d` | gstack round 1 (APPROVE_WITH_CHANGES) + codex round 1 (REJECT) | 6 P0 + 6 P1 + 3 P2 | superseded |
| v2 | `ff1176b` | gstack round 2 (APPROVE_WITH_CHANGES) | 4 P1 + 4 P2, 0 P0 | superseded |
| v2.1 | `4edfd81` | codex round 2 (REJECT) | 1 P0 + 5 P1 + 3 P2 | superseded |
| v2.2 | `c606039` | codex round 3 (APPROVE_WITH_CHANGES) | 0 P0 + 6 P1 + 3 P2 | superseded |
| v2.3 | `83bfd90` | codex round 4 (APPROVE_WITH_CHANGES) | 0 P0 + 4 P1 + 2 P2 | superseded |
| **v2.4** | **(this commit)** | T1 authorized; codex round 5 OPTIONAL | TBD | **current — T1 unlock pending T0.7 rebase** |

## Status legend

- **fixed** — v2 plan integrates the change; section/decision pointer given.
- **deferred-justified** — v2 plan documents why it stays out of scope.
- **needs-reviewer-confirmation** — v2 design exists but reviewer should re-check it on round 2.

---

## P0 (blocked Phase 3 implementation start until fixed)

| ID | Severity | Source | Finding (one-line) | v2 change | v2 section / decision | Status |
|---|---|---|---|---|---|---|
| C1-P0-1 / A1 | P0 | codex + gstack agree | D29 missing `broker.enablePendingMode(method)` for IM-routable methods | New D32 + rewritten D29 step ordering; daemon test asserts pending-mode for all IM-routable methods before supervisor.start | §7 D29 (revised) + D32 + §11 P3.T-init-pendingmode | fixed |
| C1-P0-2 / A3 | P0 | codex + gstack agree | `auto_decline` path returns `binding_required` because no `bindActorPolicy` was called | D36: synthetic `{kind:"system", reason:"policy_denied"}` actor; daemon binds policy with system nonce, then `broker.resolve`. Verified `ApprovalActor` already includes the system kind (no broker type extension needed) | §7 D36 + §10.2 (revised) + §11 P3.T-Sec-policy-decline | fixed |
| C1-P0-3 / A2 | P0 | codex + gstack agree | `sendCard → bindActorPolicy` race window | D33 two-phase callback flow: issue token → bindActorPolicy → sendCard → attach MessageRef. Callback before MessageRef attachment fails closed | §7 D33 + §10.2 (revised) + §11 P3.T-bind-before-send + P3.T-callback-not-ready | fixed |
| C1-P0-4 | P0 | codex + gstack agree | `${approvalId}\|${kind}\|${nonce}` overflows for plausible RequestIds (`RequestId = string \| number`) | D30 rewritten: `callback_data = "v1:" + opaqueToken` (16-char base32, ≤19 bytes total). Token hash mapped in SQLite `callback_tokens` table | §7 D30 (rewrite) + D34 + §9 callback_tokens schema + §11 P3.T-token-overflow + P3.T-token-restart-replay | fixed |
| C1-P0-5 / A4 | P0 | codex + gstack agree | `ActorPolicy` + `InboundAction` lack messageRef binding | D35: `InboundAction.messageRef`; daemon validates `record.messageRef === inbound.messageRef` before `broker.resolve`. Stale messageRef fails closed (covered by D33 token state, not by extending ActorPolicy — avoids reintroducing the sendCard→bind race) | §7 D35 + §10.3 (revised) + §11 P3.T-stale-message + P3.T-messageRef-mismatch | fixed |
| C1-P0-6 / A5 | P0 | codex + gstack agree | §10.4 attack table missing 4 critical Phase 3 rows | §10.4 extended: daemon-restart-replay, expire-vs-click race, click-before-bind regression, renderer-defensive unknown snapshot | §10.4 (revised) + §11 P3.T-restart-replay + P3.T-expire-race + P3.T-renderer-unknown | fixed |

## P1 (required before T1)

| ID | Severity | Source | Finding | v2 change | v2 section / decision | Status |
|---|---|---|---|---|---|---|
| C1-P1-1 | P1 | codex | SIGTERM teardown leaves pending broker entries unsettled | D37: `Daemon.stop()` orders `failPendingAsTransportLost("daemon_shutdown")` BEFORE supervisor/adapter teardown | §7 D37 + §10.5 (new shutdown subsection) + §11 P3.T-sigterm-failpending | fixed |
| C1-P1-2 / A7 | P1 | codex + gstack agree | D23 SessionRouter "async write-through" conflicts with G3 binding-restart-survival | D38: synchronous write-through on bind/unbind; commands fail (no optimistic ack) on SQLite write error | §7 D38 (replaces D23) + §11 P3.T-binding-write-failure + P3.T-restart-binding-survives | fixed |
| C1-P1-3 / C1 | P1 | codex + gstack agree | T2/T9/T13/T17/T19/T22/T28 too coarse for "2–5 minute" sizing | §16 task breakdown rewritten with single-failing-test sub-tasks (T2a/b/c, T9.1-5, T13a/b/c, T17 per-error-kind, T19a/b/c, T22a/b/c, T28a-e) | §16 (revised) | fixed |
| C1-P1-4 / R5 | P1 | codex | SQLite native-build mitigation unrealistic; sqlite3 is not pure-JS | D39: T1 starts with `better-sqlite3` install + load preflight; on failure, fallback CANDIDATE is Node 24 `node:sqlite` (release-candidate; preflight-required). No claim that any fallback is risk-free until preflight passes | §7 D39 + §16 T1.0 preflight + §23 R5 (rewritten) | fixed |
| C1-P1-5 | P1 | codex | T28 grammY contract test too abstract to catch real-Telegram divergence | T28 split into raw fixture cases (T28a-e: private, group, forum-topic, missing-message, stale callback, malformed callback_data) | §16 T28a-e + §11 P3.T-grammY-fixture-* | fixed |
| C1-P1-6 | P1 | codex | launchd plist risks rendering bot token | §13.1 rewrite: plist references env-var name only; daemon resolves token from env/Keychain at runtime; no token in plist/logs/fixtures/SQLite | §13.1 (rewrite) + §10.5 + §22 (mapping update) | fixed |
| C3 | P1 | gstack | D31 audit-write-failure rate-limit unspecified | D31 clarification: rate-limited failure logs (once-per-interval); first failure emits `audit.sqlite_unavailable` to in-memory ring; `daemon status` surfaces sink failure | §7 D31 (revised) + §13.3 | fixed |
| A6 | P1 | gstack | D22 SecurityPolicy reload atomicity | D22 clarification: reload builds new immutable policy snapshot; atomic single-assignment swap; failed reload leaves old policy active; no async I/O during checks | §7 D22 (revised) | fixed |

## P2 (cosmetic / defer)

| ID | Severity | Source | Finding | v2 change | v2 section | Status |
|---|---|---|---|---|---|---|
| C1-P2-1 / §5-stale | P2 | codex | §5 still says backfill "still pending" but `phase-2-codex-reviewed` exists | §5 rewritten: backfill DONE, GO_WITH_LOW_NITS, tag at `0d4dfc3`; codex-upgrade chore on `chore/codex-upgrade-0.128` (not yet on phase-3-planning) | §5 (revised) | fixed |
| C1-P2-2 / A8 | P2 | codex + gstack agree | §6 redline "no Telegram code outside im-telegram" too broad | §6 narrowed: "no Telegram SDK / raw Update types / bot_token literal strings outside `packages/im-telegram/src/**`. Config/docs may reference adapter keys + env-var names" | §6 (revised) | fixed |
| C1-P2-3 | P2 | codex | §13.1 launchd template hardcodes paths (`/usr/local/bin/node`, `/Users/mini`) | §13.1 templated: installer reads `$HOME` + `$USER` + resolved node path | §13.1 (revised) | fixed |
| C2 | P2 | gstack | `audit.recent()` shallow vs deep clone | Out of scope for Phase 3 plan. Phase 2 review note already deferred. v2 explicitly defers (no concrete external mutator surfaced in real callers) | (no change; mentioned in §23 R-deferred) | deferred-justified |
| C4 | P2 | gstack | T40 should bump version to `0.1.0-phase3` | §16 T40 + §19 + §21 updated to bump version on Phase 3 close-out, mirroring Phase 2 procedure | §16 T40 (revised) + §19 | fixed |
| Lake-G8 | P2 | gstack | Promote G8 (synthesized turn_failed) to P0 | Promoted to P0 (G8 now P0). New section in §10 explains UX impact during transport-loss | §3.1 (G8 promoted) + §10.5 + §16 T-G8 | fixed |
| Lake-G9 | P2 | gstack | Promote G9 (lazy-prune sweep) to P0 | Promoted to P0 (G9 now P0). Prevents `#pendingById` unbounded growth in long-running daemons | §3.1 (G9 promoted) + §16 T-G9 | fixed |
| Lake-G10 | P2 | gstack | G10 slash commands stays P1 | Stays P1; documented as "ship if cheap, defer otherwise" | §3.2 (unchanged) | deferred-justified |

---

## What v2 explicitly does NOT change

- Phase 3 mission (Telegram MVP bundle) — both reviewers confirmed scope correct.
- §17 dependency graph high-level shape — unchanged; only sub-task IDs updated.
- §18 parallelization windows — unchanged.
- §20 rollback strategy — unchanged.
- §21 handoff requirements — unchanged structurally.
- D11 / D14 / D16 / D17 / D18 / D19 / D20 / D21 (Phase 1+2 carry-forward) — untouched.

---

## Pre-implementation re-review checklist

T1 implementation unlock state for plan v2.4:

1. ☑ **gstack `/plan-eng-review` round 2 on plan v2** — APPROVE_WITH_CHANGES, 4 P1 + 4 P2, 0 P0. v2.1 absorbed.
2. ☑ **Codex outside-voice round 2 on plan v2.1** — REJECT, 1 P0 + 5 P1 + 3 P2. v2.2 absorbed.
3. ☑ **Codex outside-voice round 3 on plan v2.2** — APPROVE_WITH_CHANGES, 0 P0 + 6 P1 + 3 P2. v2.3 absorbed.
4. ☑ **Codex outside-voice round 4 on plan v2.3** — APPROVE_WITH_CHANGES, 0 P0 + 4 P1 + 2 P2. Codex explicitly stated: "Implementation can begin after the P1 items above are patched". v2.4 (this revision) absorbed.
5. ☐ **T0.7 codex-upgrade rebase**: rebase `phase-3-planning` onto `chore/codex-upgrade-0.128` (`d999af5`); resolve `pnpm protocol:check` (R6 carry-over). REQUIRED before T1.
6. ☐ **Codex round 5 on v2.4** — OPTIONAL ultimate-verification. NOT REQUIRED per round 4's explicit T1-unlock authorization. The user may unlock T1 directly after T0.7 lands.

After T0.7 lands, **T1 is unlocked**. Phase 3 implementation may begin.

## v2 → v2.1 round-2 fix matrix

| Round-2 ID | Severity | Source | Finding | v2.1 fix | v2.1 location | Status |
|---|---|---|---|---|---|---|
| Round-2-P1-A | P1 | gstack round 2 | Step-5 UPDATE-to-bound failure unhandled | §10.2 4th failure-mode bullet (retry + audit + sweep handoff to T19e.4) + new T-Sec-15 row + P3.T-Sec-step5-failure test | §10.2 + §10.4 + §11 + §16 T19e.4 | fixed |
| Round-2-P1-B | P1 | gstack round 2 | Telegram `callback_query.message` null path missing | §10.3 step 2 explicit `messageId === "<unknown>"` branch + new T-Sec-16 row + P3.T-Sec-message-ref-unknown test + T28d.1/2/3 split | §10.3 + §10.4 + §11 + §16 T28d.1 | fixed |
| Round-2-P1-C | P1 | gstack round 2 | T-Sec-12 expire-sweep CAS unspecified | T19e.1 explicit CAS SQL `UPDATE ... WHERE status='bound' AND expires_at < ? RETURNING ...` + spec for concurrent-click-vs-sweep contract | §16 T19e.1 | fixed |
| Round-2-P1-D | P1 | gstack round 2 | G8 + G9 P0 task entries undersized (single line each) | T19d split into T19d.1-4 (detect / synthesize / deliver / render); T19e split into T19e.1-4 (callback_tokens sweep / pendingById sweep / interval trigger / step-5-stuck early-revoke) | §16 T19d + T19e | fixed |
| Round-2-P2-A | P2 | gstack round 2 | `actor_kind` NOT NULL but actor populated at click time — schema vs prose | §9 callback_tokens explicit population contract: actor_kind set at INSERT per policy; actor_user_id/platform NULL at INSERT, populated at click-time CAS | §9 | fixed |
| Round-2-P2-B | P2 | gstack round 2 | launchd Keychain wrapper has no integration test path | T29 detail + new T29a (load-and-run.sh wrapper + golden render + `--dry-run` test) + T29b (operator-gated Keychain integration smoke) | §16 T29 + T29a + T29b | fixed |
| Round-2-P2-C | P2 | gstack round 2 | `SessionRouter.bindThread` orphan-codex-thread risk on partial failure | Documented as deferred in §23 P2 deferred subsection | §23 | deferred-justified |
| Round-2-P2-D | P2 | gstack round 2 | Raw token in-process-memory lifetime test missing | Documented as deferred in §23 P2 deferred subsection (heap-dump scan tooling not in Phase 3 scope) | §23 | deferred-justified |

## v2.1 → v2.2 codex round-2 fix matrix

Codex outside-voice round 2 on v2.1 (`4edfd81`) returned **REJECT**
with 1 P0 + 5 P1 + 3 P2. See `docs/internal/phase-3/plan-v2.1-codex-round2.md`.
Codex confirmed all round-1 P0s + round-2 P1s genuinely fixed; flagged
new v2.1-introduced defects.

| Round-2 codex ID | Severity | Finding | v2.2 fix | v2.2 location | Status |
|---|---|---|---|---|---|
| Codex-R2-P0 | P0 | D33/D34 callback_data shape doesn't fit closed Phase 2 boundary (no `wirePayload` on ApprovalAction; no `rawCallbackData` on InboundAction) | D41 — Phase 2 D14 escape clause: `ApprovalUiAction.wirePayload?: string`; `InboundAction.rawCallbackData: string`; adapter contract update; new tasks T6.6 + T18.1-T18.4 | §7 D41 + §16 T6.6 + T18.1-T18.4 + T16.4 + T17.1 + §23 R9 | fixed |
| Codex-R2-P1-1 | P1 | callback_tokens schema `action='cancel'` vs UI `'abort'` mismatch | Schema CHECK enum changed to `'abort'`; new test T6f covers all 4 ApprovalUiAction kinds round-trip | §9 (lines 567/989) + §16 T6f | fixed |
| Codex-R2-P1-2 | P1 | CAS burns token BEFORE broker validation (wrong actor / target / nonce kills the token) | §10.3 step reorder: validation steps 1-3 read-only; broker.resolve at step 4; CAS only on `result.kind === "ok"` (step 5). Non-settling broker errors leave token 'bound' for legitimate retry. Tests T17.3-T17.13 reordered; T17.6-T17.8 explicitly assert "token stays 'bound'" | §10.3 + §16 T17.x | fixed |
| Codex-R2-P1-3 | P1 | T19e.4 single-approval transport_lost API doesn't exist on broker | D40 — new Phase 2 broker extension `failPendingApprovalAsTransportLost(approvalId)` routes through `#settleEntry`. Task T6.5 sequenced before T17.x. T19e.4 updated to call the new API | §7 D40 + §16 T6.5 + T19e.4 | fixed |
| Codex-R2-P1-4 | P1 | G8 `endOfStream` hook ignores later enqueues; uses wrong `error` arm instead of `turn_failed` | D42 — new `EventNormalizer.endWithSynthetic(events)` enqueues then closes. T19d.1-3 rewritten to use D42 + correct `turn_failed` arm with proper threadId/turnId | §7 D42 + §16 T6.7 + T19d.0-T19d.4 | fixed |
| Codex-R2-P1-5 | P1 | D29 init-order tests cover steps 1-9 but D29 has 13 steps | T15.5 expanded (1-13); new T15.6 / T15.7 / T15.8 cover D29 steps 10-13 (subscribe wires, adapter.start LAST, SIGTERM handler) | §16 T15.5-T15.8 | fixed |
| Codex-R2-P2-1 | P2 | T19e.1 test "concurrent click on a non-expired token" doesn't prove the same-row sweep-vs-click race | T19e.1 test reworded to stage same-row race (sweep vs click on same expired bound token); assertion "exactly one path wins, never both" | §16 T19e.1 | fixed |
| Codex-R2-P2-2 | P2 | §9 says `actor_kind='system'` for D36 auto-decline at INSERT, but D36 issues no token | §9 §10.5 narrowed: actor_kind='system' is schema headroom, NOT used by Phase 3 code paths (D36 issues no callback_token row at all) | §9 | fixed |
| Codex-R2-P2-3 | P2 | §19/T0 still says "Codex round 2 on v2" in a v2.1 plan | All v2/v2.1 references throughout plan updated to v2.2; §19 exit criteria updated | header + §19 + footer | fixed |

## v2.2 → v2.3 codex round-3 fix matrix

Codex outside-voice round 3 on v2.2 (`c606039`) returned **APPROVE_WITH_CHANGES**
with 0 P0 + 6 P1 + 3 P2. See `docs/internal/phase-3/plan-v2.2-codex-round3.md`.
0 P0 confirmed structural design is sound; all findings are
integration / consistency / refinement.

| Round-3 codex ID | Severity | Finding | v2.3 fix | v2.3 location | Status |
|---|---|---|---|---|---|
| Codex-R3-P1-1 | P1 | D41 names T18.1-T18.4 but §16 doesn't define them; existing T18 conflicts | Renamed to T-D41a-d; new §16.4b sub-block defines all 4 tasks before T16/T17 | §16.4b (new) + D41 refs throughout | fixed |
| Codex-R3-P1-2 | P1 | `SendCardResult.callbackNonce` + `InboundAction.callbackNonce` JSDoc still describes them as broker-bound nonce (stale post-D33) | T-D41b JSDoc amends both fields as "legacy fallback when wirePayload absent"; explicit text in §7 D41 | §7 D41 + T-D41b + T-D41c (JSDoc-stale assertion test) | fixed |
| Codex-R3-P1-3 | P1 | `duplicate_decision` does not exist on Phase 2 broker; actual error kind is `already_resolved` (with priorDecision field) | Bulk rename throughout plan; T17.12 amended to surface priorDecision | global rename + T17.12 | fixed |
| Codex-R3-P1-4 | P1 | CAS rowsAffected=0 unsafe semantics — broker has already mutated state; can't truthfully say "already resolved" to user | Codex option-b: rowsAffected=0 unreachable defense-in-depth; on hit emit `audit.cas_unreachable_after_resolve` + force non-CAS UPDATE + answerAction(ok:true) since broker accepted | §10.3 step 5 | fixed |
| Codex-R3-P1-5 | P1 | §6 redline + D29 step 10 still describe v1's CAS-before-broker order; contradicts §10.3 v2.2 reorder | §6 redline rewritten to mirror §10.3 (validation BEFORE broker.resolve; CAS only on ok); D29 step 10 rewritten with explicit step ordering | §6 + §7 D29 step 10 | fixed |
| Codex-R3-P1-6 | P1 | D42 `endWithSynthetic` enqueue→endOfStream sequence misses `#drain()`; consumers blocked on `.next()` would hang | D42 sequence updated: `#enqueue(...)` → `#drain()` → `endOfStream()`. New test (e) waiter-already-blocked | §7 D42 + T6.7 test (e) | fixed |
| Codex-R3-P2-1 | P2 | T0 + §19 still say "Plan v2" / "round 2" / "Exit criteria (v2)" | T0.1-T0.8 rewritten with v2.3 round-4 sequencing; §19 heading updated | §16.1 T0 + §19 heading | fixed |
| Codex-R3-P2-2 | P2 | §10.2 sketch shows `actor: null` in INSERT record but §9 says `actor_kind='im'` at INSERT | §10.2 sketch aligned: `actor_kind: 'im'`, `actor_user_id: NULL`, `actor_platform: NULL`, `msg_*: NULL` | §10.2 step 1 sketch | fixed |
| Codex-R3-P2-3 | P2 | T29a Keychain wrapper `--dry-run` could leak token; no fail-closed for missing/empty Keychain output | T29a hardened: `set -euo pipefail`; nonempty-token check before exec; `--dry-run` prints `length=N` not value; new tests for empty-keychain + pipefail behavior | §16.7 T29a | fixed |

## v2.3 → v2.4 codex round-4 fix matrix

Codex round 4 on v2.3 (`83bfd90`) returned **APPROVE_WITH_CHANGES**
with 0 P0 + 4 P1 + 2 P2. Codex explicitly stated: "Implementation
can begin after the P1 items above are patched". v2.4 (this revision)
patches them; T1 unlocks after T0.7 protocol-version rebase.

| Round-4 codex ID | Severity | Finding | v2.4 fix | v2.4 location | Status |
|---|---|---|---|---|---|
| Codex-R4-P1-1 | P1 | §17 dependency graph omits T6.5/T6.6/T6.7 + T-D41a-d edges | §17 graph rewritten with explicit edges: T6.5→T19e.4; T6.6→T-D41a-d→T16/T17; T6.7→T19d.1; plus a "v2.4 hard-gate edges" subsection that names the implementation ordering constraint | §17 (rewritten) | fixed |
| Codex-R4-P1-2 | P1 | T6.7 test (e) named "backpressure soft cap" but D42 prose specifies the new "waiter-already-blocked" test | T6.7 test (e) renamed to waiter-already-blocked; backpressure demoted to optional (f) | §16.2 T6.7 | fixed |
| Codex-R4-P1-3 | P1 | T17.5 "concurrent-second-click CAS race" doesn't deterministically exercise audit.cas_unreachable_after_resolve (Phase 2 broker returns already_resolved, never reaches second daemon flow's ok-branch CAS) | T17.5 (b) test mechanism rewritten: fake CallbackTokenRepository hook returns rowsAffected=0 after broker.resolve ok; assert audit + force-update + ok ack + sibling revoke | §16.5 T17.5 | fixed |
| Codex-R4-P1-4 | P1 | callback_tokens.target naming inconsistent: schema target_key (TEXT), record sketch target (Target shape), broker input record.target — wrong-target validation depends on exact Target shape | Schema replaced single `target_key TEXT` with 4 explicit columns (`target_platform`, `target_chat_id`, `target_thread_key`, `target_topic_id`); D34 documents `CallbackTokenRepository` `hydrate()` Target reconstruction; §10.2 INSERT sketch + §10.4 T-Sec-3 + §16.5 T17.x updated to use hydrated `record.target` deep-equal | §7 D34 + §9 schema + §10.2 step 1 + §10.4 T-Sec-3 + §10.4 T-Sec-12 (also updated for v2.2 step reorder) | fixed |
| Codex-R4-P2-1 | P2 | T-D41c JSDoc-stale assertion only checks "legacy fallback" wording — too lax | T-D41c assertion strengthened: must contain BOTH "legacy fallback" AND "production ... ignores" / `rawCallbackData` source-of-truth wording | §16.4b T-D41c | fixed |
| Codex-R4-P2-2 | P2 | Footer says "rounds 1 + 2 + 3" but table now has R4; R8 risk says round 3 is final gate | Footer heading updated to "rounds 1 + 2 + 3 + 4"; R8 rewritten to reflect convergence + T1 authorized state; review table extended with R4 column | §23 R8 + GSTACK REVIEW REPORT footer | fixed |

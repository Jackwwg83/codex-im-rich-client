# Phase 3 plan review response matrix (v1 → v2 → v2.1 → v2.2)

Companion to `docs/superpowers/plans/2026-05-02-phase-3-plan.md` (plan v2.2).

Tracks every Codex outside-voice + gstack `/plan-eng-review` finding
across 4 plan revisions and 3+ review rounds → where each is fixed.

| Revision | Commit | Trigger | Findings | Status |
|---|---|---|---|---|
| v1 | `b60a67d` | gstack round 1 (APPROVE_WITH_CHANGES) + codex round 1 (REJECT) | 6 P0 + 6 P1 + 3 P2 | superseded |
| v2 | `ff1176b` | gstack round 2 (APPROVE_WITH_CHANGES) | 4 P1 + 4 P2, 0 P0 | superseded |
| v2.1 | `4edfd81` | codex round 2 (REJECT) | 1 P0 + 5 P1 + 3 P2 | superseded |
| **v2.2** | **(this commit)** | codex round 3 PENDING | TBD | current |

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

Before plan v2.2 is approved for T1:

1. ☑ **gstack `/plan-eng-review` round 2 on plan v2** — APPROVE_WITH_CHANGES, 4 P1 + 4 P2, 0 P0. All round-2 P1s + 2 P2s integrated into v2.1; 2 P2s deferred-justified.
2. ☑ **Codex outside-voice round 2 on plan v2.1** — REJECT, 1 P0 + 5 P1 + 3 P2. Codex confirmed round-1 P0s + round-2 P1s genuinely fixed; flagged NEW v2.1-introduced defects (boundary mismatch, CAS-pre-validation, single-approval API gap, G8 ordering, init-order test gap). All 1 P0 + 5 P1 + 3 P2 integrated into v2.2 (this revision). See `docs/phase-3/plan-v2.1-codex-round2.md`.
3. ☐ **Codex outside-voice round 3 on plan v2.2** — verify v2.2's D40 / D41 / D42 amendments + §10.3 step reorder don't introduce new structural risks. Particular focus: D41 boundary amendment is safe under D14 escape clause; D40 single-approval API routes through `#settleEntry` correctly; D42 `endWithSynthetic` doesn't break Phase 1 supervisor's `endOfStream` invariants; §10.3 reorder doesn't create new races (especially the broker.resolve-then-CAS sequence with concurrent clicks).
4. ☐ Cross-model agreement: Codex round 3 must return APPROVE or APPROVE_WITH_CHANGES on v2.2. Codex REJECT triggers v2.3 or v3 (whichever the user picks).
5. ☐ (Optional) gstack round 3 on v2.2 — gstack round 2 was on v2; round 3 not strictly required since v2.1 + v2.2 only address codex round-2 findings, but a sanity pass is cheap.
6. ☐ Verify `pnpm protocol:check` either passes (rebase onto `chore/codex-upgrade-0.128`) or is documented as deferred (T0.5 / R6).

If Codex round 3 surfaces a new P0, plan v2.2 → v2.3 BEFORE T1.

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
with 1 P0 + 5 P1 + 3 P2. See `docs/phase-3/plan-v2.1-codex-round2.md`.
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

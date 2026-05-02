# Phase 3 plan v2 — review response matrix

Companion to `docs/superpowers/plans/2026-05-02-phase-3-plan.md` (plan v2).

Tracks every Codex outside-voice C1 finding (`docs/phase-3/plan-v1-codex-review.md`)
and gstack `/plan-eng-review` finding (in plan v1's `## GSTACK REVIEW REPORT`
section, retained at the bottom of the v2 plan as historical record) →
where it is fixed in v2.

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

Before plan v2 is approved for T1:

1. ☐ `gstack /plan-eng-review` round 2 on plan v2 — verify all 12 P0+P1 fixes land as intended.
2. ☐ Codex outside-voice review round 2 on plan v2 — verify no new structural bugs introduced by the redesign (especially D33 two-phase token flow).
3. ☐ Cross-model agreement: both verdicts must be APPROVE or APPROVE_WITH_CHANGES. A second REJECT triggers v3.
4. ☐ Verify `pnpm protocol:check` either passes (rebase onto `chore/codex-upgrade-0.128`) or is documented as deferred.

If any reviewer surfaces a new P0, plan v2 → v3 BEFORE T1.

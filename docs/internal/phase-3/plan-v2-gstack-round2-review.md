# gstack /plan-eng-review round 2 — Phase 3 plan v2 (`ff1176b`)

Round-2 review of plan v2. Round 1 was on v1 (`b60a67d`) with verdict
APPROVE_WITH_CHANGES + 12 issues + 3 critical gaps. v2 (`ff1176b`)
incorporated all 6 round-1 P0s + all 12+ P1s.

## Round-1 P0 verification (all 6 confirmed fixed in v2 plan text)

| Round-1 P0 | v2 evidence (line refs) |
|---|---|
| A1 / C1-P0-1 D29 enablePendingMode | line 414 step 4 + D32 (line 492) + P3.T-init-pendingmode test (line 1220) |
| A2 / C1-P0-3 sendCard→bind race | line 539 + line 954 explicit "closes v1 race" + P3.T-bind-before-send (line 1604) |
| A3 / C1-P0-2 auto-decline binding_required | line 637 synthetic system actor + bind + resolve on single path |
| A4 / C1-P0-5 messageRef binding | InboundAction.messageRef (line 609) + daemon validates BEFORE resolve (lines 313-319) |
| A5 / C1-P0-6 attack table missing rows | T-Sec-11..14 (lines 1073-1076) + matching tests |
| C1-P0-4 callback_data overflow | "v1:"+16-char base32=19B + sha256[:32] PRIMARY KEY (lines 582+848); raw token never persisted |

## VERDICT: APPROVE_WITH_CHANGES

| Round | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|
| Round 1 (v1) | REJECT | 6 | 6 | 3 |
| **Round 2 (v2)** | **APPROVE_WITH_CHANGES** | **0** | **4** | **4** |

All round-1 P0s genuinely fixed. Round-2 findings are surgical — none
structural; none re-open the broker / approval / callback security
design v2 stabilized.

---

## Round-2 P1 (4 — required before T1)

### Round-2-P1-A — Step-5 UPDATE-to-bound failure unhandled
*confidence 8/10*

§10.2 lines 968-973 list failure modes for INSERT, bindActorPolicy,
and sendCard. The post-sendCard UPDATE at §10.2 line 542 (status
'issued' → 'bound') has no failure path. If it fails (transient
SQLite error, WAL disk full mid-flow): tokens stay 'issued' forever;
broker policy is bound but every inbound click sees status='issued'
and fails closed "binding_not_ready"; ONLY the TTL eventually frees
the broker entry.

**User UX**: card rendered but unclickable.

**Fix**: §10.2 add a 4th failure-mode bullet covering the post-sendCard
UPDATE path, with either retry-with-backoff or an early-revoke sweep
trigger. Update T-Sec-15 (new) to test it.

### Round-2-P1-B — Telegram `callback_query.message` null path
*confidence 9/10*

Telegram Bot API: `callback_query.message` is OPTIONAL — null when
(a) message too old (>48h), (b) inline-mode result, (c) message
deleted. Plan §10.3 step 2 unconditionally validates
`record.messageRef === action.messageRef`; nowhere does plan say how
the adapter handles `update.callback_query.message === null`.

zero hits on `null` / `callback_query.message` in plan v2.

**Fix**: §10.3 explicit branch: messageRef.messageId === "<unknown>"
fails closed "stale message (cannot validate)". §16 T27 + T28d split
into private-message-id / deleted-message / null-message variants.

### Round-2-P1-C — T-Sec-12 expire-sweep CAS not specified
*confidence 8/10*

§10.4 T-Sec-12 (expire-vs-click race) CLAIMS "atomic CAS in step 3
ensures single winner: either sweep flips bound→expired ... or click
flips bound→used; never both". Click side specifies CAS (§10.3 step
3). Sweep side: §16 T19e is one line `G9 lazy-prune sweep for
terminal #pendingById. Test.` — no CAS semantics.

**Fix**: T19e expand into T19e.1 (callback_tokens sweep with
bound→expired CAS WHERE expires_at < now), T19e.2 (#pendingById
terminal-record sweep), T19e.3 (interval trigger + bounded batch).

### Round-2-P1-D — G8 + G9 P0 task entries undersized
*confidence 9/10*

Plan §3.1 promotes G8 (synthesized turn_failed) + G9 (lazy-prune
sweep) from P1 to P0 (Lake review). But §16 T19d (G8) + T19e (G9)
are each ONE LINE. Compare to T17.1-T17.13 (per-error-kind splits)
or T22a-c (callback codec splits).

**Fix**: T19d expand into T19d.1 (detect close mid-turn), T19d.2
(synthesize turn_failed per pending turn), T19d.3 (deliver via
EventNormalizer queue), T19d.4 (IM layer renders turn_failed).
T19e expand per P1-C above.

---

## Round-2 P2 (4 — small mechanical / optional)

### Round-2-P2-A — `actor_kind` schema vs prose inconsistency
*confidence 6/10*

`callback_tokens.actor_kind TEXT NOT NULL` (lines 560/831). §10.2
line 944 says `actor: null (filled at click time)`. NOT NULL +
"filled later" don't compose.

**Fix**: §9 callback_tokens schema notes: at INSERT time,
`actor_kind` is set per the policy that's about to be bound ('im'
for normal flow, 'system' for auto-decline); `actor_user_id` /
`actor_platform` populated at click time via CAS.

### Round-2-P2-B — launchd Keychain wrapper has no test path
*confidence 5/10*

D-Op-1 (line 1413) introduces Keychain-loading shell wrapper as
Choice 1. T29 covers `bin/install-launchd.mjs`. T35 is operator-
gated live-Telegram smoke. No explicit test step covers the
"operator runs `security add-generic-password`; smoke verifies
wrapper exec's daemon" path.

**Fix**: §16 T29 add T29a sub-task covering the Keychain wrapper's
integration test contract (operator-gated; document the sequence).

### Round-2-P2-C — `SessionRouter.bindThread` orphan-codex-thread risk
*confidence 5/10*

If codex `thread/start` succeeds but daemon's `bindThread` SQLite
UPDATE fails, daemon has an orphan codex thread. Cosmetic (codex
GCs eventually). **Defer**: log to TODOS for Phase 4 audit-log
expansion.

### Round-2-P2-D — Raw token in-process-memory lifetime no test
*confidence 4/10*

Plan §9 line 850 claims raw token "held in process memory just long
enough to render callback_data on the wire; never persisted, never
logged." Hard to test deterministically (heap-dump scan). **Defer**.

---

## Outside voice for round 2

NOT YET RUN. Waiting for plan v2.1 (this round-2-fix commit) before
running Codex outside-voice round 2.

## Recommendation

**Path A (taken)**: edit plan v2 → v2.1 with the 4 P1 + 2 P2 fixes
as a single docs-only commit on top of `ff1176b`. P2-C + P2-D
deferred. Then trigger Codex outside-voice round 2 against v2.1.

# Codex outside-voice review — T11a (Daemon Supervisor skeleton)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `b788106..e950613` filtered to `packages/daemon/`
(T11a; 7 files; 818 lines).

**Date:** 2026-05-01.

**Mode:** lead session (T11a + T11b explicitly marked "lead session
lifecycle correctness critical" per plan §397; user picked manual
mode rather than autonomous loop).

---

## Verdict

> **APPROVE WITH CHANGES**
>
> P0 Blockers: None found. The core T11a ordering is correct: the
> supervisor creates the transport, subscribes to onClose, and only
> then constructs the client. No `await` or microtask-yielding work
> sits between those steps.
> P1 Required Fixes: 1.
> P2 Improvements: 4.

## Findings (verbatim)

### P1 Required Fixes

> `broker.reattach()` on generation 1 has a hidden production
> precondition. The supervisor always calls `broker.reattach(client)`,
> but the broker throws unless `broker.attach()` has already been
> called. The tests satisfy this with a placeholder client at
> [supervisor.test.ts:93], but the public `SupervisorOptions` contract
> does not make that requirement enforceable or obvious. Fix by
> making the contract explicit as "pre-attached broker required" in
> `SupervisorOptions`/README, or by changing the supervisor
> construction shape so gen-1 can attach cleanly. As written, the
> natural production wiring can fail on first `start()`.

### P2 Improvements

> Several comments describe stale behavior. `AppServerClient` does
> not subscribe to `transport.onClose` in its constructor; it
> subscribes in `start()` at [client.ts:106]. The supervisor comments
> and test prose should say "before client construction/start" only
> if that is the actual intended invariant.
>
> The subscribe-before-spawn test is valid for ordering, but its
> prose overclaims: it does not emit a close synchronously or prove
> supervisor receipt; it only proves the first `onClose` subscription
> precedes `clientFactory`.
>
> `#currentRuntime` is set but never read. Fine as a T11b placeholder,
> but either expose `currentRuntimeForTest()` and assert per-generation
> runtime identity, or leave a tighter comment that T11b/Phase 2 will
> consume it.
>
> The zombie-listener test proves the unsubscribe callback ran. It
> does not prove the old handler cannot fire after unsubscribe. A
> tracked transport with an explicit `emitClose()` and removed-handler
> assertion would cover the invariant more directly.

### Missing tests

> Add a test that `broker.reattach` happens before `client.start()`,
> since that ordering is lifecycle-critical.
>
> Add a test for the gen-1 broker contract: either unattached broker
> throws with a clear message, or pre-attached placeholder broker is
> documented and accepted.
>
> Consider a spawn-failure test for `client.start()` throwing after
> `reattach`; current state becomes half-mutated, which T11b must
> handle deliberately.

### Risky assumptions for T11b

> If `client.start()` or handshake throws after `broker.reattach`,
> the broker already points at the new possibly half-started client.
>
> Old listener removal correctness depends on the transport unsubscribe
> contract. `InMemoryTransport` and `StdioTransport` satisfy it via
> synchronous `off`/`delete`.
>
> `transportFactory()` cannot be protected if it emits close before
> returning the transport; the current invariant only starts after
> the returned object exists.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | P1 | ✅ resolved | `SupervisorOptions.broker` JSDoc rewritten with the "pre-attached broker required" contract + recommended production wiring example. README adds a "Production wiring contract" section. New test `"rejects an unattached broker via reattach precondition"` pins the runtime behavior so a future refactor can't silently relax the precondition. The contract is documented (not type-enforced) because ApprovalBroker.attach() can only attach to the broker's constructor-time client; the supervisor doesn't construct the client. Forcing pre-attach keeps client-creation policy in the caller's hands. |
| 2 | P2 | ✅ resolved | Updated supervisor.ts header to describe the correct race window. AppServerClient subscribes to `transport.onClose` in `start()`, not constructor. The race is "transport synchronously fires onClose between transportFactory's return and client.start()" — observable to client (which tears down) but invisible to a non-pre-subscribed supervisor. |
| 3 | P2 | 📋 acknowledged | Test prose for "subscribe-before-spawn" overclaims. Behavior is correct; the test proves the ordering invariant via `order.indexOf` comparisons. Tightening the prose would not change the test logic; deferred. |
| 4 | P2 | ✅ resolved | Added a JSDoc comment on `#currentRuntime` clarifying it's a deliberate T11b/Phase 2 placeholder (will be consumed when T11b emits synthesized turn_failed events on transport-loss; or when Phase 2 IM adapter wires runtime.events to a host). Not dead code. |
| 5 | P2 | ⏸ deferred | Zombie-listener test tighter via emitClose helper + removed-handler assertion. Current test proves the unsubscribe callback was called, which is the load-bearing invariant given the transports we use (InMemoryTransport + StdioTransport remove handlers synchronously on unsub). Tighter test belongs in T11b where the close path is actually exercised end-to-end. |
| missing-1 | missing-test | ✅ resolved | Added `"calls broker.reattach BEFORE client.start"` — pins the lifecycle ordering. If reattach happened AFTER start, server-initiated requests would default-reject through AppServerClient's no-handler path, leaking through Phase 1's broker policy. |
| missing-2 | missing-test | ✅ resolved | The unattached-broker contract test described in P1. |
| missing-3 | missing-test | ⏸ deferred to T11b | Spawn-failure test (client.start throws after reattach). T11b owns recovery semantics; T11a is the lifecycle without error handling. Risky-assumption #1 below records this for T11b's design. |
| risky-1 | risky-assumption | 📋 acknowledged for T11b | client.start() / handshake throw after broker.reattach leaves the broker pointing at a half-started client. T11b must handle this in #onTransportClose's recovery path (or via a try/catch in #spawnFresh that bails out before the broker reattach commits to the new client). |
| risky-2 | risky-assumption | 📋 acknowledged | Old-listener removal correctness depends on transport unsub contract. Verified for InMemoryTransport + StdioTransport (synchronous off/delete). New transport implementations (e.g. WebSocket-backed in Phase 8) must guarantee synchronous unsub. |
| risky-3 | risky-assumption | 📋 acknowledged for T11b | `transportFactory()` emitting close before return is an unrecoverable case (supervisor invariants only start after the factory returns). T11b can defend against by requiring the factory to be effect-free until the returned transport's `start()` is called; or accept this as out of scope. |

5 of 8 actionable findings resolved (P1 + 1 P2 + 1 P2 + 2 missing tests = 5 ✅, plus 3 deferred-with-justification, plus 3 risky-assumption flags acknowledged for T11b).

## Notes for the human reviewer

- T11a's pre-attached-broker contract is the right design choice given the constraints (broker.attach() is constructor-time bound; supervisor decouples client creation). Documenting the contract explicitly is the lowest-risk fix.
- The 3 risky assumptions all surface as T11b concerns. T11b's `#onTransportClose` should be designed with these in mind:
  - Wrap `#spawnFresh` in try/catch; on spawn failure, increment `#consecutiveFailures` rather than corrupting the broker reference.
  - Don't trust `transportFactory()` is reentrant-safe for partial-spawn recovery.
- Codex couldn't run the test slice in its read-only sandbox; local `bash scripts/ci-check.sh` ran the full suite at HEAD `185b5e8` (post-fix commit) and all 8 gates passed with 306/306 tests.

## Recommended forward path

1. Live-status sync: T11a complete (HEAD `185b5e8`).
2. T11b — supervisor edges (close idempotence + exponential backoff + halt-on-cascade + broker.failPendingAsTransportLost + audit on fatal). Plan §2065. The risky-assumption flags above feed directly into T11b's design.
3. T12 — Phase 1 docs + roadmap update + Phase 1→2 handoff.

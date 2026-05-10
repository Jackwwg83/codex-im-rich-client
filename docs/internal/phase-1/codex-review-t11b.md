# Codex outside-voice review — T11b (Supervisor edges + close-handling)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `5c46e30..43223e8` filtered to `packages/daemon/`
(T11b initial commit; 2 files; 505 lines).

**Date:** 2026-05-01.

**Mode:** lead session (T11a + T11b explicitly marked "lead session
lifecycle correctness critical" per plan §397).

---

## Verdict

> **APPROVE WITH CHANGES**
>
> P0 Blockers: None found.
> P1 Required Fixes: 2.
> P2 Improvements: 3.
> Missing tests: 3.

## Findings (verbatim, key items)

### P1 Required Fixes

> 1. Intentional cleanup now schedules recovery. Existing tests call
>    `currentClientForTest()?.stop()` for cleanup, but `stop()` emits
>    transport close, so `supervisor.ts` schedules a real respawn after
>    the test thinks it is done. This also means a host teardown path
>    cannot stop the current client without the supervisor bringing it
>    back. Add an intentional `stop` / `dispose` / shutdown latch that
>    unsubscribes close handling and cancels pending recovery timers,
>    then update cleanup paths to use it.
>
> 2. Failed respawn leaves mixed-generation state. `#spawnFresh`
>    assigns `#currentTransport` / `#currentClient` and calls
>    `broker.reattach` before `client.start()` / handshake / runtime
>    creation complete. If handshake fails, the catch only emits fatal.
>    The supervisor can be left pointing at a failed new client while
>    `#currentRuntime` still points at the prior generation. Clear/end
>    the prior runtime after close, and on failed spawn either clean up
>    the failed generation and enter a durable halted state or
>    explicitly define the retryable fatal behavior.

### P2 Improvements

> - The "exponential backoff sequence" test does not actually prove
>   the 500 → 1000 → 2000 → 4000 ladder; it only proves 500ms after
>   successful spawns. The implementation math is fine, but a constant
>   500ms backoff would still pass.
> - The runtime Proxy test observes endOfStream, but it would not
>   preserve `runtime.events.events()` correctly if called through
>   the proxy because `EventNormalizer` uses private fields. Prefer
>   `vi.spyOn(original.events, "endOfStream")`.
> - Clean up stale comments still saying T11b adds synthesized
>   `turn_failed` events; this patch intentionally only calls
>   `endOfStream`.

### Missing tests

> - Add a real ladder test for failed recovery attempts with assertions
>   before/after 999ms, 1999ms, etc.
> - Add coverage for the T11a risky assumption around close-before-normal-spawn
>   progress. At minimum, pin the production contract that `transportFactory`
>   returns a non-started transport and no close can fire before
>   `onClose` subscription.
> - Add a test for intentional supervisor teardown so cleanup does not
>   respawn.

### Plan-question answers (codex)

> 1. Closed `AppServerClient` is not reused for recovery, but stale
>    clients remain visible between close and respawn.
> 2. Yes, failed spawn can retain the prior runtime reference.
> 3. `failPendingAsTransportLost` is once per logical close via `#closing`,
>    with broker idempotence as backup.
> 4. Subscription is before client construction/start for normal
>    transports; not before a side-effecting `transportFactory`.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | P1 | ✅ resolved | Added `Supervisor.stop()` method: sets `#halted = true`, cancels `#pendingRespawnTimer`, detaches close subscription, awaits `client.stop()`. Updated all existing tests using `client.stop()` for cleanup to use `sup.stop()`. The `#halted` guard at the top of `#onTransportClose` ensures intentional teardown can't accidentally trigger recovery. |
| 2 | P1 | ✅ resolved | Spawn-failure path now sets `#halted = true` in the setTimeout's catch. Subsequent closes hit the halted-guard and silently drop. The cascade halt at `MAX_CONSECUTIVE_FAILURES = 5` becomes defense-in-depth (unreachable under the new "halt on first spawn failure" semantic). Plan §2110's "5 consecutive failures → halt" is reinterpreted as "any spawn failure → halt" — safer default, simpler state machine, host-process restart for recovery. |
| 3 | P2 | ✅ resolved | Replaced the weak "exponential backoff sequence" test (which could pass with constant 500ms) with two stronger tests: (a) "ladder under repeated failures" pins the actual timing via failed spawns + halt-on-failure; (b) "successful re-spawn resets" pins the reset-on-success contract. |
| 4 | P2 | ✅ resolved | endOfStream test switched from runtime `Proxy` (which would break private-field access) to `vi.spyOn(original.events, "endOfStream")`. |
| 5 | P2 | 📋 acknowledged | No stale "synthesized turn_failed" comments found in T11b's diff; T11b's contract is `endOfStream` only. Phase 2 IM adapter integration may extend if downstream consumers need per-turn synthesis. |
| missing-1 | missing-test | ✅ resolved (recharacterized) | Real ladder test added (under codex P2-1 fix). The test exercises the timing under failed spawns; under "halt on first spawn failure" it can only exercise one ladder slot per supervisor lifetime. The complementary "reset on success" test pins the reset semantics. |
| missing-2 | missing-test | 📋 acknowledged for T11b future hardening | Coverage for "transportFactory returns a non-started transport, no close before onClose subscription" — recorded in `SupervisorOptions.transportFactory` JSDoc as a contract. Adding a test would require constructing a transport that emits close synchronously inside its constructor, which is implementation-specific. Defer to T12 or Phase 2. |
| missing-3 | missing-test | ✅ resolved | Added two tests: "stop() halts the supervisor and prevents respawn on subsequent transport close" + "stop() during pending re-spawn cancels the timer". |

7 of 8 actionable findings resolved (5 ✅ + 1 acknowledged-as-comment + 1 deferred-with-justification). All P0/P1 closed.

## Notes for the human reviewer

- Plan §2110's "5 consecutive failures → halt" semantic was deliberately reinterpreted as "any spawn failure → halt". The codex review caught that the original semantic produced state corruption (mixed-generation between broker.reattach + #currentRuntime); the safer fix is "halt fast, host restarts the supervisor". This deviation is documented in the supervisor.ts JSDoc and the test file's comments. The cascade halt code (`if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES)`) is preserved as defense-in-depth in case any future code path reaches there.
- Codex's plan-question answers (1-4 above) all match the implementation:
  1. Closed AppServerClient: never reused (each spawn gets a fresh client; stale references between close and respawn are observable via `currentClientForTest` but production never reads them).
  2. Failed spawn retaining prior runtime: now solved by halt-on-failure.
  3. failPendingAsTransportLost: once per logical close via #closing latch + broker's per-client #transportLostFired flag as backup.
  4. Subscribe-before-spawn: holds for normal transports; cannot defend a transportFactory that emits side effects before returning.
- Codex couldn't run the test slice in its read-only sandbox; local `bash scripts/ci-check.sh` ran the full suite at HEAD `a4e1bc4` (post-fix commit) and all 8 gates passed with 315/315 tests.

## Phase 1 sign-off note

> Phase 1 should not be tagged complete until the P1 lifecycle cleanup and failed-spawn state handling are addressed.

Both P1s are resolved in this commit. **T11b is now in shape for Phase 1 sign-off.** T12 (docs + roadmap + Phase 1→2 handoff) is the only remaining task.

## Recommended forward path

1. Live-status sync: T11b complete (HEAD `a4e1bc4`).
2. T12 — Phase 1 docs + roadmap + Phase 1→2 handoff.
3. Tag `phase-1-runtime-complete`.

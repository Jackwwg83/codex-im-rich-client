# Codex outside-voice review — T9b (ApprovalBroker edges + reviews)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `0a4bf72..bf97a49` filtered to `packages/core/`
(T9b Steps 9b.1-9b.6; 4 logical commits; 909 lines).

**Date:** 2026-05-01 (autonomous overnight wake 5).

**Mode:** autonomous loop — autonomous halted on this review per the
protocol's "blocker → STOP" rule. Findings captured here for the
human reviewer; no fixes applied.

---

## Findings (verbatim)

> **blocker** — [approval-broker.ts:496]
> `expirePending()` side-band calls `client.respond()` / `client.reject()`
> while the original `AppServerClient.dispatchServerRequest()` is still
> awaiting `#handle()`. If the registered handler later settles,
> AppServerClient will send a second response for the same JSON-RPC id.
> The current test uses a never-resolving handler, so it misses this
> duplicate-response path.
> Suggested fix: make `#handle()` own a single completion promise per
> pending record, and have `expirePending()` settle that promise
> instead of calling `client.respond()` directly. Late handler
> completion should be ignored after the record is terminal.
>
> **blocker** — [approval-broker.ts:433]
> `#transportLostFired` is never reset on `reattach()`. Since this
> broker is explicitly designed to survive client replacement, the
> first transport close permanently disables future
> `failPendingAsTransportLost()` calls after reattach. A second
> transport generation can leave pending records stuck as `pending`.
> Suggested fix: reset `#transportLostFired = false` after a
> successful `reattach(newClient)`. Existing terminal records are
> already skipped by the status check.
>
> **medium** — [approval-broker.ts:395]
> Terminal records are not actually retained for audit if the original
> handler eventually settles. `failPendingAsTransportLost()` and
> `expirePending()` mark records terminal and comments say records
> remain in `#pending`, but `#handle()` always deletes the entry in
> `finally`.
> Suggested fix: delete only when the map still points at this record
> and `record.status === "pending"`. Terminal records should remain
> until an explicit prune path exists.
>
> **medium** — [approval-broker.test.ts:519]
> `expirePending` coverage misses the two riskiest edges: auth-refresh
> defaultReject throwing `JsonRpcResponseError`, and a handler that
> resolves after expiration. The current never-resolving handler hides
> duplicate-response and terminal-record deletion bugs.
> Suggested fix: add an auth-refresh expiration test expecting
> `client.reject(-32601)` and a late-resolving handler test that
> proves only one wire response is sent and the expired audit record
> remains.
>
> **low** — [approval-broker.test.ts:480]
> The never-resolving `emitServerRequest(...).catch(() => {})` calls
> leave the fake server's default 5s timeout timers alive after the
> test body completes. `client.stop()` does not cancel those promises.
> Suggested fix: pass a short `timeoutMs` and await the caught
> promise, or use controlled release handlers so test-owned promises
> settle before teardown.
>
> **nit** — [approval-broker.ts:531]
> `_pendingRecordsForTest()` returns a defensive copy of the map, but
> aliases mutable `ApprovalRecord` objects. That is okay for current
> tests but weaker than the method name implies.
> Suggested fix: return cloned records and type it as
> `ReadonlyMap<string | number, Readonly<ApprovalRecord>>`.

## Codex's positive findings (worth recording)

> `reattach()` checks the dangerous cases before mutating the old
> client: unattached broker, same instance, and target already claimed
> are all refused before detaching the prior handler.
>
> `#handle()` inserts the pending record before invoking the handler,
> so synchronous handler throws still pass through the `finally`
> cleanup path.
>
> `failPendingAsTransportLost()` is idempotent within one client
> generation and correctly sets a system actor plus denied decision
> without calling `client.respond()`.
>
> The dispatch table is still tied to `ServerRequest["method"]`
> through the exhaustive type guard, so method handling is derived
> from the generated union at the broker boundary.
>
> The grep guard scope is mostly right: it excludes protocol/generated
> code and tests, and I verified `git grep` returns the no-match
> status when the future `packages/daemon/src/` path does not exist.
> Split-string literals remain a known false negative, but that is
> probably out of scope for this guard.

## Resolution status

| # | Severity | Status | Notes |
|---|---|---|---|
| 1 | **blocker** | ⏸ STOPPED — needs human review | Duplicate-response race. Fix is non-trivial: `expirePending` and `failPendingAsTransportLost` cannot directly call `client.respond` while a handler is in flight. Cleanest design needs either an AppServerClient extension (idempotent respond by id — Phase 0 contract change, out of T9b scope) or a #handle refactor that owns a single completion promise per pending record (substantive + needs design discussion). The autonomous loop did NOT apply a fix — recommending you decide the design path before merging T9b. |
| 2 | **blocker** | ⏸ STOPPED — needs human review | `#transportLostFired` reset on reattach. The fix itself is one line + one test (reset to `false` after `reattach`'s WeakSet swap), but I bundled it with blocker 1 on STOP because the user should look at both in one sitting and may want to refactor the lifecycle holistically. |
| 3 | medium | ⏸ STOPPED | Related to blocker 1: if `#handle`'s `finally` always deletes, terminal records produced by `failPendingAsTransportLost` / `expirePending` are wiped when the handler eventually settles. The "records remain for audit" claim in the JSDoc is currently false in practice. Solving this together with blocker 1 makes sense (the same `currentRecord.status === "pending"` check gates both the delete AND the late `client.respond`). |
| 4 | medium | ⏸ STOPPED | Test coverage gap. Adding the two missing tests (auth-refresh expiration + late-resolving handler) is the leverage that would have caught blocker 1 in T9b's own gates. Should land alongside the blocker 1 fix. |
| 5 | low | ⏸ STOPPED | Dangling fake-server timeout timers from never-resolving emitServerRequest calls. Test hygiene; can land with the blocker fixes since the new "controlled release" pattern covers it naturally. |
| 6 | nit | ⏸ STOPPED | `_pendingRecordsForTest()` returns aliased mutable records. Trivial fix (`structuredClone` per record + `ReadonlyMap<…, Readonly<ApprovalRecord>>`). |

0 of 6 findings fixed (autonomous loop halted on blocker 1).

## Notes for the human reviewer (next morning)

The autonomous loop paused itself on this review because both blockers
require design judgment, not pattern-application:

1. **Blocker 1 design space** (duplicate-response race):
   - Option A — extend AppServerClient with `respond` / `reject` idempotence (track responded ids, silently drop duplicates). Phase 0 contract change; would land as Pre-4.
   - Option B — refactor `#handle` to own a completion promise per record. `expirePending` settles the promise with the default-reject value; the original handler's eventual settlement is observed by `#handle` but only sent if record is still pending. This stays inside T9b's authorized files (packages/core/) but changes #handle's contract.
   - Option C — accept the race for Phase 1 (the never-resolving handler test passes; real codex 0.125 in normal flow would resolve before expirePending's 10-min default cutoff). Document as known limitation, fix in Phase 2 when IM integration introduces real resolve() callers. Risky — the default cutoff is operator-tunable.

2. **Blocker 2** is a clear one-line fix; bundled here because you'll likely want to address all six findings together in one fix commit.

3. **Test surface evidence** — the never-resolving handler tests in T9b's coverage are exactly why this race wasn't caught by the local gates. Steps to reproduce manually:
   ```ts
   broker.registerHandler("item/fileChange/requestApproval", async () => {
     await new Promise((r) => setTimeout(r, 5000));
     return { decision: "decline" };
   });
   const respP = fake.emitServerRequest("item/fileChange/requestApproval", {}, 999);
   await new Promise((r) => setTimeout(r, 100));
   broker.expirePending(50);  // emits one wire response
   const resp1 = await respP;  // resolves with default-reject
   await new Promise((r) => setTimeout(r, 6000));  // handler eventually returns
   // AppServerClient.dispatchServerRequest's await #handle resolves;
   // then calls this.respond(id, handlerResult) — DUPLICATE.
   ```
   Codex didn't run this against the diff but the analysis is sound.

4. T9b's grep guard test (Step 9b.6) is correct and DOES pass at HEAD. That part of T9b can land independently if you want to keep the boundary discipline locked in while the lifecycle work is being designed.

## Recommended forward path

After your morning review, the cleanest sequence is:

1. Decide the design for blocker 1 (Pre-4 AppServerClient extension vs. T9b internal refactor).
2. Land that design + blocker 2 + the medium fixes + the missing tests in a single follow-up commit (call it T9b.fix or part-3).
3. Re-run codex review. If clean, proceed to T10 (CLI).
4. T11/T12 still need explicit user approval per the autonomous-mode hard stops.

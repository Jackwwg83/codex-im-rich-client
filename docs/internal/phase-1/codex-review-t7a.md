# Codex outside-voice review — T7a

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `b060a6a..649d631` (T7a only — EventNormalizer
skeleton + happy path; 5 files, 590 lines).

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. **High: `return()` closes the whole normalizer, not one iterator.**
>    `events()` returns fresh iterator objects, but they all share
>    `#queue`, `#waiters`, and `#closed`. One iterator calling
>    `return()` reaches `#close()`, unsubscribes from
>    `client.onNotification`, clears the shared queue, and resolves
>    every pending waiter as done.
>    That is single-consumer semantics, not independent iterator
>    semantics. It will also break T7b filtered sub-iterators unless
>    T7b adds a central fan-out layer.
>
> 2. **High: malformed known notifications become typed events with
>    empty IDs.**
>    The `""` fallback is too forgiving for load-bearing IDs. A
>    malformed `turn/started` can become
>    `{ type: "turn_started", threadId: "", turnId: "" }`, which
>    downstream state code can treat as real.
>    Better: if required fields are missing or wrong type, emit
>    `{ type: "unknown", method, params }` or a `malformed` event with
>    `raw`. Fail-open should mean "do not crash", not "emit corrupted
>    typed state".
>
> 3. **Medium: `#close()` semantics are only correct for caller
>    cancellation.**
>    Dropping `#queue` on close is fine for `iterator.return()`. It is
>    wrong if T7b reuses the same close path for `transport.onClose`:
>    already-buffered notifications would be lost instead of drained
>    before `{ done: true }`. Split "subscriber cancelled" from
>    "source ended".
>
> 4. **Medium: current multi-iterator behavior is under-specified and
>    dangerous.**
>    If iterator A and B both call `.next()`, each event goes to only
>    one waiter. That is work-queue semantics. If callers expect
>    broadcast, this is a bug. If callers expect single-consumer,
>    `events()` should document that and probably not imply fresh
>    independent streams.
>
> 5. **Medium: tests do not lock the important cancellation races.**
>    Add tests for: pending `next()` resolves `{ done: true }` after
>    `return()`; iterator A returning does not kill iterator B if
>    broadcast is intended; two queued events plus two waiters
>    preserve FIFO; malformed load-bearing frames do not produce
>    typed events.
>
> 6. **Low: `void this.#deltaSoftCap` / `void this.#totalHardCap` is
>    noise.**
>    Cleaner: do not store these fields until T7b, or keep a single
>    private options object only when used. `@ts-expect-error` would
>    be worse.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | HIGH | ✅ resolved | `events()` now caches the iterator and returns the SAME instance on every call. Multiple callers share one queue; iterator.return() correctly closes the (single) shared stream. T7b's filtered sub-iterators will be derived OVER this single stream, not as parallel consumers — keeping the producer side single-output. New test: `events() returns the SAME iterator on every call`. |
| 2 | HIGH | ✅ resolved | Each typed mapping case validates required fields (`typeof === "string"` for IDs) BEFORE constructing the typed event. On validation failure, falls through to `unknownEvent(msg)`. Three new regression tests cover: malformed turn/started (missing turn.id) → unknown; malformed item/started (non-string itemId) → unknown; malformed item/agentMessage/delta (delta not a string) → unknown. |
| 3 | medium | ✅ documented | Renamed internal `#close()` to `#cancelConsumer()` and documented it as the caller-cancellation path. T7b will add a separate `endOfStream()` path (transport.onClose) that drains the queue before signaling done. The two intents are now intentionally separate methods. |
| 4 | medium | ✅ resolved (by #1 fix) | `events()` cached + same instance on second call → no parallel-consumer footgun. Documented as single-consumer in the JSDoc + a runtime test that asserts work-queue (not broadcast) semantics: shared queue, one event per `.next()` call across the shared iterator. |
| 5 | medium | ✅ resolved | 5 new tests added (4 from codex's list + 1 for #1's fix): pending-next-resolves-done-after-return; two-queued-events-preserve-FIFO-with-two-waiters; malformed turn/started, item/started, agentMessage/delta → unknown; events() returns same iterator. |
| 6 | low | ✅ resolved | Removed `#deltaSoftCap` / `#totalHardCap` field declarations + `void` hack from T7a. The `NormalizerOptions` keys are still accepted on construction (forward-compatible — callers can pass them today), but the values are not stored until T7b adds the walk-and-drop logic. Constructor's options parameter renamed to `_opts` to satisfy the unused-param lint. |

6 of 6 findings fixed.

## Codex's positive findings

> `queueMicrotask` after `return()` is guarded well enough: unsubscribe
> removes the handler, and `#closed` also rejects late delivery. JS
> run-to-completion means `return()` cannot interleave inside a
> currently executing handler.
>
> FIFO drain is fine for one consumer: `shift()` from both `#waiters`
> and `#queue` preserves arrival order.
>
> Synchronous notification during construction should still buffer:
> fields are initialized before constructor body, and
> `#onNotification()` does not need `#unsub`.
>
> No obvious accidental Phase 2/3/4 work in the diff.

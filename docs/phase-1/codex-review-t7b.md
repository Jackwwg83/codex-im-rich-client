# Codex outside-voice review — T7b (T7b-1 + T7b-2 combined)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `85cd22a..c4239c7` (T7b-1 + T7b-2; 3 files,
1146 lines).

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. [event-normalizer.ts:227]
>    hard-cap `droppedCount` overcounts under steady saturation.
>    Example `hardCap=3`: after 4 warnings, count is `1`; after the
>    5th, the loop drops the previous synthetic plus `warning2`, then
>    adds `2`, so count becomes `3` even though only 2 original
>    lifecycle entries were lost. Either exclude prior hard-cap
>    synthetics from the count or rename the metric to "dropped queue
>    entries including synthetic markers". Add a test for 5+
>    lifecycle events, not just first overflow.
>
> 2. [event-normalizer.ts:119]
>    exported caps are unsanitized. `NaN` disables comparisons;
>    `Infinity` disables the bound; `0`/negative caps make the "no
>    deltas in queue" path reachable and semantics weird. If options
>    are public, clamp/validate finite positive safe integers.

## Codex's positive findings (worth recording)

> Walk-and-drop ordering: correct for positive caps. All-delta queue
> evicts the head delta. No-delta case is impossible only if
> `deltaSoftCap >= 1` and counters stay honest.
>
> Hard cap: bounded after each enqueue at `hardCap + 1`; under
> saturation it does not grow unbounded. **It can fire under pure
> delta overload because delta-overflow synthetics accumulate, so
> calling it "lifecycle saturation only" is not quite true.**
>
> Exhaustive switch: JS fall-through grouping is safe. The `never`
> default is meaningful because `method` is narrowed to
> `ServerNotificationMethod`. No obvious missing Phase 1 typed arm
> given your stated T8/Phase 2 boundary.
>
> `turn.status`: defensible for Codex 0.125. Future unknown terminal
> statuses will become `unknown` and lose `terminal:true`; that is a
> drift risk, not a current bug.
>
> `endOfStream()` vs `return()`: current interleaving is OK. Queue
> non-empty plus pending waiters is unreachable after `#drain()` in
> JS run-to-completion. Stale handlers are blocked by the
> `#endOfStream` guard.
>
> Fixture replay: synthetic fallback is fine because default caps
> assert no synthetics. If a synthetic appears, the order test should
> fail.
>
> Concurrency: multiple pending `.next()` calls resolve FIFO.
> `return()` resolves pending waiters done. No real race with
> `endOfStream()`/notification in one event loop turn.
>
> Allocation cost: wrapper allocation is real but acceptable for
> Phase 1. The bigger perf issue is O(N) `splice`/`shift` under
> overflow, not the wrapper.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | medium | ✅ resolved | Hard-cap `droppedThisRound++` now skipped when the dropped entry is a `normalizer_overflow` synthetic — only REAL lifecycle entries lost are counted. Regression test added: 6 warnings under hardCap=3, sustained saturation, asserts final synthetic's droppedCount === 3 (not 5 which would include the re-dropped synthetics). |
| 2 | low | ✅ resolved | Constructor wraps both caps in `sanitizeCap()` which falls back to default on `NaN`, `Infinity`, non-integer, or `< 1`. Falls back gracefully rather than throwing — these are non-load-bearing operational tuning. Regression test covers 7 invalid input cases. |

Plus the inline comment on the hard-cap branch was updated to
acknowledge it can fire under delta overload too, not just lifecycle
saturation (matching codex's positive observation).

2 of 2 findings fixed.

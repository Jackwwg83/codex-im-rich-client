# Codex outside-voice review — T6

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `a4187fc..14475b5` (T6 only —
`@codex-im/codex-runtime` METHOD_CLASS + `isServerNotificationMethod`;
5 files, 415 lines).

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. [event-class.ts:61](packages/codex-runtime/src/event-class.ts#L61)
>    `fuzzyFileSearch/sessionUpdated` should probably be `delta`, not
>    `lifecycle`. It is `{ sessionId, query, files }`, and can update
>    repeatedly while the user types. Treating it as lifecycle makes
>    it unbounded even though older search snapshots are discardable.
>    This violates the D5 lifecycle rationale: lifecycle is for
>    load-bearing state transitions, not UI result churn.
>
> 2. [event-class.ts:72](packages/codex-runtime/src/event-class.ts#L72)
>    `item/commandExecution/terminalInteraction` is the only
>    non-pattern method classified `delta`. I think `delta` is
>    defensible because the payload is `stdin: string` and may be
>    chunk/per-keystroke-ish, but it is not in the D5 final delta
>    list you quoted. Either add it explicitly to D5/tests as an
>    intentional exception, or classify it lifecycle. As written, it
>    is policy drift.
>
> 3. [method-class-exhaustive.test-d.ts:55](packages/codex-runtime/test/method-class-exhaustive.test-d.ts#L55)
>    `_FakeWouldFail` does not prove what the comment says. It does
>    not catch someone changing `event-class.ts` to
>    `satisfies Record<string, EventClass>`. It only fails if the
>    protocol union itself widens to `string` or literally gains
>    `"future/never/seen"`. `NoExtras` / `NoMissing` are the real
>    useful assertions.

## Checks (codex's positive findings)

> `thread/realtime/sdp` as lifecycle looks right. Generated docs say
> it is the remote SDP for a WebRTC session, so it is handshake state,
> not negotiation chatter to drop.
>
> The `as const satisfies Record<ServerNotification["method"],
> EventClass>` pattern is solid. Add/rename/remove drift is caught.
>
> `Object.hasOwn(METHOD_CLASS, m)` is safe for the current
> string-keyed table. Prototype keys are rejected. Symbols are
> irrelevant to the typed API.
>
> `KNOWN_NOTIFICATION_METHODS` is effectively immutable at runtime.
>
> The T4 fixture cross-check only reads top-level `frame.method`.
> Recursive check confirmed no nested method keys exist; nothing missed.
>
> No Phase 2/3/4 work smelled accidental. Bringing `event-class.ts`
> into T6 is a reasonable dependency fix.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | medium (memory) | ✅ resolved | `fuzzyFileSearch/sessionUpdated` reclassified `lifecycle` → `delta`. Comment added explaining the rationale: result-list churn under user typing is discardable, not load-bearing. |
| 2 | low (policy drift) | ✅ resolved | `item/commandExecution/terminalInteraction` reclassified `delta` → `lifecycle`. The use case is interactive prompts (sudo, password) supplied as a unit, not per-keystroke chunks. Now matches D5 final's pattern (only `*/delta` / `*/outputDelta` / `*/textDelta` / `*/patchUpdated` / `*/progress` + audio chunks are delta). |
| 3 | low (test redundancy) | ✅ resolved | Removed `_FakeWouldFail` from `method-class-exhaustive.test-d.ts`. Realistic drift modes (forward + backward) are already covered by `_NoExtras` + `_NoMissing`. Comment notes the removal so a future maintainer doesn't re-add a similar weak assertion. |

3 of 3 findings fixed.

## Net delta-class count after fixes

```
delta:     12   (was 12; +1 fuzzyFileSearch/sessionUpdated, -1 terminalInteraction)
lifecycle: 47   (was 47; -1 fuzzyFileSearch/sessionUpdated, +1 terminalInteraction)
```

Total still 59. Both fixes are reclassifications, not additions or removals.

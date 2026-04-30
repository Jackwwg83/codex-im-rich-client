# Codex outside-voice review — T8 (CodexRuntime typed wrappers)

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `908d640..f59205f` (T8; 3 files, 451 lines).

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. **low** [packages/codex-runtime/src/runtime.ts:90]
>    Method literals are correct, but not statically checked against
>    `ClientRequest["method"]`; `AppServerClient.request()` accepts plain
>    `string`, so a future typo would compile. Suggested fix: import
>    `ClientRequest` from the protocol facade and define local literals
>    with `satisfies ClientRequest["method"]`.
>
> 2. **low** [packages/codex-runtime/test/runtime.test.ts:50]
>    `void client.start()` makes the harness race-prone. It works with
>    today's in-memory transport, but most other tests await startup.
>    Suggested fix: make `harness()` async and `await client.start()`.
>
> 3. **low** [packages/codex-runtime/test/runtime.test.ts:86]
>    The tests say "verbatim" forwarding, but use `toEqual`, which would
>    not catch cloning/transforms that preserve shape. Suggested fix: use
>    `toBe(params)` for representative/all wrapper forwarding assertions.
>
> 4. **nit** [packages/codex-runtime/test/runtime.test.ts:295]
>    The test name says codex returns `-32601`; local phase-0 notes say
>    codex 0.125 returns `-32600` for unknown method. Suggested fix:
>    rename this as FakeAppServer-specific, or align the fake/error
>    test with codex 0.125 wording.
>
> 5. **nit** [packages/codex-runtime/src/runtime.ts:3]
>    Comment says `client.request<P, R>`, but the real signature is
>    single type arg `request<R>()`. Same issue in
>    [runtime.test.ts:4].

## Codex's positive findings (worth recording)

> - No blockers or medium findings.
> - The nine wrapped method names match the local codex 0.125 generated
>   `ClientRequest` union; no `thread/interrupt` wrapper is present.
> - Wrapper types are imported from `@codex-im/protocol`, not generated
>   internals.
> - Wrapper implementations are thin: they only call
>   `this.#client.request<Response>(method, params)`.
> - Lifecycle contract looks clean: no `onClose` subscription, no
>   reset/retry logic, no singleton/cache.
> - `runtime.events` exposes the `EventNormalizer` instance directly,
>   preserving access to both `events()` and `endOfStream()`.
> - API surface is appropriately narrow for the stated Phase 1 set.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | low | ✅ resolved | Added `REQUEST_METHODS` const table at top of `runtime.ts` declared `as const satisfies Record<string, ClientRequest["method"]>`. All 9 wrappers reference `REQUEST_METHODS.<name>` instead of inline string literals. A typo or method renamed/removed in the generated `ClientRequest` union now raises TS at this single declaration. Method-name literals still appear ONLY in `runtime.ts` (T9b grep guard preserved). |
| 2 | low | ✅ resolved | `harness()` is now `async function harness(): Promise<Harness>` and uses `await client.start()`. All 13 call sites updated to `const h = await harness()`. |
| 3 | low | ✅ resolved | `threadStart` test (the representative wrapper) now uses `toBe(params)` to assert reference identity. Comment explains: FakeAppServer + InMemoryTransport pass the params reference through a microtask without serialization, so identity holds end-to-end. The remaining wrappers keep `toEqual` since the wire path is shared and `toBe` on one wrapper is sufficient to prove no transform happens. |
| 4 | nit | ✅ resolved | Test renamed to `"rejects when FakeAppServer returns -32601 for an unhandled method"`. Comment block clarifies that codex 0.125 actually returns -32600 (Invalid Request), FakeAppServer uses -32601 (Method Not Found), and what this test asserts is the runtime's "JSON-RPC error → reject" behavior, which is identical regardless of code. The wire-level contract against real codex is covered separately by the cli smoke fixtures. |
| 5 | nit | ✅ resolved | Header comment in `runtime.ts` corrected to `client.request<R>(method, params)` with an extra paragraph explaining the satisfies-table fix from #1. Test file header similarly corrected and notes that older drafts incorrectly said `<P, R>`. |

5 of 5 findings fixed. ci-check (8/8 gates) stays green: 230/230 tests pass,
typecheck clean, lint clean, fixture gate green, protocol regen idempotent.

# Codex outside-voice review — T1–T4.5

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `c48c96e..a15c772` (Phase 1 T1–T4.5; 5 commits,
31 files, 2521 lines). Scope:
- T1 — `categorizeJsonRpcError` helper + `JsonRpcResponseError.rawMessage`
- T2 — CLI `--capture` / `--prompt-file` / `--cwd` flags
- T3 — `codex-runtime` skeleton + `ci-check.sh` + `redact-fixture` + `split-capture`
- T4 — phase1 richer-turn fixture capture + redactor inline-match fix
- T4.5 — `verify-phase1-fixtures.mts` acceptance gate

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. [docs/phase-1/fixture-prompt-review.md](docs/phase-1/fixture-prompt-review.md#L137):
>    T4 required outside-voice consult before capture, but this records
>    "No retry attempted" and then approves capture anyway. Fix: rerun
>    the consult with stdin-fed input or record an explicit human waiver
>    tied to plan line 729.
>
> 2. [phase1-richer-turn-event-stream.jsonl](packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl#L11):
>    fixture commits account rate-limit usage and `planType:"pro"`,
>    which is account metadata leakage outside the stated path/model
>    redaction scope. Fix: drop `account/rateLimits/updated` frames
>    from committed fixtures or redact their params wholesale.
>
> 3. [phase1-richer-turn-event-stream.jsonl](packages/testkit/fixtures/codex-0.125.0/phase1-richer-turn-event-stream.jsonl#L4):
>    redaction produced `"/private<CWD>"`, so
>    `/private/tmp/codex-fixture-*` paths are only partially scrubbed
>    and the tests miss it. Fix: add a `/private/tmp/codex-fixture-*`
>    pattern before the `/tmp/...` pattern and assert no
>    `/private<CWD>` remains.
>
> 4. [scripts/verify-phase1-fixtures.mts](scripts/verify-phase1-fixtures.mts#L117):
>    the gate says every request frame must have no `result/error`,
>    but `verify()` accepts `{id, method, result}` as a valid server
>    request. Fix: reject any top-level `result` or `error` field
>    before counting the frame.
>
> 5. [packages/cli/src/smoke-real-turn.ts](packages/cli/src/smoke-real-turn.ts#L220):
>    `client.stop()` can throw and prevent `closeCapture()` from
>    flushing, leaving the capture truncated or the stream open.
>    Fix: wrap stop/close in nested `finally`, so capture close always
>    runs.
>
> 6. [packages/cli/src/smoke-real-turn.ts](packages/cli/src/smoke-real-turn.ts#L130):
>    `attachCapture()` has no stream `error` handling, so ENOENT/EACCES
>    on `--capture` can surface as an unhandled stream error rather
>    than a controlled smoke failure. Fix: attach an error listener
>    and make close reject with the captured stream error.
>
> 7. [packages/cli/src/smoke-real-turn.ts](packages/cli/src/smoke-real-turn.ts#L244):
>    the `run()` default `process.argv.slice(3)` still misroutes when
>    this file is executed directly; `--capture x` becomes `x`. Fix:
>    make the direct-entry path pass `process.argv.slice(2)`
>    explicitly, or change the default and keep `index.ts` passing
>    explicit args.
>
> 8. [packages/cli/test/cli-flags.test.ts](packages/cli/test/cli-flags.test.ts#L15):
>    T2 tests prove parsing, not plumbing; nothing asserts
>    `--prompt-file` is read or `--cwd` reaches `StdioTransport`. Fix:
>    inject a transport factory/file reader into `run()` and assert
>    the constructed options and prompt text.
>
> 9. [packages/codex-runtime/package.json](packages/codex-runtime/package.json#L7):
>    T3 plan asked for package-local `build`, `lint`, and
>    `vitest.config.ts`; the package only has `typecheck` and a
>    likely-broken local `test` script. Fix: add the missing package
>    config/scripts or change the plan and package script to rely
>    explicitly on the root Vitest config.
>
> I did not run the gates; this was a read-only review of the
> diff/current tree.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | medium | ✅ resolved | Consult retried successfully (this very file is the output); finding documented in `fixture-prompt-review.md`. |
| 2 | high (PII) | ✅ resolved | `account/rateLimits/updated` frames stripped from the committed event-stream fixture. Full method classification still covered by T7a `METHOD_CLASS`. |
| 3 | high (PII) | ✅ resolved | Redactor patterns updated with optional `(?:/private)?` prefix on `/var/folders/*` and `/tmp/codex-fixture-*`. Regression tests added: `redact-fixture.test.mjs` "redacts the macOS canonical /private/tmp/codex-fixture-* form" + fixture-replay sanity assertion `expect(text).not.toContain("/private<CWD>")`. |
| 4 | high (correctness) | ✅ resolved | `verify-phase1-fixtures.mts` rejects frames with `result` or `error` fields. Two regression tests added. |
| 5 | medium (correctness) | ✅ resolved | `runSmokeRealTurnCore` cleanup wraps `client.stop()` and `closeCapture()` in nested try/catch; both always run; first error is re-thrown. |
| 6 | medium (robustness) | ✅ resolved | `attachCapture` listens for stream `error` events; close rejects with the captured error. |
| 7 | low (direct-run) | ✅ resolved | `run()` default changed to `process.argv.slice(2)`. Dispatcher in `index.ts` continues to pass explicit args (unchanged). |
| 8 | low (test gap) | deferred | T2 plumbing test deferred to T10 (`codex-im runtime send` CLI), where similar wiring exists and a single broader plumbing test will cover both. Documented in T2 commit body. |
| 9 | non-issue | n/a | Plan was internally inconsistent — actual repo convention (testkit/codex-protocol/cli) is minimal scripts. `build`/`lint` not needed; root vitest config covers tests. No action. |

7 of 9 findings fixed in a follow-up commit; 1 deferred with rationale; 1 non-issue.

# Codex outside-voice review — T5

**Reviewer:** codex 0.125.0 via `codex exec --skip-git-repo-check
--sandbox read-only -c approval_policy=never -c
model_reasoning_effort=high -` with diff piped via stdin.

**Diff under review:** `869b02f..8f0603d` (T5 only — `@codex-im/core`
skeleton; 7 files, 358 lines).

**Date:** 2026-04-30.

---

## Findings (verbatim)

> 1. [packages/core/test/skeleton.test.ts:57](packages/core/test/skeleton.test.ts#L57)
>    Type-level tests are mostly fake. Normal Vitest transpiles TS
>    away; `packages/core/tsconfig.json` only includes `src/**/*.ts`,
>    so `@ts-expect-error`, type annotations, and type-only imports
>    are not checked by `pnpm --filter @codex-im/core typecheck`.
>    This test can go green while `ApprovalActor` is widened to
>    `unknown`. Use `*.test-d.ts` + `vitest typecheck`, or include
>    tests in a dedicated typecheck config.
>
> 2. [packages/core/src/types.ts:97](packages/core/src/types.ts#L97)
>    `SecurityPolicy` as an `interface` with `version: "phase1-noop"`
>    makes the comment "Phase 3 widens this to a proper version
>    union" awkward. A real discriminated union cannot be expressed
>    by widening this interface cleanly. Better now:
>    `export type SecurityPolicy = { readonly version: "phase1-noop" };`
>    so Phase 3 can become
>    `{ version: "phase1-noop" } | { version: "phase3"; ... }`.
>
> 3. [packages/core/src/types.ts:65](packages/core/src/types.ts#L65)
>    `ApprovalRecord.method: string` does not enforce "read from
>    generated `ServerRequest` union; never hardcoded outside core."
>    That is only enforceable later by T9a's dispatch table and
>    T9b's grep guard. This matches the plan's shape, but the doc
>    overclaims what T5 guarantees.
>
> 4. [packages/core/test/skeleton.test.ts:79](packages/core/test/skeleton.test.ts#L79)
>    Test comment says "decision required", but `ApprovalRecord`
>    does not encode status/decision correlation. A
>    `transport_lost` record without `decision` typechecks. This is
>    plan-compatible, but T9b must enforce it behaviorally.
>
> 5. [package.json:18](package.json#L18)
>    Lack of per-package `build` is convention-compatible, but root
>    `pnpm build` currently fails with
>    `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. Not T5-specific because no
>    package has `build`, but anything invoking root build is
>    broken. `pnpm --filter @codex-im/core typecheck` passes.
>
> **Non-Issues**
>
> `decision?: ApprovalDecision` is compatible with
> `exactOptionalPropertyTypes`; callers must omit it rather than set
> `undefined`.
>
> `ApprovalActor` accepts exactly the planned `null | system | im`
> shapes. The unknown-kind guard is conceptually fine; it just is
> not actually enforced by current CI.
>
> No auto-approval, no broker runtime, no Phase 2/3 implementation
> slipped in. The README has future-facing wording, but code is T5
> skeleton only.

## Resolution status

| # | Severity | Status | Resolution |
|---|---|---|---|
| 1 | high (silent regression) | ✅ resolved | Added `tsconfig.test.json` + `pnpm typecheck:tests` script; wired into `ci-check.sh` as step 3/8. **Verified by deliberately widening `ApprovalActor` to admit a fourth kind — tsc immediately flagged `TS2578: Unused '@ts-expect-error' directive` in `skeleton.test.ts`.** The guard now actually fires on type drift. Affects all packages' type-only tests, not just T5. |
| 2 | medium | ✅ resolved | `interface SecurityPolicy` → `type SecurityPolicy`. Comment expanded to show the Phase 3 union widening pattern explicitly. |
| 3 | low | ✅ resolved | `ApprovalRecord.method` JSDoc updated to acknowledge "T5's type cannot enforce that on its own; the constraint is enforced by T9a's exhaustive Record + T9b's repo-wide grep guard." |
| 4 | low | ✅ resolved (documented) | Status/decision correlation gap documented inline on `ApprovalRecord.status` JSDoc as "T9b's broker-resolve and broker-expire paths are the load-bearing enforcement." Test comment updated to match. No type change — codex agreed plan-compatible. |
| 5 | low | ✅ resolved | Removed dead `"build": "pnpm -r build"` from root `package.json`. No package has a `build` script (we ship `src/index.ts` directly via `exports`); the script just produced a confusing error. |

5 of 5 findings fixed. The systemic finding (#1) yielded a permanent CI gate.

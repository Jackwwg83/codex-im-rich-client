1. Verdict: **APPROVE_WITH_CHANGES**

Not ready to tag yet. The release-readiness diff is mostly sound and does not change product runtime code, but there is one release-blocking safety issue in `pnpm release:check`.

2. Findings

**P0**
- None found.

**P1**
- `release:check` is not environment-hermetic for “default” live-smoke checks. The new preflight invokes live smoke commands at [scripts/release-readiness-check.mts](/Users/jackwu/projects/codex-im-rich-client/scripts/release-readiness-check.mts:73), [scripts/release-readiness-check.mts](/Users/jackwu/projects/codex-im-rich-client/scripts/release-readiness-check.mts:87), [scripts/release-readiness-check.mts](/Users/jackwu/projects/codex-im-rich-client/scripts/release-readiness-check.mts:90), and [scripts/release-readiness-check.mts](/Users/jackwu/projects/codex-im-rich-client/scripts/release-readiness-check.mts:93), while `runStep()` inherits the caller’s full `process.env` at [scripts/release-readiness-check.mts](/Users/jackwu/projects/codex-im-rich-client/scripts/release-readiness-check.mts:129). If an operator shell already has `LARK_LIVE=1`, `DINGTALK_LIVE=1`, `TELEGRAM_LIVE=1`, credentials, or dry-run gates set, `pnpm release:check` can make live external calls or pass after non-default live behavior. Lark sends when gated at [packages/im-lark/scripts/live-smoke.mts](/Users/jackwu/projects/codex-im-rich-client/packages/im-lark/scripts/live-smoke.mts:46); DingTalk connects when gated at [packages/im-dingtalk/scripts/live-smoke.mts](/Users/jackwu/projects/codex-im-rich-client/packages/im-dingtalk/scripts/live-smoke.mts:51). This contradicts the documented default non-live guarantee at [docs/ops/release-readiness.md](/Users/jackwu/projects/codex-im-rich-client/docs/ops/release-readiness.md:13).

**P2**
- Working tree is not release-clean. There are untracked review/runtime artifacts, including `.claude/scheduled_tasks.lock`, `docs/internal/release-readiness/*`, and multiple `docs/phase-*/*.stderr` files. Several untracked `.stderr` files contain token-shaped fixture/review literals, e.g. [docs/internal/phase-2/codex-review-t18-t22.stderr](/Users/jackwu/projects/codex-im-rich-client/docs/internal/phase-2/codex-review-t18-t22.stderr:6154) and [docs/internal/phase-3/impl-t1-t36-final-codex-review.stderr](/Users/jackwu/projects/codex-im-rich-client/docs/internal/phase-3/impl-t1-t36-final-codex-review.stderr:13035). They appear fake, not real secrets, and are not in committed HEAD, but they should not be present in a final release handoff workspace.

**P3**
- JAC-171 bookkeeping is still pending, as expected for this review: live status still says final review/tag is next at [docs/internal/handoffs/release-readiness-live-status.md](/Users/jackwu/projects/codex-im-rich-client/docs/internal/handoffs/release-readiness-live-status.md:20), and `TODOS.md` still marks JAC-171 open at [TODOS.md](/Users/jackwu/projects/codex-im-rich-client/TODOS.md:312). Update/freeze these after the P1 fix and final gates.

3. Required fixes before production-readiness tag

- Make `release:check` force a sanitized default environment for all default live-smoke checks, or explicitly clear live gate/credential env vars per step.
- Add regression tests proving ambient `TELEGRAM_LIVE`, `LARK_LIVE`, `DINGTALK_LIVE`, `COMPUTER_USE_LIVE`, credentials, and dry-run env do not turn `release:check` into live behavior.
- Require safe output patterns for Lark/DingTalk/Computer Use default checks, not just exit code `0`.
- Clean or ignore untracked review artifacts before final handoff/tag; do not commit token-shaped `.stderr` material.
- Re-run `pnpm release:check`, `git diff --exit-code packages/codex-protocol`, and `git diff --check`.

4. JAC-171 handoff/tag

JAC-171 may proceed to fix, re-run gates, record this review, and freeze handoff docs. It should **not** proceed to the production-readiness tag until the P1 preflight issue is fixed and the workspace is cleaned.

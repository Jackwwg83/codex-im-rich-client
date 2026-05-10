# Phase 7 Final Review Follow-Up Prompt

You are the Codex outside-voice reviewer for the Codex IM Rich Client project.

Review target:

- Branch: `codex/phase-7-planning`
- Base tag: `phase-6-computer-use-complete`
- Current HEAD includes Phase 7 implementation through JAC-108 plus working-tree fixes for the first final review.
- Prior review file: `docs/phase-7/impl-final-codex-review.md`

Task:

Verify whether the prior review findings are closed. Focus only on the prior findings unless the patch introduced a new P0/P1 issue.

Prior findings:

1. P1: `packages/daemon/src/status.ts` used a narrow local web/status redactor instead of `@codex-im/core` `redact()`. Required tests for bare GitHub token, Slack token, and `Authorization: Bearer ...`.
2. P2: `packages/core/src/team-operator-policy.ts` allowed `view_audit` without project/target scope.
3. P2: `packages/daemon/src/web-approval.ts` accepted caller-supplied `messageRef`/`callbackNonce` proof rather than a server-side bound approval record.
4. P3: `git diff --check phase-6-computer-use-complete..HEAD` found trailing whitespace in three Phase 7 docs.

Commands already run after the patch:

- `pnpm vitest run --project unit packages/daemon/test/web-status.test.ts packages/daemon/test/web-approval.test.ts packages/core/test/team-operator-policy.test.ts` -> 3 files / 20 tests passed.
- `pnpm typecheck` -> green after rerun. One earlier parallel run collided with `protocol:check` deleting generated protocol files; rerun after protocol generation completed was green.
- `pnpm typecheck:tests` -> green.
- `pnpm test` -> 136 files / 1237 passed / 1 skipped.
- `pnpm lint` -> green.
- `pnpm protocol:check` -> green; `git diff --exit-code packages/codex-protocol` green.
- `git diff --check phase-6-computer-use-complete` -> green for working tree.

Please inspect the current working tree diff and relevant files/tests:

- `packages/daemon/src/status.ts`
- `packages/daemon/test/status.test.ts`
- `packages/daemon/test/web-status.test.ts`
- `packages/core/src/team-operator-policy.ts`
- `packages/core/test/team-operator-policy.test.ts`
- `packages/daemon/src/web-approval.ts`
- `packages/daemon/test/web-approval.test.ts`
- `docs/phase-7/capability-matrix.md`
- `docs/phase-7/chat-sdk-feasibility.md`
- `docs/phase-7/satori-koishi-feasibility.md`

Output format:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Closure table for prior P1/P2/P3 findings: closed / still open.
3. Any new P0/P1 introduced by the patch.
4. Whether JAC-165 may proceed to handoff/version/tag.

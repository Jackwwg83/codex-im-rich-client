# Release Readiness Final Delta Review Prompt

You are the Codex outside-voice reviewer for Codex IM Rich Client.

Review target:

- Branch: `codex/release-readiness`
- Base tag: `phase-7-extended-platforms-web-console-complete`
- Current HEAD: `7052a8a`
- Parent Linear issue: JAC-166
- Final issue: JAC-171

Prior review chain:

- `docs/internal/release-readiness/final-review.md`: `APPROVE_WITH_CHANGES`, one P1
  about ambient live-smoke env inheritance.
- `docs/internal/release-readiness/final-review-followup.md`: `GO_WITH_LOW_NITS`,
  confirms the P1 is fixed and JAC-171 may proceed to handoff/tag from
  reviewed HEAD `16d11ca`.

New delta after the `GO_WITH_LOW_NITS` review:

- `7052a8a` - `fix(release): JAC-171 lazy preflight setup`
- This addresses the follow-up review's remaining P3 nit: operational temp
  fixture setup is now lazy, so `buildReleaseReadinessSteps()` no longer
  creates temp Keychain shims or SQLite fixture databases while merely building
  the step list.

Gate evidence after `7052a8a` content:

```text
pnpm exec vitest run --project unit scripts/release-readiness-check.test.mts scripts/keychain-launchd-smoke-doc.test.mjs
-> green, 2 files / 8 tests

pnpm release:check -- --skip-full-gates
-> green

pnpm release:check
-> green

git diff --exit-code packages/codex-protocol
-> green

git diff --check
-> green
```

Please inspect:

- `git show --stat --oneline 7052a8a`
- `git show --stat --oneline 16d11ca`
- `git diff phase-7-extended-platforms-web-console-complete..HEAD -- scripts/release-readiness-check.mts scripts/release-readiness-check.test.mts docs/ops/release-readiness.md`
- The current working tree.

Output format:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped P0/P1/P2/P3 with file/line references.
3. Whether the original P1 and follow-up P3 are fixed.
4. Required fixes before production-readiness tag.
5. Whether JAC-171 may proceed to handoff/tag.

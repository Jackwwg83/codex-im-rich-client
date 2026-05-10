# Release Readiness Final Review Follow-Up Prompt

You are the Codex outside-voice reviewer for Codex IM Rich Client.

Review target:

- Branch: `codex/release-readiness`
- Base tag: `phase-7-extended-platforms-web-console-complete`
- Current HEAD: `16d11ca`
- Parent Linear issue: JAC-166
- Final issue: JAC-171

Previous review:

- File: `docs/release-readiness/final-review.md`
- Verdict: `APPROVE_WITH_CHANGES`
- Release blocker: `pnpm release:check` inherited ambient live-smoke env,
  allowing default checks to become live behavior if the operator shell already
  had `TELEGRAM_LIVE`, `LARK_LIVE`, `DINGTALK_LIVE`, `COMPUTER_USE_LIVE`, or
  related credentials/dry-run variables set.

Fix commit:

- `16d11ca` - `fix(release): JAC-171 harden live-smoke preflight`

Fix summary:

- `scripts/release-readiness-check.mts` now clears default live-smoke gate,
  credential selector, token, duration, prompt, and dry-run env variables before
  running default live-smoke gate/skip probes.
- Lark, DingTalk, and Computer Use default checks now require safe output that
  proves `status=skip` and `gate=disabled`; exit code alone is no longer enough.
- `scripts/release-readiness-check.test.mts` has regression coverage for
  hostile ambient live env and safe skip-output patterns.
- `docs/ops/release-readiness.md` documents the environment-hermetic default.

Gate evidence after the fix:

```text
pnpm exec vitest run --project unit scripts/release-readiness-check.test.mts scripts/keychain-launchd-smoke-doc.test.mjs
-> green, 2 files / 7 tests

env TELEGRAM_LIVE=1 ... COMPUTER_USE_LIVE=1 pnpm release:check -- --skip-full-gates
-> green, default live probes still operator-gated/default-skip

pnpm release:check
-> green

git diff --exit-code packages/codex-protocol
-> green

git diff --check
-> green
```

Persistent release redlines:

- Do not implement an OpenClaw plugin.
- Do not parse Codex CLI/TUI output as product protocol.
- Do not replace Codex App Server rich semantics with a generic chat abstraction.
- Do not expose Codex App Server publicly.
- Do not expose a public web console listener by default.
- Do not bypass approvals.
- Computer Use must remain explicit `/cu`, not ordinary prompt-triggered.
- Do not leak secrets into docs, fixtures, SQLite, logs, Linear, or review
  packets.
- launchd plist must not contain token material.
- live smokes must be explicit and env-gated.

Please inspect:

- The original release-readiness diff:
  `phase-7-extended-platforms-web-console-complete..HEAD`
- The P1 fix commit:
  `git show --stat --oneline 16d11ca`
- The current working tree.

Output format:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped P0/P1/P2/P3 with file/line references.
3. Whether the previous P1 is fixed.
4. Required fixes before production-readiness tag.
5. Whether JAC-171 may proceed to handoff/tag.

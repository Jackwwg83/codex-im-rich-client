# Release Readiness Final Review Prompt

You are the Codex outside-voice reviewer for Codex IM Rich Client.

Review target:

- Branch: `codex/release-readiness`
- Base tag: `phase-7-extended-platforms-web-console-complete`
- Current HEAD: `b4c2ae0`
- Parent Linear issue: JAC-166
- Final issue: JAC-171

Goal:

Determine whether this repository is ready to be tagged as a production-ready
local Mac mini release candidate.

Production-ready here means private local operation, not public SaaS
deployment.

Important source-of-truth docs:

- `AGENTS.md`
- `README.md`
- `docs/handoffs/phase7-live-status.md`
- `docs/handoffs/2026-05-03-phase7-to-future.md`
- `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`
- `docs/handoffs/release-readiness-live-status.md`
- `docs/ops/release-readiness.md`
- `docs/ops/production-launch.md`

Release-readiness commits:

- `62071ee` - `docs(release): JAC-167 add release readiness plan`
- `93546e4` - `ci(release): JAC-168 add mandatory gate workflow`
- `167b9af` - `feat(release): JAC-169 add readiness preflight`
- `b4c2ae0` - `docs(release): JAC-170 add production launch runbook`

Important files added/changed:

- `.github/workflows/ci.yml`
- `scripts/release-readiness-check.mts`
- `scripts/release-readiness-check.test.mts`
- `docs/ops/release-readiness.md`
- `docs/ops/production-launch.md`
- `docs/handoffs/release-readiness-live-status.md`
- `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`
- `package.json`
- `README.md`
- `TODOS.md`
- `docs/ops/keychain-launchd-smoke.md`
- `scripts/keychain-launchd-smoke-doc.test.mjs`

Gate evidence at current HEAD:

```text
pnpm release:check -> green

release:check included:
- pnpm check:codex-version
- pnpm typecheck
- pnpm typecheck:tests
- pnpm test
- pnpm test:cli-smoke
- pnpm lint
- pnpm protocol:check
- pnpm exec tsx scripts/verify-phase1-fixtures.mts
- pnpm launchd:install --dry-run
- bash bin/load-and-run.sh --dry-run through fake Keychain shim
- temp SQLite db backup proof
- pnpm smoke:telegram-fake
- pnpm smoke:lark-fake
- pnpm smoke:dingtalk-fake
- pnpm smoke:telegram-live default operator gate, expected exit 1
- pnpm smoke:telegram-real default operator gate, expected exit 1
- pnpm smoke:lark-live default skip, exit 0
- pnpm smoke:dingtalk-live default skip, exit 0
- pnpm smoke:computer-use-live default skip, exit 0

git diff --exit-code packages/codex-protocol -> green
git diff --check -> green
```

Persistent redlines:

- Do not implement an OpenClaw plugin.
- Do not parse Codex CLI/TUI output as product protocol.
- Do not replace Codex App Server rich semantics with a generic chat abstraction.
- Do not expose Codex App Server publicly.
- Do not expose a public web console listener by default.
- Do not bypass approvals.
- Computer Use must remain explicit `/cu`, not ordinary prompt-triggered.
- Do not leak secrets into docs, fixtures, SQLite, logs, Linear, or review packets.
- launchd plist must not contain token material.
- live smokes must be explicit and env-gated.

Please inspect the diff from `phase-7-extended-platforms-web-console-complete..HEAD`
and the current working tree.

Output format:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped P0/P1/P2/P3 with file/line references.
3. Required fixes before production-readiness tag.
4. Whether JAC-171 may proceed to handoff/tag.

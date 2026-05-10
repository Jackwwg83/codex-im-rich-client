# Phase 6 Final Codex Re-Review Prompt

Review scope: `650db47..1a5bb9b`.

You are re-reviewing the Phase 6 Computer Use tag-gate fixes after the first
outside-voice review returned `APPROVE_WITH_CHANGES`.

## Prior Review

- Prior prompt: `docs/phase-6/impl-final-codex-review-prompt.md`
- Prior output: `docs/phase-6/impl-final-codex-review.md`
- Prior verdict: `APPROVE_WITH_CHANGES`

## Required Prior Fixes

Confirm whether these are closed:

1. `/cu` was parsed but dropped by daemon.
2. Dynamic tool gate was not safely wireable from `DynamicToolCallParams`
   because broker requests did not carry target/actor context.
3. Expired Computer Use sessions failed open unless every caller passed `now`.
4. Computer Use audit events lacked required routing context.
5. Provider exceptions were not converted to fail-closed tool responses.
6. `git diff --check` had extra blank lines at EOF in three Phase 6 review docs.

## Expected Fix Shape

- Daemon routes `/cu` and `/cu status`.
- `/cu` performs policy check, wraps a redacted Computer Use prompt, starts or
  steers a turn, creates a scoped session only after turn id is known, and
  audits with target/project/thread/actor context.
- Broker dynamic-tool handler uses a typed registration API and calls
  `ComputerUseToolGate.handleToolCall()` so session context is looked up from
  registry by `threadId`/`turnId`, not fabricated from missing request fields.
- Session expiry uses current time by default.
- Provider exceptions return `{ contentItems: [], success: false }` and audit a
  minimized failure without raw provider error text.
- Live desktop execution remains blocked/default-off; no real provider was
  added.

## Verification At Re-Review HEAD

- `pnpm typecheck` green.
- `pnpm typecheck:tests` green.
- `pnpm test` green: 132 files, 1211 passing, 1 skipped.
- `pnpm lint` green: 301 files checked.
- `pnpm protocol:check` green: codex 0.128.0, 234 schema files canonical.
- `git diff --check` green.

## Output Format

Return Markdown with:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. P0/P1/P2/P3 findings, with file references.
3. Which prior findings are closed.
4. Required fixes before tag, if any.
5. Tag recommendation.

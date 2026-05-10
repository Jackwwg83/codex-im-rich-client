# Phase 3 Tag-Gate Codex Review Prompt

You are an outside-voice reviewer for the Codex IM Rich Client repository.

Run in read-only mode. Do not modify files. Review the current HEAD for the Phase 3 tag gate.

## Project Boundary

This project is a native Codex App Server IM rich client:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

It must not be an OpenClaw plugin, Codex CLI/TUI output parser, generic chat abstraction, public App Server listener, approval bypass, or premature Computer Use/Lark/DingTalk implementation.

## Source Of Truth

Read:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/internal/handoffs/phase3-live-status.md`
- `docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md` §16.9 and §19
- `docs/internal/phase-3/impl-t1-t19-midphase-codex-review.md`
- `docs/internal/phase-3/impl-t1-t36-final-codex-review.md`
- `docs/internal/phase-3/impl-t1-t36-final-review-response.md`

## Review Focus

Verify whether Phase 3 is safe to tag after the final review fixes:

1. The five T38 findings are truly closed:
   - WAL-safe SQLite backup
   - Telegram inbound pause before shutdown settlement
   - launchd runtime path validation before live install
   - stale `issued` callback token expiration
   - daemon-side status snapshot producer
2. Phase 3 exit criteria are satisfied or correctly documented as operator-gated:
   - fake smoke CI-safe
   - live Telegram / real Codex smokes remain explicit env-gated
   - launchd live install and real external actions are documented as operator-run, not default gates
3. No project redlines are violated.
4. Version/tag decision is coherent with plan §19:
   - If no post-fix GO review exists, tag may use `0.1.0-phase3-draft` + `phase-3-telegram-mvp-complete`.
   - If this review returns GO, say whether `0.1.0-phase3` is now justified.
5. Identify any P0/P1 blocker that must stop JAC-64/T40.

## Required Output

Return:

- Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / BLOCK
- Blockers: list P0/P1 only, with file and line references
- Low nits: P2/P3 only
- Version/tag recommendation
- Whether JAC-64 may proceed to handoff commit and tag

Keep the review concise and actionable.

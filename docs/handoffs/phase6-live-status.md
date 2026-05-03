# Phase 6 Live Status

> Single source of truth for Phase 6 Computer Use.
> **Last updated:** 2026-05-03 - Phase 6 complete at tag candidate `43a11e3`;
> final tag gate ready for `phase-6-computer-use-complete`.

---

## 1. Current State

- **Phase:** Phase 6 - explicit Computer Use flow.
- **Plan:** `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`.
- **Parent Linear issue:** JAC-11 - Phase 6 backlog / explicit Computer Use flow.
- **Final Linear issue:** JAC-101 - final review / handoff / tag.
- **Branch:** `codex/phase-6-computer-use`.
- **Base tag:** `phase-5-dingtalk-adapter-complete`.
- **Release tag:** `phase-6-computer-use-complete`.
- **Version:** `0.1.0-phase6`.
- **HEAD:** `43a11e3` - `fix(daemon): JAC-101 preserve computer use policy defaults`.
- **Next exact action:** push branch/tag, update Linear, then start Phase 7 planning
  from the Phase 6 -> Phase 7 handoff.

## 2. Shipped Behavior

- `/cu` and `/computer-use` are the only accepted Computer Use triggers.
- `/cu status` reports policy safely without starting Codex work.
- Normal prompts remain normal prompts, even with desktop-looking text.
- `/cu <task>` is policy-checked, redacted, wrapped, audited, and routed through
  CodexRuntime thread/turn APIs.
- Dynamic `item/tool/call` execution is broker-registered through a typed handler
  and requires an active scoped Computer Use session for the same thread/turn.
- Denied apps and unlisted apps fail closed before provider execution.
- Sensitive tasks fail closed until a future explicit sensitive-step approval API
  is designed; `allow_session` is not exposed for sensitive steps.
- Provider exceptions return `{ success: false, contentItems: [] }` and audit a
  minimized failure.
- Fake and unsupported providers ship; real desktop execution remains blocked
  pending future capability evidence.
- `pnpm smoke:computer-use-live` default-skips; dry-run readiness is explicit and
  does not perform desktop action.

## 3. Carry-Forward Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing.
- No generic chat abstraction replacing App Server rich semantics.
- No public App Server listener.
- No implicit Computer Use trigger from normal prompts.
- No unattended live desktop control.
- No secrets/cookies/passwords/tokens/private session data in docs, Linear,
  fixtures, logs, SQLite, or prompts.
- IM adapters do not call Computer Use, broker, runtime, client, storage,
  daemon, render, or protocol directly.
- Unknown, unauthorized, malformed, denied-app, sensitive-unapproved, stale,
  expired, replayed, transport-lost, or security-uncertain paths fail closed.

## 4. Review Status

| Review | Status |
|---|---|
| Phase 6 plan v1 Codex review | APPROVE_WITH_CHANGES: 2 P1 + 3 P2; v1.1 patch applied |
| Phase 6 plan v1.1 Codex re-review | GO: no remaining P0/P1/P2; JAC-92 may start |
| Phase 6 final implementation review | APPROVE_WITH_CHANGES at `650db47`; 4 P1 + 2 P2 + 1 P3 |
| JAC-101 review-fix re-review | GO_WITH_LOW_NITS at `1a5bb9b`; no P0/P1/P2, one P3 default-value nit |
| P3 closeout | `43a11e3` preserved default deny apps / sensitive keywords for partial daemon config |

Review reports:

- `docs/phase-6/impl-final-codex-review.md`
- `docs/phase-6/impl-final-codex-rereview.md`

## 5. Linear Execution Queue

| Issue | Scope | Status |
|---|---|---|
| JAC-91 | plan review gate | complete |
| JAC-92 | `/cu` command parser only | complete |
| JAC-93 | ComputerUsePolicy schema | complete |
| JAC-94 | allowed_apps / deny_apps config | complete |
| JAC-95 | explicit `/cu` prompt wrapper | complete |
| JAC-96 | normal prompt cannot create Computer Use intent | complete |
| JAC-163 | capability evidence / provider boundary + broker typed API | complete |
| JAC-97 | dynamic tool gate + sensitive-step approval model | complete |
| JAC-98 | audit event for Computer Use trigger | complete |
| JAC-99 | Chrome-only fake/manual smoke docs | complete |
| JAC-100 | operator-gated live Computer Use smoke | complete |
| JAC-101 | review / handoff / tag | complete |

## 6. Gate Status

Latest Phase 6 tag-gate candidate gates after `43a11e3`:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 132 files, 1212 passing, 1 skipped |
| `pnpm lint` | green: 301 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |
| `git diff --check` | green |
| `pnpm smoke:computer-use-live` | green default skip; requires `COMPUTER_USE_LIVE=1` |

`protocol:check` must run serially because it regenerates protocol files before
diffing.

## 7. Compact / Resume

If resuming after Phase 6:

1. Read this file first.
2. Read `docs/handoffs/2026-05-03-phase6-to-phase7.md`.
3. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current Linear issue when recovered state is clearly safe;
   use GPT Pro/Codex outside-voice for technical ambiguity.

# Phase 6 Live Status

> Single source of truth for Phase 6 while Computer Use work is active.
> **Last updated:** 2026-05-03 - JAC-163 capability evidence / provider boundary complete; JAC-97 dynamic tool gate + sensitive-step approval model is next.

---

## 1. Current State

- **Phase:** Phase 6 - explicit Computer Use flow.
- **Plan:** `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`.
- **Parent Linear issue:** JAC-11 - Phase 6 backlog / explicit Computer Use flow.
- **Current Linear issue:** JAC-97 - dynamic tool gate + sensitive-step approval model.
- **Branch:** `codex/phase-6-computer-use`.
- **Base tag:** `phase-5-dingtalk-adapter-complete`.
- **Version:** `0.1.0-phase5`; do not bump until Phase 6 tag gate.
- **Next exact action:** implement JAC-97 scoped Computer Use session/tool-call
  gate and sensitive-step approval model. No real desktop control; use fake and
  unsupported providers only.

## 2. Current Decision State

- `/cu` and `/computer-use` are the only allowed Computer Use triggers.
- Normal prompts must not create Computer Use context.
- `item/tool/call` must be denied unless tied to an active scoped `/cu` session.
- Denied apps fail closed before approval.
- Sensitive steps require explicit approval and do not support allow-session.
- Dynamic tool calls must be registered through a broker-owned typed API; daemon
  must not carry raw ServerRequest method literals.
- Real desktop execution requires capability evidence and a reviewed provider.
- Tests and default smokes use fake or unsupported providers; live desktop smoke
  is not default CI.

## 3. Active Redlines

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
| Phase 6 implementation review | pending |
| Phase 6 final tag-gate review | pending |

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
| JAC-97 | dynamic tool gate + sensitive-step approval model | current |
| JAC-98 | audit event for Computer Use trigger | pending |
| JAC-99 | Chrome-only fake/manual smoke docs | pending |
| JAC-100 | operator-gated live Computer Use smoke | pending |
| JAC-101 | review / handoff / tag | pending |

## 6. Gate Status

Latest Phase 6 JAC-91 closeout gates:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green on 2026-05-03 after JAC-163 |
| `pnpm typecheck:tests` | green on 2026-05-03 after JAC-163 |
| `pnpm test` | green: 129 files, 1199 passing, 1 skipped |
| `pnpm lint` | green: 295 files checked |
| `pnpm protocol:check` | green: codex 0.128.0, 234 schema files canonical |

## 7. Compact / Resume

If resuming during Phase 6:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`.
3. Read `docs/phase-6/computer-use-capability-evidence.md`.
4. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
5. Run `git status --short` and `git log --oneline -8`.
6. Continue from the current Linear issue when recovered state is clearly safe;
   use GPT Pro/Codex outside-voice for technical ambiguity.

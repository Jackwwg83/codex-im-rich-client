# Phase 6 Final Codex Review Prompt

Review scope: `phase-5-dingtalk-adapter-complete..650db47`.

You are an outside-voice reviewer for Phase 6 of Codex IM Rich Client. Review
the implementation diff for correctness, architecture drift, Computer Use
security redlines, missing tests, and tag readiness.

## Phase 6 Mission

Phase 6 enables an explicit, auditable Computer Use flow without weakening the
product boundary:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

Computer Use must only start from explicit `/cu` or `/computer-use` commands.
Normal prompts must remain normal prompts even if they ask for desktop actions.
Dynamic `item/tool/call` execution must fail closed unless an active scoped
Computer Use session and policy/tool gate allow it.

## Source Of Truth

- `docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`
- `docs/internal/handoffs/phase6-live-status.md`
- `docs/internal/phase-6/computer-use-capability-evidence.md`
- `docs/internal/ops-smoke/computer-use-smoke.md`
- `07-SECURITY-AND-COMPUTER-USE.md`
- `08-DATA-MODEL.md`
- `11-TESTING-AND-QA.md`
- `18-HOOKS-AND-GUARDRAILS.md`

## Completed Phase 6 Commits

- `a60dec5` JAC-91 plan review gate, capability evidence, Phase 6 SOT docs
- `c4cd818` JAC-92 explicit `/cu` parser only
- `86e2f88` JAC-93 ComputerUsePolicy schema/evaluator
- `67fe9f2` JAC-94 config schema for allowed/denied apps
- `a950826` JAC-95 explicit `/cu` prompt wrapper
- `d46fa2f` JAC-96 normal prompt boundary tests
- `c081fb1` JAC-163 provider boundary + broker typed API + capability evidence
- `954ecb9` JAC-97 scoped session registry + dynamic tool gate
- `77116d6` JAC-98 Computer Use audit trigger
- `fb622fa` JAC-99 fake/manual smoke docs
- `650db47` JAC-100 default-skip live smoke gate

## Must-Check Redlines

- No OpenClaw plugin, no Codex CLI/TUI output parsing, no generic chat
  abstraction replacing Codex App Server semantics.
- No public Codex App Server listener and no public IM webhook by default.
- Computer Use must not trigger from normal prompts or heuristic desktop intent.
- `/cu` and `/computer-use` parsing must not execute desktop actions by itself.
- `item/tool/call` must fail closed without an active scoped Computer Use
  session for the same target/thread/turn/actor.
- Allowed dynamic tools must be explicit; namespace/tool mismatches fail closed.
- Denied apps and unknown apps fail closed before provider execution.
- Sensitive steps must not support allow-session; they fail closed or require a
  future explicit approval path.
- Real desktop provider capability is not verified in Phase 6. Fake and
  unsupported providers are allowed; real provider execution must remain blocked
  or default-off.
- Live Computer Use smoke must remain explicit/env-gated and default skip.
- No browser cookies, Keychain values, OAuth tokens, passwords, recovery codes,
  `.env` contents, private session data, raw desktop screenshots, or raw task
  text containing secrets may enter docs, fixtures, logs, Linear, SQLite, or
  committed test output.
- Dynamic tool results and audit metadata must be redacted/minimized.
- No new raw App Server method literals in production source outside approved
  broker/classifier/runtime method tables.
- IM adapters must not import or call Computer Use, broker, runtime, client,
  storage, daemon, render, protocol, or generated protocol types directly.

## Verification At Current HEAD

- `pnpm typecheck` green.
- `pnpm typecheck:tests` green.
- `pnpm test` green: 132 files, 1207 passing, 1 skipped.
- `pnpm lint` green: 301 files checked.
- `pnpm protocol:check` green: 234 schema files canonical.
- `pnpm smoke:computer-use-live` green default skip with no desktop action.
- Verified dry-run readiness command green with no desktop action.

## Known Intentional Boundary

JAC-163 did not verify a real Codex App Computer Use provider namespace/tool
schema. Phase 6 intentionally ships fake and unsupported providers plus
policy/session/audit/live-smoke gates. Real desktop execution remains blocked
until future capability evidence proves the provider boundary.

## Output Format

Return Markdown with:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped by P0/P1/P2/P3 with file references.
3. Positive checks.
4. Required fixes before tag, if any.
5. Tag recommendation.

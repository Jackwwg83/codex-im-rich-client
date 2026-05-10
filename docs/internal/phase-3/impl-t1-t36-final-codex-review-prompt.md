# Codex outside-voice review — Phase 3 final implementation T1 through T36

You are the outside-voice reviewer for the Phase 3 final implementation slice
on branch `phase-3-implementation`, current docs checkpoint `36d8903`, latest
code commit `2b42eff`.

This is the T38 final review after T36 Telegram smokes. Review the
implementation before Phase 3 handoff/tag. The T37 mid-phase review after T19
already landed and its findings were closed; verify no regression and focus
especially on the post-T19 Telegram adapter / ops / smoke slices.

## Project Boundary

Codex IM Rich Client is a native Codex App Server IM rich client.

Architecture:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

Do not treat this as:

- an OpenClaw plugin,
- a Codex CLI/TUI output parser,
- a normal chat abstraction replacing Codex App Server rich semantics,
- a public App Server listener,
- a premature Computer Use / Lark / DingTalk implementation.

## Source of Truth

Read these first:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/handoffs/phase3-live-status.md`
- `docs/superpowers/plans/2026-05-02-phase-3-plan.md`
- `docs/phase-3/plan-v2-review-response.md`
- `docs/phase-3/impl-t1-t19-midphase-codex-review.md`
- `08-DATA-MODEL.md`
- `TODOS.md`

The plan-of-record is Phase 3 v2.4. Earlier plan drafts were rejected or
approved-with-changes; do not re-litigate fixed plan issues unless the current
code regressed them.

## Commits In Scope

Review all Phase 3 implementation code through T36:

```text
3ada728..49afab5   T1-T19 storage/config/core/channel/daemon foundation
4a5d5e9            T37 review report/docs checkpoint
28bf394            T22b-T22c sendCard/wirePayload
632fbdf            T23-T25 updateCard/editText/answerAction
a8f9453            T26 + T28a-c onMessage fixtures
4b6ed2f            T27 + T28d-f onAction fixtures
fa5909f            JAC-61 adapter contract guardrails
b707f28            T29 launchd dry-run installer
91d259a            T29a Keychain launch wrapper
3b4ea94            T29b Keychain launchd smoke runbook
fe35e86            JAC-139 stdio gate-flake fix
0830017            T30 launchd uninstall dry-run
f70754b            T31 daemon log rotation
aaed7a2            T32 daemon status CLI
56595fd            T33 DB backup CLI
3cff55c            T34 smoke:telegram-fake
2e74f9c            T35 smoke:telegram-live
2b42eff            T36 smoke:telegram-real
```

Docs commits between these are status checkpoints; use them for context but
focus findings on implementation and gate evidence.

## Review Focus

Give findings first, ordered by severity. Use P0/P1/P2/P3.

### 1. Plan Adherence And Phase Scope

Verify landed tasks match Phase 3 plan §16.2-§16.9 and do not pre-implement
Phase 4+ Lark/DingTalk/Computer Use/Web Console work. Flag any task that
bundled future scope in a way that weakens reviewability.

### 2. Security And Approval Correctness

Check these redlines especially:

- D33/D34/D35: callback token validation, hash-only persistence, CAS
  bound->used only after broker ok, messageRef validation before resolve.
- D36: policy-denied approvals resolve as normal decline through broker.
- D40: single-approval transport_lost API vs all-pending shutdown behavior.
- D41: production callback source of truth is `rawCallbackData` /
  per-action `wirePayload`; `callbackNonce` is legacy fallback only.
- D42: synthetic events append before iterator done.
- Unknown / stale / expired / replayed / unauthorized paths fail closed.
- Bot token is never rendered into plist, logs, fixtures, SQLite, docs, or
  Linear-facing output.

### 3. Layer Boundaries

Check:

- `packages/storage-sqlite/src/**` imports no upper packages, runtime or
  type-only.
- `packages/channel-core/src/**` has no runtime import of core/runtime/client.
- `packages/render/src/**` switches on classifier/kinds, not raw method
  strings.
- `packages/daemon/src/**` contains no raw App Server JSON-RPC method literals
  and no public listener.
- `packages/im-telegram/src/**` is the only home for grammY/raw Telegram
  wire/API details.
- CLI smoke harnesses do not leak Telegram wire details, tokens, or public
  listener behavior.

### 4. Telegram Adapter / Ops / Smoke Slices

Review:

- Telegram adapter lifecycle, sendCard/updateCard/editText/answerAction,
  onMessage/onAction normalization, callback codec, and contract guardrails.
- launchd dry-run install/uninstall, Keychain wrapper, smoke docs.
- logger rotation, local status snapshot, DB backup retention.
- `smoke:telegram-fake`, `smoke:telegram-live`, and `smoke:telegram-real`
  env gates, redaction, and default no-live/no-real behavior.

Look for races, stale state, missed cleanup, unbounded growth, timer leaks,
unhandled promise paths, exactOptionalPropertyTypes mistakes, and operator
commands that could write secrets or perform live actions without explicit
gates.

### 5. Tests And Gates

Current completion gates reported:

```text
pnpm typecheck        green
pnpm typecheck:tests  green
pnpm test             green, 98 files, 962 pass + 1 skip
pnpm lint             green, 220 files
pnpm protocol:check   green, codex 0.128.0, 234 schema files canonical
```

Verify whether test coverage is adequate for high-risk paths, especially
approval callback security, Telegram adapter raw fixture boundaries, ops secret
handling, and smoke env gates.

## Output Format

Use this structure:

```text
Verdict: APPROVE / APPROVE_WITH_CHANGES / REJECT

Findings:
- [P0/P1/P2/P3] file:line — title
  Explanation
  Required change

Open Questions:
- ...

Positive Checks:
- ...

Gate / Scope Notes:
- ...
```

If there are no P0/P1 findings, say that explicitly.

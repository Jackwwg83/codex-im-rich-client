# Codex outside-voice review — Phase 3 mid-phase implementation T1 through T19

You are the outside-voice reviewer for the Phase 3 implementation slice on
branch `phase-3-implementation`, current docs checkpoint `cbba712`, latest
code commit `49afab5`.

This is the T37 mid-phase review after daemon T19. Review the real
implementation before the project proceeds into the real Telegram adapter
slice and later live smokes.

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
- `docs/internal/handoffs/phase3-live-status.md`
- `docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md`
- `docs/internal/phase-3/plan-v2-review-response.md`
- `08-DATA-MODEL.md`
- `TODOS.md`

The plan-of-record is Phase 3 v2.4. Earlier plan drafts were rejected or
approved-with-changes; do not re-litigate fixed plan issues unless the current
code regressed them.

## Commits In Scope

Review all Phase 3 implementation code through T19:

```text
3ada728 T1.1 storage-sqlite skeleton
826fdfc T2a openDatabase
f6972de T2b runMigrations
d891960 T2c idempotency
04a92fe impl review fixes
c06813e T3a 001-init
b25cb78 T4a thread_bindings upsert/findByTarget
89742a3 T4b binding list/delete
2904b36 T4c write-failure semantics
931ad5f T5a approvals repository
d50e705 T5b approval redaction
baeb3f5 T6a audit repository
0c4fd23 T6b audit redaction
d6620f8 T6c audit best-effort failure marker
2891a9f T6d callback_tokens repository
3d9d30c T6e callback token hash-only assertion
6ae48d6 T6f callback token action enum
d549e92 T7-T8 config package + env secret resolver
de39ac9 T6.5 single-approval transport_lost broker API
a0cdf64 T6.6 ApprovalUiAction.wirePayload
260e23f T6.7 EventNormalizer.endWithSynthetic
ec68bc7..064db18 T9-T13 SecurityPolicy / CommandRouter / SessionRouter
10e898e T-D41a-d channel-core callback payload boundary
6d1b4ae..82c1967 T14-T15 daemon skeleton + strict startup
cca958a T16.1 policy auto-decline
5906541 T16.2 callback token issue
2145c57 T16.3 bind before send
ed1f7fb T16.4 render wire payload tokens
602e68f T16.5-T16.7 send card + bind tokens
a448ecc T17.1 callback lookup fail-closed
2f065b9 T17.2 messageRef validation
3895e1e T17.3-T17.5 valid callback resolve
9d0ec9e T17.6-T17.14 resolve error handling
7b80321 T18 inbound prompt routing
a1ae894 T19a-T19b binding restore and /use write failure UX
a4ef5a4 T19c shutdown order
11d2da2 T19d synthetic turn_failed on transport loss
49afab5 T19e callback token + terminal record prune sweeps
```

Docs commits in between are status checkpoints; use them for context but focus
findings on implementation.

## Review Focus

Give findings first, ordered by severity. Use P0/P1/P2/P3.

### 1. Plan Adherence

Verify each landed task stays within Phase 3 plan §16.2-§16.5 and does not
pre-implement real Telegram, launchd, live smokes, Lark/DingTalk, or Computer
Use. Flag any task that bundled a later task in a way that weakens reviewability.

### 2. Security And Approval Correctness

Check these redlines especially:

- D33: callback validation is read-only before `broker.resolve`; CAS
  bound->used happens only after broker ok.
- D34: raw callback tokens are never stored; SQLite stores hash only.
- D36: policy-denied approvals resolve as normal decline through broker, not
  `binding_required`.
- D40: single-approval transport_lost API is used for single stuck approvals;
  all-pending transport loss is only used for shutdown/transport close.
- D41: production callback source of truth is `rawCallbackData` / per-action
  `wirePayload`; `callbackNonce` is legacy fallback only.
- D42: synthetic events are appended before iterator done.
- messageRef must be validated before `broker.resolve`.
- unknown / stale / expired / replayed / unauthorized paths must fail closed.

### 3. Layer Boundaries

Check:

- `packages/storage-sqlite/src/**` imports no upper packages, runtime or type-only.
- `packages/channel-core/src/**` has no runtime import of core/runtime/client/protocol.
- `packages/render/src/**` switches on classifier/kinds, not raw ServerRequest method strings.
- `packages/daemon/src/**` contains no raw App Server JSON-RPC method literals and no public listener.
- No Telegram raw SDK types outside future `packages/im-telegram`.

### 4. Daemon Lifecycle And State

Review:

- strict startup order T15.1-T15.8,
- pending-created approval flow T16,
- callback flow T17,
- inbound prompt routing T18,
- binding restore and `/use` write failure semantics T19a-b,
- shutdown order T19c,
- synthetic transport-loss turn_failed flow T19d,
- prune sweeps T19e.

Look for races, stale state, missed cleanup, unbounded growth, timer leaks,
unhandled promise paths, and exactOptionalPropertyTypes mistakes.

### 5. Tests And Gates

Current completion gates reported:

```text
pnpm typecheck        green
pnpm typecheck:tests  green
pnpm test             green, 79 files, 865 pass + 1 skip
pnpm lint             green, 177 files
pnpm protocol:check   green, codex 0.128.0, 234 schema files canonical
```

Verify whether test coverage is adequate for the high-risk paths, especially
T17 and T19e.

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

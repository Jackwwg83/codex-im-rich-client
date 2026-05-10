# Phase 5 Final Codex Review Prompt

Review scope: `phase-4-lark-adapter-complete..9b3f395`.

You are an outside-voice reviewer for Phase 5 of Codex IM Rich Client. Review
the implementation diff for correctness, architecture drift, security redlines,
missing tests, and tag readiness.

## Phase 5 Mission

Phase 5 adds a native DingTalk adapter using DingTalk Stream mode while
preserving the product boundary:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

## Source Of Truth

- `docs/internal/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`
- `docs/internal/handoffs/phase5-live-status.md`
- `docs/internal/phase-5/dingtalk-target-verification.md`
- `docs/internal/ops-smoke/dingtalk-live-smoke.md`
- `06-IM-ADAPTERS.md`
- `07-SECURITY-AND-COMPUTER-USE.md`
- `08-DATA-MODEL.md`

## Completed Phase 5 Commits

- `f9c752c` JAC-78 plan gate
- `0b02c43` JAC-79 package skeleton / boundary tests
- `1199e14` JAC-80 Stream lifecycle
- `c724aea` JAC-81 message receive fixtures
- `a9d37ba` JAC-82 card send/update
- `9232fb0` JAC-83 callback codec/parser
- `90d82d1` JAC-84 messageRef validation
- `b0ce15e` JAC-85 approval round-trip fake test
- `06fec6a` JAC-86 reconnect behavior
- `5c6349f` JAC-87 adapter contract suite
- `cb64d43` JAC-88 fake DingTalk smoke
- `9b3f395` JAC-89 env-gated live smoke harness

## Must-Check Redlines

- No OpenClaw plugin, no Codex CLI/TUI output parsing, no generic chat
  abstraction replacing Codex App Server semantics.
- No public Codex App Server listener and no public DingTalk webhook by default.
- No Computer Use production flow.
- `packages/im-dingtalk/src/**` must import only `@codex-im/channel-core`
  among Codex packages. It must not call `ApprovalBroker`, `CodexRuntime`,
  `AppServerClient`, storage, daemon, render, protocol, or generated protocol
  types directly.
- DingTalk callback payload must be exact opaque `v1:<token>` only. No raw
  approval id, action enum, actor id, target tuple, nonce, or JSON object.
- Raw callback tokens must not be persisted or logged. Daemon must hash before
  lookup and validate `messageRef` before `ApprovalBroker.resolve()`.
- Missing, ambiguous, stale, replayed, expired, malformed, unauthorized, wrong
  target, or security-uncertain action paths must fail closed.
- Stream ack means platform receipt only, never approval acceptance.
- DingTalk secrets, access tokens, session webhooks, client secrets, cookies,
  real ids, or callback payload secrets must not enter docs, fixtures, logs,
  SQLite, Linear, plist, or commits.
- Live smoke must remain explicit/env-gated and default skip without network.

## Verification At Current HEAD

- `pnpm typecheck` green.
- `pnpm typecheck:tests` green.
- `pnpm test` green: 125 files, 1185 passing, 1 skipped.
- `pnpm lint` green: 287 files checked.
- `pnpm protocol:check` green: 234 schema files canonical.
- `pnpm smoke:dingtalk-fake` green.
- `pnpm smoke:dingtalk-live` green default skip; no network without
  `DINGTALK_LIVE=1`.

## Output Format

Return Markdown with:

1. Verdict: GO / GO_WITH_LOW_NITS / APPROVE_WITH_CHANGES / REJECT.
2. Findings grouped by P0/P1/P2/P3 with file references.
3. Positive checks.
4. Required fixes before tag, if any.
5. Tag recommendation.

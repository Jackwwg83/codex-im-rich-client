# Phase 6 -> Phase 7 Handoff

Generated: 2026-05-03

## 1. Closeout

- **Closed phase:** Phase 6 - explicit Computer Use flow.
- **Plan:** `docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`.
- **Base tag:** `phase-5-dingtalk-adapter-complete`.
- **Release tag:** `phase-6-computer-use-complete`.
- **Version:** `0.1.0-phase6`.
- **Branch:** `codex/phase-6-computer-use`.
- **Linear parent:** JAC-11.
- **Final Linear issue:** JAC-101.
- **Release HEAD:** `8b089d1`.

## 2. What Shipped

- Explicit `/cu` and `/computer-use` command parsing; normal prompts do not
  create Computer Use context.
- `ComputerUsePolicy` with enabled/default app/allowlist/denylist/sensitive
  keyword behavior and config loading.
- Redacted `/cu` prompt wrapper with hard safety instructions.
- Daemon `/cu` routing through SecurityPolicy, SessionRouter, CodexRuntime, and
  a scoped Computer Use session registry.
- Broker-owned typed dynamic-tool handler registration for `item/tool/call`;
  daemon does not carry raw ServerRequest method literals.
- Dynamic tool gate that fails closed without active scoped session, on denied
  apps, on unlisted apps, on unsupported tools, on expired sessions, and on
  provider exceptions.
- Audit events for Computer Use intent, denial, wrapped prompt, tool denial,
  sensitive-step block, provider unavailable, and tool execution, with redacted
  metadata.
- Fake and unsupported Computer Use providers only; no real desktop provider is
  enabled in Phase 6.
- Chrome-only manual smoke docs and a default-skipped live smoke harness.

## 3. Review / Fixes

- Phase 6 plan v1 returned APPROVE_WITH_CHANGES; v1.1 closed all P1/P2 plan
  findings and re-review returned GO.
- Final implementation review at `650db47` returned APPROVE_WITH_CHANGES:
  `/cu` daemon routing, broker-safe tool-gate lookup, expiry defaulting, audit
  routing context, provider exception handling, and EOF whitespace had to be
  fixed.
- `1a5bb9b` closed the final-review P1/P2 findings and whitespace issue.
- Re-review returned GO_WITH_LOW_NITS with no P0/P1/P2 findings.
- `43a11e3` closed the remaining P3 nit by preserving core default deny apps
  and sensitive keywords when daemon receives partial Computer Use config.
- Review reports:
  - `docs/internal/phase-6/impl-final-codex-review.md`
  - `docs/internal/phase-6/impl-final-codex-rereview.md`

## 4. Gates

At Phase 6 tag candidate:

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

## 5. Carry-Forward Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing as product protocol.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public App Server listener.
- No public IM webhook by default.
- No approval bypass.
- No implicit Computer Use trigger from normal prompts.
- No unattended live desktop control or real Computer Use provider until future
  capability evidence and review prove the boundary.
- IM adapters call only the `ChannelAdapter` boundary; they do not call
  Computer Use, broker, runtime, client, storage, daemon, render, or protocol
  directly.
- Callback data remains opaque token only; raw callback tokens are not persisted
  or logged.
- `messageRef` validation remains required before `ApprovalBroker.resolve()`.
- Unknown, unauthorized, malformed, stale, expired, replayed, transport-lost,
  denied-app, sensitive-unapproved, or security-uncertain paths fail closed.

## 6. Next Phase

Phase 7 should start with a planning/review gate, not direct implementation.

Recommended Phase 7 scope candidates:

1. Satori/Koishi compatibility spike and capability matrix.
2. Vercel Chat SDK feasibility spike for Slack/Discord/Teams-style surfaces.
3. Web console read-only status and approval UI plan.
4. Multi-channel session handoff semantics.
5. Team/operator model and permission boundaries.

Recommended first task:

1. Open or create the Phase 7 Linear parent.
2. Create a Phase 7 plan under `docs/internal/superpowers/plans/`.
3. Split implementation into reviewable children before writing product code.
4. Ask Codex/GPT Pro for plan review before crossing into implementation.

Do not enable real desktop Computer Use, public listeners, external publishing,
or live external-system actions from this handoff.

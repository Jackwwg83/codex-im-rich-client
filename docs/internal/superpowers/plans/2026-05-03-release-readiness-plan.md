# Release Readiness Plan

Generated: 2026-05-03

## 1. Goal

Bring Codex IM Rich Client from Phase 7 complete to a production-ready local
Mac mini operation standard.

This is not a new product-feature phase. It is the release hardening layer that
turns the completed Phase 0-7 implementation into an auditable, repeatable,
recoverable, and safe production run.

## 2. Baseline

- Base tag: `phase-7-extended-platforms-web-console-complete`
- Branch: `codex/release-readiness`
- Parent Linear issue: JAC-166
- First issue: JAC-167
- Frozen prior status: `docs/internal/handoffs/phase7-live-status.md`
- Prior handoff: `docs/internal/handoffs/2026-05-03-phase7-to-future.md`
- Current root version: `0.1.0-phase7`
- Codex pin: `0.128.0`

## 3. Production Readiness Definition

The project is production-ready when all of these are true:

1. CI runs the same mandatory non-live gates used locally.
2. A single local release-readiness command verifies non-live operational
   preflight without secrets, Keychain writes, launchctl load/unload, or
   external network calls.
3. Mac mini launch operations are documented with dry-run, install, health,
   logs, backup, smoke, rollback, and redaction checks.
4. Live smokes remain explicit and env-gated. Some harnesses default-skip with
   exit 0, while Telegram live/real smokes fail at an explicit operator gate
   with no network call; both outcomes are safe to run unattended as checks.
5. SQLite backup/restore expectations are documented and the existing backup
   command remains in the release checklist.
6. Final release-readiness review is recorded and any P0/P1 blockers are
   closed before a production-readiness tag is created.
7. Linear, README/TODOS, and handoff docs match actual git/tag/gate state.

## 4. Non-Goals

- No new IM adapter implementation.
- No Satori/Koishi or Chat SDK runtime integration.
- No public listener.
- No live external platform calls by default.
- No Keychain writes by default.
- No launchd install/uninstall by default.
- No implicit Computer Use or unattended real desktop provider execution.
- No real secrets in docs, fixtures, logs, SQLite, Linear, or review packets.

## 5. Persistent Redlines

- Native Codex App Server rich-client boundary only:
  `IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server`.
- No Codex CLI/TUI output parsing as product protocol.
- No OpenClaw plugin.
- Approval decisions go through `ApprovalBroker.resolve()`.
- SecurityPolicy and actor policy remain before actionable rendering/settle.
- Callback data remains opaque token only.
- Raw callback tokens are never persisted.
- `messageRef` and server-side approval binding are validated before resolve.
- Unknown, unauthorized, malformed, stale, replayed, transport-lost, or
  security-uncertain paths fail closed.

## 6. Linear Queue

| Issue | Task | Scope | Exit |
|---|---|---|---|
| JAC-167 | RR T0 | release-readiness plan + live status | docs define queue and上线标准 |
| JAC-168 | RR T1 | GitHub Actions CI | PR/push non-live gates run in CI |
| JAC-169 | RR T2 | production ops preflight command | local dry-run readiness command tested |
| JAC-170 | RR T3 | operator launch checklist + rollback | Mac mini runbook complete |
| JAC-171 | RR T4 | final review, handoff, tag | blockers closed; tag pushed |

## 7. Gate Matrix

### CI / Non-Live Mandatory Gates

- `pnpm check:codex-version`
- `pnpm typecheck`
- `pnpm typecheck:tests`
- `pnpm test`
- `pnpm test:cli-smoke`
- `pnpm lint`
- `pnpm protocol:check`
- `pnpm exec tsx scripts/verify-phase1-fixtures.mts`

`protocol:check` must run serially because it removes and regenerates protocol
output before diffing.

### Release Readiness Local Gates

- all CI/non-live mandatory gates;
- `pnpm launchd:install --dry-run`;
- `bash bin/load-and-run.sh --dry-run`;
- default-gate/default-skip checks for live smoke commands:
  - `pnpm smoke:telegram-live`
  - `pnpm smoke:telegram-real`
  - `pnpm smoke:lark-live`
  - `pnpm smoke:dingtalk-live`
  - `pnpm smoke:computer-use-live`
- fake smoke checks:
  - `pnpm smoke:telegram-fake`
  - `pnpm smoke:lark-fake`
  - `pnpm smoke:dingtalk-fake`
- redaction check: dry-run/status output must not contain token-shaped values.

## 8. Task Details

### JAC-167 / RR T0 - Plan And Live Status

Allowed files:

- `docs/internal/superpowers/plans/2026-05-03-release-readiness-plan.md`
- `docs/internal/handoffs/release-readiness-live-status.md`
- `README.md`
- `TODOS.md`

Exit:

- this plan exists;
- live status records branch/HEAD/queue;
- README/TODOS point at release readiness;
- no product source changes.

### JAC-168 / RR T1 - GitHub Actions CI

Allowed files:

- `.github/workflows/ci.yml`
- `docs/internal/handoffs/release-readiness-live-status.md`
- `TODOS.md`

CI must not run live smoke commands or require secrets.

### JAC-169 / RR T2 - Production Ops Preflight Command

Allowed files:

- `scripts/release-readiness-check.mts`
- `scripts/release-readiness-check.test.mts`
- `package.json`
- `docs/ops/release-readiness.md`
- `docs/internal/handoffs/release-readiness-live-status.md`
- `TODOS.md`

Default execution must be non-live and side-effect-minimized. Any command that
would touch Keychain, launchctl load/unload, external IM platforms, real Codex
turns, or desktop Computer Use must remain explicit and opt-in.

### JAC-170 / RR T3 - Operator Launch Checklist

Allowed files:

- `docs/ops/production-launch.md`
- `README.md`
- `docs/internal/handoffs/release-readiness-live-status.md`
- `TODOS.md`

Checklist must include prerequisites, install, health, logs, backup, smoke,
rollback, and redaction. It must avoid real secret values and public listener
instructions.

### JAC-171 / RR T4 - Final Review And Tag

Allowed files:

- `docs/internal/release-readiness/**`
- `docs/internal/handoffs/**`
- `README.md`
- `TODOS.md`
- `package.json` only if release version convention requires a bump

Exit:

- outside-voice final review recorded;
- full gates green;
- release readiness live status frozen;
- release-readiness tag pushed;
- Linear project complete.

## 9. Review Strategy

Use Codex outside-voice review at JAC-171. Consult GPT Pro earlier only if:

- gate failures have more than one plausible fix;
- CI/provider behavior conflicts with repo docs;
- readiness scope risks crossing into live external systems;
- public listener or approval/security behavior becomes ambiguous.

## 10. Release Tag Proposal

If JAC-171 passes, tag:

```text
production-readiness-2026-05-03
```

This tag represents a production-ready local Mac mini release candidate, not a
public SaaS deployment.

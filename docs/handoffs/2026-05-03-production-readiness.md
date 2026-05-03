# 2026-05-03 Production Readiness Handoff

Status: release-ready local Mac mini candidate.

## 1. Release Pointer

- Branch: `codex/release-readiness`
- Base tag: `phase-7-extended-platforms-web-console-complete`
- Release tag: `production-readiness-2026-05-03`
- Version: `0.1.0-phase7`
- Parent Linear issue: JAC-166
- Final Linear issue: JAC-171

## 2. What This Release Means

The repository is ready for private local operation on the operator's Mac mini.
It is not a public SaaS deployment and does not expose Codex App Server to the
internet by default.

The runnable path is:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

Release readiness added:

- GitHub Actions CI for mandatory non-live gates.
- `pnpm release:check` as the local production preflight.
- Environment-hermetic default live-smoke probes.
- launchd plist dry-run and Keychain wrapper dry-run checks.
- SQLite backup proof against a temporary database.
- Operator launch, status, logs, backup, smoke, and rollback runbook.
- Final Codex outside-voice review evidence.

## 3. Final Gate Evidence

Final local gates:

```text
pnpm exec vitest run --project unit scripts/release-readiness-check.test.mts scripts/keychain-launchd-smoke-doc.test.mjs
-> green, 2 files / 8 tests

env TELEGRAM_LIVE=1 ... COMPUTER_USE_LIVE=1 pnpm release:check -- --skip-full-gates
-> green, ambient live env scrubbed and default probes remained gated/skipped

pnpm release:check
-> green

git diff --exit-code packages/codex-protocol
-> green

git diff --check
-> green
```

`pnpm release:check` covers:

- `pnpm check:codex-version`
- `pnpm typecheck`
- `pnpm typecheck:tests`
- `pnpm test`
- `pnpm test:cli-smoke`
- `pnpm lint`
- `pnpm protocol:check`
- `pnpm exec tsx scripts/verify-phase1-fixtures.mts`
- launchd install dry-run
- Keychain wrapper dry-run through a fake `security` shim
- SQLite backup proof
- fake Telegram/Lark/DingTalk smokes
- default Telegram live/real operator gates
- default Lark/DingTalk/Computer Use skip checks

## 4. Review Evidence

| File | Verdict | Outcome |
|---|---|---|
| `docs/release-readiness/final-review.md` | `APPROVE_WITH_CHANGES` | found P1 ambient live-smoke env inheritance |
| `docs/release-readiness/final-review-followup.md` | `GO_WITH_LOW_NITS` | P1 fixed by `16d11ca` |
| `docs/release-readiness/final-review-delta.md` | `GO_WITH_LOW_NITS` | lazy setup P3 fixed by `7052a8a`; JAC-171 may tag |

No P0/P1/P2 findings remain before the production-readiness tag.

## 5. Run It

Primary operator runbook:

- `docs/ops/production-launch.md`

Minimum release preflight before starting the daemon:

```bash
pnpm release:check
```

Default preflight does not write Keychain entries, install/uninstall launchd
agents, call live IM APIs, run real Codex turns, or execute real Computer Use.

## 6. Live IM Validation

The fake/contract paths are green in `pnpm release:check`. Real IM validation is
credential-dependent and should be run from the Mac mini environment when the
operator has the relevant bot/app credentials installed.

Telegram:

```bash
pnpm smoke:telegram-fake
TELEGRAM_LIVE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-live
TELEGRAM_LIVE=1 CODEX_REAL_SMOKE=1 IM_TELEGRAM_BOT_TOKEN=... pnpm smoke:telegram-real
```

Lark/Feishu:

```bash
pnpm smoke:lark-fake
LARK_LIVE=1 LARK_LIVE_DRY_RUN=1 LARK_APP_ID=... LARK_APP_SECRET_ENV=LARK_APP_SECRET LARK_TARGET_CHAT_ID=... pnpm smoke:lark-live
```

Omit `LARK_LIVE_DRY_RUN=1` only when the operator intentionally wants to send a
real test message.

DingTalk:

```bash
pnpm smoke:dingtalk-fake
DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 DINGTALK_CLIENT_ID=... DINGTALK_CLIENT_SECRET_ENV=DINGTALK_CLIENT_SECRET pnpm smoke:dingtalk-live
```

Omit `DINGTALK_LIVE_DRY_RUN=1` only when the operator intentionally wants to
open the real Stream connection.

Computer Use:

```bash
pnpm smoke:computer-use-live
COMPUTER_USE_LIVE=1 COMPUTER_USE_PROVIDER_VERIFIED=1 COMPUTER_USE_LIVE_DRY_RUN=1 COMPUTER_USE_LIVE_APP="Google Chrome" COMPUTER_USE_LIVE_TASK="open a harmless page" pnpm smoke:computer-use-live
```

Real desktop execution remains blocked by the harness until provider capability
is verified and explicitly implemented.

## 7. Rollback

Use `docs/ops/production-launch.md` rollback section:

```bash
pnpm launchd:uninstall --dry-run
pnpm db:backup -- --source <state.db> --backup-dir <backup-dir> --keep 10
```

Do not delete state before taking a backup.

## 8. Known Non-Release Artifacts

Local `.stderr` review logs and `.claude/scheduled_tasks.lock` are ignored and
not part of the release packet. They must not be committed or copied into
Linear/review packets because some historical review stderr logs contain
token-shaped fixture literals.

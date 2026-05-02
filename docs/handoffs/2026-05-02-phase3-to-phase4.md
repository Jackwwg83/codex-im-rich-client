# Phase 3 -> Phase 4 Handoff

> Purpose: compact recovery anchor for a fresh Phase 4 planning session.
> Start here, then read `docs/handoffs/phase3-live-status.md`, `CLAUDE.md`, and the next Phase 4 plan once created.

---

## Phase 3 Close Snapshot

| Field | Value |
|---|---|
| Phase | Phase 3 — Telegram MVP + production daemon wire-up + SecurityPolicy ACL + persistent SessionRouter + launchd |
| Branch | `phase-3-implementation` |
| Tag gate issue | JAC-64 / T39-T40 |
| Tag name | `phase-3-telegram-mvp-complete` |
| Tag target | JAC-64 final handoff/tag-gate commit; verify with `git rev-parse phase-3-telegram-mvp-complete^{}` |
| Base tag | `phase-2-codex-reviewed` (`0d4dfc3`) |
| Version | `0.1.0-phase3` |
| Codex pin | `0.128.0` |
| Package count | 12 workspace packages |

Phase 3 is complete once this handoff/version commit is tagged and pushed as `phase-3-telegram-mvp-complete`.

## Final Gate Matrix

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 99 files, 970 passing, 1 skipped |
| `pnpm lint` | green: 222 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |

Final JAC-64 gate run was green after the `0.1.0-phase3` version bump and handoff updates.

## Review Status

| Review | Verdict | Closure |
|---|---|---|
| Phase 3 plan v2.4 | APPROVE_WITH_CHANGES | All P1/P2 plan findings absorbed before T1 unlock |
| T1.1-T2c implementation | APPROVE_WITH_CHANGES | Closed by `04a92fe` |
| T1-T19 mid-phase | APPROVE_WITH_CHANGES | Closed by `b5c4441` |
| T1-T36 final | APPROVE_WITH_CHANGES | Closed by `28adc64`, `f57acc0`, `938a917`, `0b0eb98`, `eb05753` |
| T40 tag gate | GO_WITH_LOW_NITS | `docs/phase-3/impl-t1-t40-tag-gate-codex-review.md` |

## D22-D31 Decision Summary

| Decision | Summary | Landed in |
|---|---|---|
| D22 | `SecurityPolicy` is sync, fail-closed, and reloads atomically | `packages/core/src/security-policy.ts` |
| D23 | Superseded by D38 | see D38 in live status |
| D24 | Telegram adapter boundary: `im-telegram` imports `channel-core` only among Codex packages | `packages/im-telegram/test/no-boundary-imports.test.ts` |
| D25 | Production daemon is a `Daemon` class with injected factories | `packages/daemon/src/daemon.ts` |
| D26 | `CommandRouter` is pure core logic; `/cu` is rejected in Phase 3 | `packages/core/src/command-router.ts` |
| D27 | `storage-sqlite` is the lowest layer and has no upward imports | `packages/storage-sqlite/test/no-upward-imports.test.ts` |
| D28 | Config package owns TOML/zod schema and env secret resolver | `packages/config/src/index.ts` |
| D29 | `Daemon.start()` has strict startup order and partial-start cleanup | `packages/daemon/test/daemon.test.ts` |
| D30 | Telegram callback data is `v1:` + short opaque token only | `packages/im-telegram/src/callback-codec.ts` |
| D31 | Audit ring failures are rate-limited and do not crash routing | `packages/storage-sqlite/src/audit.ts` |

Later Phase 3 decisions D32-D42 are live redlines in `docs/handoffs/phase3-live-status.md` §6 and carry into Phase 4+.

## Phase 3 Delivered Surface

- Storage: SQLite open/migrations, thread bindings, approvals, audit log, callback token repositories, WAL-safe backup.
- Core: SecurityPolicy, CommandRouter, SessionRouter, broker transport-loss helper, callback payload types, synthetic event normalizer.
- Daemon: strict start order, pending-mode registry, approval card flow, callback token/messageRef validation, inbound prompt routing, binding restore, shutdown settlement, prune sweeps, local status snapshots.
- Telegram: real `@codex-im/im-telegram` package with grammY lifecycle, callback codec, send/update/edit/answer APIs, raw message/action fixtures, boundary and contract tests.
- Ops: launchd install/uninstall dry-run, Keychain wrapper, log rotation, status CLI, DB backup CLI, fake/live/real smoke harnesses.
- Automation: autonomous loop runbook and Linear-driven issue cadence.

## Files Added Or Modified By Area

| Area | Highlights |
|---|---|
| `packages/storage-sqlite` | New package with repositories and migrations `001`, `002`, `003`, `004`, `007` |
| `packages/config` | New package for config schema and env secret resolution |
| `packages/im-telegram` | New package for Telegram adapter and fixtures |
| `packages/daemon` | Daemon class, logger, status snapshot producer, supervisor integration |
| `packages/core` | SecurityPolicy, CommandRouter, SessionRouter, broker extensions |
| `packages/channel-core` | D41 raw callback boundary and fake adapter updates |
| `packages/render` | transport-loss `turn_failed` rendering support |
| `packages/cli` | daemon status, db backup, Telegram fake/live/real smokes |
| `bin`, `templates`, `docs/ops` | launchd, Keychain wrapper, uninstall, cron backup, operator smoke docs |
| `docs/phase-3`, `docs/handoffs` | Phase 3 plan/review/handoff/status records |

## Operator Runbook Delta

- Install launchd dry-run: `pnpm launchd:install -- --dry-run`
- Live launchd install validates wrapper, daemon entry, and node binary before write/load.
- Token handling uses Keychain wrapper; Telegram bot token must not appear in plist, logs, fixtures, SQLite, docs, or Linear.
- Uninstall: `pnpm launchd:uninstall -- --dry-run` first, then non-dry-run only on the target Mac mini.
- DB backup: `pnpm db:backup`; implementation uses SQLite online backup and is WAL-safe.
- Status: `tsx packages/cli/src/index.ts daemon status` reads the local daemon status snapshot.
- Fake smoke: `pnpm smoke:telegram-fake` is CI-safe.
- Live Telegram smoke: `TELEGRAM_LIVE=1 pnpm smoke:telegram-live` is explicit env-gated.
- Real Telegram + real Codex smoke: requires both `TELEGRAM_LIVE=1` and `CODEX_REAL_SMOKE=1`.

## Phase 3 P2 Deferrals / Follow-ups

- Real launchd install and live Telegram/real Codex smokes remain operator-run on the target Mac mini; default CI gates do not execute live services.
- Daemon status snapshot is produced by the daemon surface; packaging/runtime entrypoint should pass `statusPath` when the deployment wrapper is finalized.
- `turns` and `outbound_messages` persistence remain Phase 4+ data-model expansion candidates.
- Structured secret detector beyond current regex redaction remains future polish.
- Per-kind risk-level computation from params remains future polish.
- Full audit-log expansion can revisit `08-DATA-MODEL.md` columns and retention policy.

## Phase 4 Candidate Missions

1. `@codex-im/im-lark` — Feishu/Lark adapter using `@larksuiteoapi/node-sdk`; prefer long connection / WSClient so the Mac mini does not need a public webhook.
2. `@codex-im/im-dingtalk` — DingTalk Stream adapter; can be Phase 5 if Lark remains Phase 4.
3. Computer Use planning — Phase 6 prep only; design `/cu` command flow and `ComputerUsePolicy`, no production CU trigger in Phase 4.
4. Web console planning — Phase 8 prep only.
5. Audit-log expansion — fill data-model columns and retention beyond the Phase 3 MVP repositories.

## Recommended Phase 4 Start

Linear next issue: JAC-65 — Phase 4 plan review gate for Feishu/Lark.

Phase 4 must start as planning-only work:

1. Read this handoff, `phase3-live-status.md`, `CLAUDE.md`, `06-IM-ADAPTERS.md` §4, and `07-SECURITY-AND-COMPUTER-USE.md`.
2. Draft a Phase 4 plan under `docs/superpowers/plans/`.
3. Review the plan with Codex/GPT Pro before implementing `im-lark`.
4. Keep real Lark credentials and live calls operator-gated; do not put secrets in Linear or docs.

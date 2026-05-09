# Install, Status, And Manual Upgrade Runbook

Generated: 2026-05-09

Status: planning runbook for Phase 8 / Direct Use Operations Hardening.

## User Commands

First install:

```bash
pnpm install
pnpm codex-im:install
pnpm codex-im:status
```

Install a known first platform without the chooser:

```bash
pnpm codex-im:install --platform telegram
```

Check updates:

```bash
pnpm codex-im:upgrade --check
```

Preview upgrade:

```bash
pnpm codex-im:upgrade
pnpm codex-im:upgrade --plan
```

Dry-run apply:

```bash
pnpm codex-im:upgrade --apply --dry-run
```

Manual rollback:

```bash
pnpm codex-im:rollback
pnpm codex-im:rollback --restore-db
```

## Default Semantics

- `status` is local-only by default.
- `status --check-updates` and `upgrade --check` may contact the git remote.
- `upgrade` defaults to `--plan`.
- `upgrade --plan` does not mutate machine state and does not run `git fetch`
  unless `--refresh` is explicit.
- `upgrade --apply` is the first command allowed to fetch, checkout, install,
  build, backup, or change launchd state.
- `upgrade --apply` requires a clean worktree in v1.
- v1 normal upgrade targets are git tags only.
- `--yes` skips confirmation only; it does not skip safety gates.

## Secret Rules

- Platform secrets live in macOS Keychain.
- Non-secret config lives in `~/.codex-im-bridge/config.toml`.
- Upgrade and rollback must not read, print, hash, back up, overwrite, or delete
  Keychain secret values.
- Doctor may report only `present`, `missing`, or `unreadable` for secret
  references.

## Lock

Mutating lifecycle paths must acquire:

```text
~/.codex-im-bridge/upgrade.lock
```

The lock protects:

- install;
- `upgrade --apply`;
- rollback;
- bridge install/uninstall;
- launchd install/uninstall;
- future `doctor --fix`.

The tool may detect stale locks, but should not delete uncertain locks without
an explicit operator command.

## Upgrade Preflight

Before mutation:

- worktree must be clean;
- target must resolve to an allowed git tag;
- Node/pnpm/Codex must be compatible;
- config must parse;
- secret references must be present;
- storage must be readable/writable;
- launchd/bridge state must be consistent;
- DB schema compatibility must be known;
- no active turn may be running;
- no pending approval may be open.

Live IM reachability is not part of upgrade preflight unless the user explicitly
asks for live smoke.

## Backup

Backups live under:

```text
~/.codex-im-bridge/backups/<timestamp>/
```

They include:

- config;
- SQLite state files or SQLite backup output;
- installed app;
- wrapper script;
- LaunchAgent plist;
- metadata with source ref, installed metadata, launchd state, target, args, and
  file checksums.

SQLite backup must be WAL-safe. Do not copy `state.db` while the daemon may be
writing.

Keychain secret values are never backed up.

## Rollback Policy

Failed apply auto-rollback:

- restores DB from the just-created backup;
- restores app/bin/plist/config/source;
- restores previous launchd loaded/unloaded state.

Manual rollback:

- does not restore DB by default;
- restores DB only with `--restore-db`;
- does not delete logs;
- does not modify Keychain secrets.

## Slice 1 Acceptance

Slice 1 is non-mutating except for explicit update-check cache writes:

```bash
pnpm codex-im:status
pnpm codex-im:status --check-updates
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
```

Expected properties:

- chooser delegates to existing setup wizard;
- existing `--platform <platform>` still works;
- status is local-only by default;
- `upgrade --check` writes only redacted cache;
- `upgrade --plan` makes no filesystem changes;
- `upgrade --apply --dry-run` makes no filesystem changes;
- dirty worktree blocks real apply in the plan;
- logs and output are redacted.

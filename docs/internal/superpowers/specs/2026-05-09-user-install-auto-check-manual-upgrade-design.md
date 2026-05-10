# User Install, Auto-Check, And Manual Upgrade Design

Generated: 2026-05-09

Status: reviewed by GPT Pro on 2026-05-09. Verdict:
`APPROVE_WITH_CHANGES`.

This spec defines the Phase 8 / Direct Use Operations Hardening direction for
making Codex-IM easier for open-source users to install, diagnose, and manually
upgrade without weakening local-control boundaries.

Canonical follow-ups:

- `docs/handoffs/phase8-ops-upgrade-live-status.md`
- `docs/ops/install-upgrade-runbook.md`

## Goal

Make Codex-IM feel like a normal local open-source daemon to install and keep
healthy:

```bash
git clone <repo-url>
cd codex-im-rich-client
pnpm install
pnpm codex-im:install
pnpm codex-im:status
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --apply
```

The install and upgrade commands remain transparent wrappers around local
boundaries: setup wizard, macOS Keychain, doctor, bridge build/install, launchd
install/status, backups, and rollback. There is no hosted credential store and
no silent daemon self-update.

## Existing Foundation

The repo already has the right low-level pieces:

- `pnpm setup:im` writes local config and Keychain secrets.
- `pnpm im:doctor` checks config, Keychain, allowlists, installed bridge state,
  and platform readiness without live IM traffic.
- `pnpm bridge:build` builds the daemon bundle.
- `pnpm bridge:install` installs app/bin artifacts under
  `~/.codex-im-bridge/`.
- `pnpm launchd:install` installs the current-user LaunchAgent.
- `pnpm launchd:status` checks launchd and daemon status.
- `pnpm codex-im:install --platform <platform>` already composes first-use
  install steps.
- `pnpm codex-im:status` already composes doctor and launchd status.
- `pnpm codex-im:uninstall` removes launchd/app artifacts while preserving
  config, state, logs, and Keychain secrets.

The missing layer is a product-grade lifecycle surface:

- an install wizard that can start without requiring `--platform`;
- local status plus explicit update checking;
- a one-command, manual, previewable upgrade path;
- a safe rollback path with clear DB semantics.

## Non-Goals

- No silent daemon self-update.
- No background upgrade without a user command.
- No cloud credential storage.
- No automatic IM-platform app provisioning.
- No Homebrew requirement for the first implementation.
- No Linux/Windows production support in this iteration.
- No live IM smoke during install or upgrade unless the user explicitly asks.
- No mutation, backup, logging, or printing of Keychain secret values during
  upgrade.
- No arbitrary commit SHA upgrade path for normal users in v1.

## GPT Pro Review Decisions

GPT Pro approved the direction with these required changes:

- Treat this as a new Phase 8 / Direct Use Operations Hardening or standalone
  Install / Doctor / Manual Upgrade initiative.
- `pnpm codex-im:status` is local-only by default.
- `pnpm codex-im:upgrade` defaults to `--plan`.
- `upgrade --plan` must not mutate machine state and must not run `git fetch`
  by default.
- `upgrade --apply` requires a clean worktree in v1.
- v1 user upgrade targets are git tags only: `latest` or `vX.Y.Z`.
- Manual rollback does not restore SQLite by default; it needs `--restore-db`.
- Failed `upgrade --apply` auto-rollback restores DB from the same backup.
- Install, apply, rollback, bridge install/uninstall, and launchd
  install/uninstall need a single-process lock.
- SQLite backups must be WAL-safe, not a blind copy while the daemon can write.
- Rollback must handle both the installed bridge and the source checkout.
- Plan for an installed rollback helper that can restore the installed daemon
  even if the source checkout breaks.

## UX Proposal

### Install

Keep the current command working:

```bash
pnpm codex-im:install --platform telegram
```

Add an interactive default:

```bash
pnpm codex-im:install
```

If `--platform` is absent, the installer asks the user to choose one supported
platform:

```text
Choose one platform to configure first:
1. Telegram
2. Feishu/Lark
3. DingTalk
4. Slack
```

Then the existing setup wizard asks only for that platform's required fields.
Secrets continue to go to macOS Keychain; non-secrets go to
`~/.codex-im-bridge/config.toml`.

The install command should produce one short completion block:

```text
Codex-IM is installed and launchd is running.

Try this in your IM chat:
  /projects
  /new Reply exactly: OK

Useful local commands:
  pnpm codex-im:status
  pnpm codex-im:upgrade --check
```

### Status And Update Checks

`status` means local health. It is fast, offline-capable, and non-mutating.

```bash
pnpm codex-im:status
```

Default status checks:

- installed package/bundle metadata;
- current git sha/tag;
- Node and pnpm compatibility;
- Codex version pin;
- config parse;
- Keychain secret reference presence only;
- launchd status;
- daemon status snapshot when available;
- SQLite migration version;
- dirty worktree;
- active turn / pending approval status.

Network checks are explicit:

```bash
pnpm codex-im:status --check-updates
pnpm codex-im:upgrade --check
```

Update-check cache path:

```text
~/.codex-im-bridge/update-check.json
```

Cache shape:

```json
{
  "schemaVersion": 1,
  "checkedAt": "2026-05-09T12:00:00.000Z",
  "sourceRemote": "origin",
  "currentGitSha": "abc123",
  "currentGitTag": "v0.1.0",
  "latestGitTag": "v0.1.1",
  "latestGitSha": "def456",
  "status": "update_available"
}
```

The cache is advisory only. `upgrade --apply` must resolve the target again and
must not trust cached SHAs as a safety root.

## Manual Upgrade

Add commands:

```bash
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --plan --refresh
pnpm codex-im:upgrade --apply
pnpm codex-im:rollback
```

Convenience:

```bash
pnpm codex-im:upgrade
```

Default `upgrade` behaves like `--plan` and prints the exact next command for
applying the upgrade. It must not mutate the machine. In particular, default
`--plan` must not run `git fetch`. `--plan --refresh` may refresh the
update-check cache.

Recommended first implementation source:

- source checkout + git remote/tags;
- not Homebrew;
- not a downloaded binary package.

The v1 user target can be:

```bash
pnpm codex-im:upgrade --apply --target latest
pnpm codex-im:upgrade --apply --target v0.1.1
```

Arbitrary SHA/branch upgrade targets are out of the normal v1 path. A future
developer-only `--target-ref <sha-or-branch> --dev` would need a release
manifest and separate compatibility checks.

## Upgrade Lock

Mutating lifecycle commands must acquire one lock:

```text
~/.codex-im-bridge/upgrade.lock
```

The lock applies to:

- install;
- `upgrade --apply`;
- rollback;
- bridge install/uninstall;
- launchd install/uninstall;
- any future `doctor --fix`.

Suggested lock metadata:

```json
{
  "pid": 12345,
  "command": "upgrade --apply",
  "startedAt": "2026-05-09T12:00:00.000Z",
  "repo": "/path/to/codex-im-rich-client",
  "target": "v0.1.1"
}
```

Stale lock detection may report the issue, but it must not automatically delete
an uncertain lock. The explicit escape hatch is:

```bash
pnpm codex-im:upgrade --clear-stale-lock
```

`--yes` can skip confirmation, but cannot skip safety gates.

## Upgrade State Machine

### Preflight

Fail before mutation if:

- worktree is dirty;
- current repo has no git remote and no explicit tag target;
- target is not a supported git tag;
- Node/pnpm cannot satisfy the target version;
- Codex version pin cannot be satisfied;
- active turn is detected;
- pending approvals are detected;
- config path is missing;
- installed bridge path is missing while launchd is installed;
- upgrade-preflight doctor fails;
- SQLite schema compatibility cannot be established.

`upgrade --check` and `upgrade --plan` may run in a dirty worktree, but the plan
must report `apply: blocked`.

`--force-stop` may interrupt the daemon before upgrade, but it must not override
pending approvals by default.

### Doctor Scope

Add or document an upgrade-specific doctor scope:

```bash
pnpm im:doctor --scope upgrade-preflight
```

It checks only upgrade-relevant state:

- config parse;
- secret references present, not secret values;
- storage readable/writable;
- launchd/bridge consistency;
- Node/pnpm/Codex compatibility;
- DB schema compatibility;
- no active turn / pending approval.

Unrelated live availability should not block upgrade, for example real Telegram
reachability, DingTalk client availability, or Computer Use disabled.

### Backup

Before applying an upgrade, create:

```text
~/.codex-im-bridge/backups/<timestamp>/
  config.toml
  state.db
  state.db-wal
  state.db-shm
  app/
  bin/load-and-run.sh
  io.codex-im-bridge.plist
  metadata.json
```

SQLite backup must be consistent. Use one of:

- stop daemon, checkpoint WAL, then copy `state.db`, `state.db-wal`, and
  `state.db-shm`;
- or use the SQLite backup API.

Do not copy `state.db` while the daemon may be writing.

`metadata.json` records:

- backup schema version;
- previous package version;
- source repo;
- source ref and SHA before upgrade;
- whether source was dirty;
- previous installed bundle metadata;
- Codex version pin;
- launchd installed/loaded state;
- upgrade target;
- command arguments;
- checksums for backed-up files.

Do not back up Keychain secret values.

### Apply

For source-checkout upgrades:

1. Acquire lock.
2. Run preflight.
3. Stop launchd/daemon when needed.
4. Create SQLite-safe backup.
5. `git fetch --tags`.
6. Resolve target tag.
7. Checkout target.
8. `pnpm install --frozen-lockfile`.
9. `pnpm check:codex-version`.
10. `pnpm bridge:build`.
11. Install bridge into a staging or release directory.
12. Atomically swap active app path or symlink.
13. `pnpm launchd:install`.
14. Restore previous launchd loaded state or start if previously loaded.
15. `pnpm launchd:status`.
16. `pnpm im:doctor --scope upgrade-preflight`.

If any step fails after backup, the command should attempt auto-rollback.

### Release Directory

Prefer release directories over in-place app replacement:

```text
~/.codex-im-bridge/releases/<git-tag-or-sha>/
~/.codex-im-bridge/app -> releases/<current>
```

If symlinks are deferred, use a staging rename flow:

```text
app.new -> validate -> app.prev -> app
```

### Rollback

Auto-rollback during a failed `upgrade --apply` restores DB from the same
backup by default because it is undoing a just-failed upgrade attempt.

Manual rollback:

```bash
pnpm codex-im:rollback
```

restores:

- previous source checkout when worktree is clean;
- previous installed app bundle;
- previous wrapper;
- previous LaunchAgent plist;
- previous config;
- previous launchd loaded/unloaded state.

Manual rollback does not restore SQLite by default. To restore DB:

```bash
pnpm codex-im:rollback --restore-db
```

Rollback never modifies Keychain secrets and never deletes logs. It may append
rollback logs.

### Rollback Helper

Plan for an installed helper:

```text
~/.codex-im-bridge/bin/rollback.mjs
```

or:

```text
~/.codex-im-bridge/bin/codex-im-rollback
```

The helper reads backup metadata and can restore installed app/bin/plist/config
and optional DB even when the source checkout is broken.

## Command Design

Extend `scripts/local-lifecycle.mts` rather than creating a separate install
surface.

Proposed modes:

```text
install
status
upgrade
rollback
uninstall
```

Proposed npm scripts:

```json
{
  "codex-im:install": "tsx scripts/local-lifecycle.mts install",
  "codex-im:status": "tsx scripts/local-lifecycle.mts status",
  "codex-im:upgrade": "tsx scripts/local-lifecycle.mts upgrade",
  "codex-im:rollback": "tsx scripts/local-lifecycle.mts rollback",
  "codex-im:uninstall": "tsx scripts/local-lifecycle.mts uninstall"
}
```

Dry-run support should exist for every mutating path:

```bash
pnpm codex-im:install --dry-run
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
pnpm codex-im:rollback --dry-run
```

## Data And Metadata

Installed bundle metadata:

```text
~/.codex-im-bridge/app/install-metadata.json
```

Suggested fields:

```json
{
  "schemaVersion": 1,
  "packageVersion": "0.1.0-phase7",
  "gitSha": "abc123",
  "gitTag": "v0.1.0-phase7",
  "codexVersion": "0.128.0",
  "installedAt": "2026-05-09T12:00:00.000Z"
}
```

This lets `status` compare repo state, installed bundle state, and cached update
state without guessing.

## Error Handling

Errors should be actionable:

- "dirty worktree" -> print a `git status --short` summary and explain how to
  commit/stash;
- "Codex pin mismatch" -> print current `codex --version`, required pin, and
  link to upgrade docs;
- "pending approval" -> tell user to resolve/decline approval in IM before
  upgrading;
- "active turn" -> tell user to send `/stop` or wait;
- "doctor failed" -> print the failing upgrade-preflight doctor section and
  suggested repair command;
- "lock held" -> print lock metadata and stale-lock handling;
- "rollback failed" -> print backup path and stop without deleting anything.

All logs and command output must be redacted:

- no Telegram token;
- no Lark app secret;
- no DingTalk client secret;
- no Slack bot token or app token;
- no access token;
- no Keychain output;
- no private callback IDs.

## Testing Strategy

Unit tests:

- `buildLocalInstallPlan()` prompts for platform when absent or errors cleanly
  in non-interactive mode.
- Existing `--platform <platform>` path still works.
- `buildLocalStatusPlan()` is local-only by default and does not call remote.
- `buildLocalUpgradeCheckPlan()` can refresh update-check cache with redacted
  output.
- `buildLocalUpgradePlan()` refuses dirty worktree for apply by default.
- `buildLocalUpgradePlan()` uses cache/local state for `--plan` and does not
  run `git fetch`.
- `buildLocalUpgradeDryRunPlan()` makes no filesystem changes.
- `--yes` cannot skip safety gates.
- Lock helper reports held/stale locks safely.
- Output redaction covers all platform secret patterns.

Second-slice tests before real apply/rollback:

- backup metadata includes checksums and source ref.
- SQLite backup uses WAL checkpoint/copy or backup API.
- auto-rollback restores DB after failed apply.
- manual rollback does not restore DB unless `--restore-db`.
- rollback helper can restore installed app without relying on source checkout.

Manual acceptance for Slice 1:

```bash
pnpm codex-im:status
pnpm codex-im:status --check-updates
pnpm codex-im:upgrade --check
pnpm codex-im:upgrade --plan
pnpm codex-im:upgrade --apply --dry-run
```

Full local gates after implementation:

```bash
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm lint
pnpm protocol:check
```

## Slice 1

Implement only non-mutating lifecycle expansion:

1. `codex-im:install` without `--platform` becomes an interactive platform
   chooser.
2. Add update-check cache schema.
3. Add installed metadata reader.
4. Add upgrade lock helper, dry-run only.
5. Add `codex-im:upgrade --check`.
6. Add `codex-im:upgrade --plan`.
7. Add `codex-im:upgrade --apply --dry-run`.

Forbidden in Slice 1:

- no real upgrade apply;
- no real rollback restore;
- no git checkout;
- no `pnpm install` from upgrade command;
- no bridge install mutation;
- no launchd mutation;
- no DB backup/restore mutation;
- no Keychain secret read/write beyond existing setup wizard;
- no secret values in logs/docs/tests.

Stop after Slice 1 with a completion report that includes files changed, tests,
gates, unresolved design gaps, and the exact Slice 2 plan for real
apply/backup/rollback.

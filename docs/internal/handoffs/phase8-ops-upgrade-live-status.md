# Phase 8 Ops Upgrade Live Status

Generated: 2026-05-09

Status: planning anchor. No product code has been implemented for this phase in
this patch.

## Scope

Phase 8 / Direct Use Operations Hardening covers user-facing local lifecycle
operations:

- first install UX;
- local status and doctor surface;
- explicit update checking;
- manual upgrade planning;
- real apply/backup/rollback in later slices.

This work is separate from the completed Phase 0-7 IM/platform acceptance work.

## Source Of Truth

- Design spec:
  `docs/internal/superpowers/specs/2026-05-09-user-install-auto-check-manual-upgrade-design.md`
- Operator runbook:
  `docs/ops/install-upgrade-runbook.md`
- Existing setup foundation:
  `scripts/local-lifecycle.mts`

## GPT Pro Review

Review date: 2026-05-09

Verdict: `APPROVE_WITH_CHANGES`

Required changes before code:

- Treat this as Phase 8 / Direct Use Operations Hardening or a standalone
  Install / Doctor / Manual Upgrade initiative.
- Keep `status` local-only by default.
- Make `upgrade` default to `--plan`.
- Keep `--plan` non-mutating; do not run `git fetch` by default.
- Require a clean worktree for v1 `upgrade --apply`.
- Support git tags only in the normal v1 upgrade path.
- Add an upgrade/install/rollback lock.
- Make backups SQLite/WAL-safe.
- Make rollback handle both installed app state and source checkout state.
- Add an installed rollback helper in a later slice.
- Do not back up, print, modify, or hash Keychain secret values.

## Current Decision Defaults

```text
pnpm codex-im:status
  local only

pnpm codex-im:status --check-updates
  may refresh update-check cache

pnpm codex-im:upgrade
  same as --plan

pnpm codex-im:upgrade --plan
  no mutation, no git fetch unless --refresh is explicit

pnpm codex-im:upgrade --apply
  mutating path, requires clean worktree

pnpm codex-im:rollback
  manual rollback, no DB restore unless --restore-db
```

## Slice 1

Allowed:

- interactive `pnpm codex-im:install` platform chooser;
- update-check cache schema;
- installed metadata reader;
- dry-run upgrade lock helper;
- `upgrade --check`;
- `upgrade --plan`;
- `upgrade --apply --dry-run`.

Forbidden:

- real upgrade apply;
- real rollback restore;
- git checkout;
- `pnpm install` from an upgrade command;
- bridge install mutation;
- launchd mutation;
- DB backup/restore mutation;
- Keychain secret reads/writes outside existing setup wizard.

## Open Until Slice 2

- release-directory or staging-rename implementation detail;
- SQLite backup implementation choice;
- source checkout rollback implementation;
- installed rollback helper shape;
- DB downgrade compatibility policy.

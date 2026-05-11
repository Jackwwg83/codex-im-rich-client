# 0005 — Release version and git tag must stay in sync

- **Status**: Accepted
- **Date**: 2026-05-11
- **Release**: v0.1.0-alpha.4

## Context

Between `v0.1.0-alpha.1` and `v0.1.0-alpha.3` the repository pushed three
annotated git tags and three GitHub Releases while `package.json`'s
`version` field stayed at `0.1.0-alpha.1`. The drift had two visible
effects for a fresh customer reader:

- `package.json` claimed an older version than the tag the user had
  checked out, breaking any consumer that reads `npm_package_version`
  or that surfaces "you are running …" diagnostics.
- The release notes implied a coherent release narrative
  (`alpha.1 → alpha.2 → alpha.3`) that the manifest did not reflect.

This is a documentation / packaging drift, not a security issue, but
in an open-source customer alpha the drift hurts trust more than it
saves time. It also blocks future automation that would derive
`installed.packageVersion` from the same field.

## Decision

The repository commits to a single rule for every release going
forward:

> **Every annotated tag `vX.Y.Z[-suffix]` must be paired with a commit
> whose `package.json:version` equals `X.Y.Z[-suffix]` exactly. The tag
> points at that commit.**

The rule is enforced in two places:

1. A `release:check` step in `.github/workflows/ci.yml` runs on tag
   pushes (`refs/tags/v*`) and fails if `package.json:version` differs
   from the tag name (stripped of leading `v`).
2. The release runbook (`docs/ops/production-launch.md`) and the
   automated release-readiness script (`scripts/release-readiness-check.mts`)
   both require the version bump commit to land in `main` before a tag
   is created.

Non-tag pushes do not enforce the equality — `main` can move ahead of
the latest tag — but `main`'s `package.json:version` must always equal
the next planned release, not the last one. Operators bump the version
in the same PR that opens the release branch.

## Alternatives considered

- **Derive `package.json:version` from `git describe`** at build time.
  Rejected: it requires the build to have access to the git history,
  which complicates packaging into the daemon bundle and pushes a
  string substitution into every script that reads the manifest.
- **Allow `package.json:version` to lag and only enforce tag-name
  consistency in releases.** Rejected: this is what produced the
  original drift; the manifest is the field downstream tools read.

## Consequences

- One additional CI step on tag pushes.
- One additional checklist item in the release runbook.
- New maintainers learn the rule on their first release and the CI
  check catches the regression for them.

## Retrospective: the alpha.1 → alpha.3 gap

The lag accumulated because each slice's release was treated as a
standalone artefact rather than as a tagged commit. The fix is purely
process: bump `package.json:version`, commit, then tag — never the
reverse.

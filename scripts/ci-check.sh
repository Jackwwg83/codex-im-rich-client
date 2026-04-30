#!/usr/bin/env bash
# T3 (Phase 1, P1-4): local "did your worktree pass everything?" gate.
#
# Mandatory before any subagent claims a task complete (per Phase 1
# execution rule). Bundles the five gates:
#
#   1. pnpm check:codex-version  — three-way version gate
#   2. pnpm typecheck            — 5 packages strict
#   3. pnpm test                 — unit + contract projects
#   4. pnpm test:cli-smoke       — InMemoryTransport-injected smoke
#                                  (capture flow, default-reject)
#   5. pnpm lint                 — biome
#   6. pnpm protocol:check       — regen-then-diff determinism
#
# Operator-only smokes (CODEX_SMOKE / CODEX_REAL_SMOKE) are NOT run here;
# they spawn real codex and may cost money. Run those manually before
# tagging Phase 1 complete.
#
# T4.5 will append `pnpm exec tsx scripts/verify-phase1-fixtures.mts` to
# this script so the fixture acceptance gate runs on every later
# subagent. Until T4 captures the fixture, that line stays out (the
# script does not yet exist on disk).
#
# Usage:
#   bash scripts/ci-check.sh

set -euo pipefail

# Run from the repo root regardless of where the operator invokes from.
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
cd "$ROOT"

step() {
  printf '\n\033[1;36m[ci-check] %s\033[0m\n' "$1"
}

step "1/6  pnpm check:codex-version"
pnpm check:codex-version

step "2/6  pnpm typecheck"
pnpm typecheck

step "3/6  pnpm test  (unit + contract)"
pnpm test

step "4/6  pnpm test:cli-smoke"
pnpm test:cli-smoke

step "5/6  pnpm lint"
pnpm lint

step "6/6  pnpm protocol:check"
pnpm protocol:check

echo
echo "ci-check: all gates green"

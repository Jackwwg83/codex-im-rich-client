#!/usr/bin/env bash
# T3 (Phase 1, P1-4): local "did your worktree pass everything?" gate.
#
# Mandatory before any subagent claims a task complete (per Phase 1
# execution rule). Bundles the gates:
#
#   1. pnpm check:codex-version             — three-way version gate
#   2. pnpm typecheck                       — 5 packages strict
#   3. pnpm test                            — unit + contract projects
#   4. pnpm test:cli-smoke                  — InMemoryTransport-injected smoke
#                                             (capture flow, default-reject)
#   5. pnpm lint                            — biome
#   6. pnpm protocol:check                  — regen-then-diff determinism
#   7. verify-phase1-fixtures.mts           — T4.5 acceptance gate (added
#                                             after T4 committed the
#                                             phase1-*.jsonl fixtures)
#
# Operator-only smokes (CODEX_SMOKE / CODEX_REAL_SMOKE) are NOT run here;
# they spawn real codex and may cost money. Run those manually before
# tagging Phase 1 complete.
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

step "1/7  pnpm check:codex-version"
pnpm check:codex-version

step "2/7  pnpm typecheck"
pnpm typecheck

step "3/7  pnpm test  (unit + contract)"
pnpm test

step "4/7  pnpm test:cli-smoke"
pnpm test:cli-smoke

step "5/7  pnpm lint"
pnpm lint

step "6/7  pnpm protocol:check"
pnpm protocol:check

step "7/7  verify-phase1-fixtures.mts  (T4.5 acceptance gate)"
pnpm exec tsx scripts/verify-phase1-fixtures.mts

echo
echo "ci-check: all gates green"

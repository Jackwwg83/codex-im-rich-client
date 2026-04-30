#!/usr/bin/env bash
# T3 (Phase 1, P1-4): local "did your worktree pass everything?" gate.
#
# Mandatory before any subagent claims a task complete (per Phase 1
# execution rule). Bundles the gates:
#
#   1. pnpm check:codex-version             — three-way version gate
#   2. pnpm typecheck                       — packages src/ strict
#   3. pnpm typecheck:tests                 — packages test/ strict via
#                                             root tsconfig.test.json
#                                             (added after T5 review
#                                             revealed that package
#                                             tsconfigs only include
#                                             src/, leaving type-only
#                                             test assertions like
#                                             @ts-expect-error silently
#                                             ignored)
#   4. pnpm test                            — unit + contract projects
#   5. pnpm test:cli-smoke                  — InMemoryTransport-injected smoke
#                                             (capture flow, default-reject)
#   6. pnpm lint                            — biome
#   7. pnpm protocol:check                  — regen-then-diff determinism
#   8. verify-phase1-fixtures.mts           — T4.5 acceptance gate (added
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

step "1/8  pnpm check:codex-version"
pnpm check:codex-version

step "2/8  pnpm typecheck  (packages/*/src)"
pnpm typecheck

step "3/8  pnpm typecheck:tests  (packages/*/test, T5 review #1)"
pnpm typecheck:tests

step "4/8  pnpm test  (unit + contract)"
pnpm test

step "5/8  pnpm test:cli-smoke"
pnpm test:cli-smoke

step "6/8  pnpm lint"
pnpm lint

step "7/8  pnpm protocol:check"
pnpm protocol:check

step "8/8  verify-phase1-fixtures.mts  (T4.5 acceptance gate)"
pnpm exec tsx scripts/verify-phase1-fixtures.mts

echo
echo "ci-check: all gates green"

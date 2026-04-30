# @codex-im/protocol
Houses generated TypeScript types from `codex app-server generate-ts` (stable
surface, no `--experimental` flag — see Phase 0 Task 0.2 decision) and JSON
schema artifacts. **Never write business logic here.**

## Facade rule
`src/index.ts` re-exports ONLY the small set of types currently consumed by the rest
of the workspace, using named exports. We do NOT `export *` from the generated
directory. Reasons:
- Reduces blast radius when codex upgrades change generated surface.
- Forces deliberate adoption of new types — every new export is a code review.

## Why stable, not --experimental?
See `docs/phase-0/host-environment.md` "--experimental decision" and
`docs/phase-0/codex-gen-diff.md`. tldr: experimental adds only realtime/fuzzy-session/
memory/elicitation/mock features that are out of Phase 0–6 scope. If Phase 7+
needs them, follow the "Switching to --experimental later" recipe in codex-gen-diff.md.

## Upgrade workflow
1. `pnpm check:codex-version` (will fail until CODEX_VERSION is updated).
2. Update root + package CODEX_VERSION + package.json#codexIm.codexVersion.
3. `pnpm protocol:generate`.
4. Review diff: `git diff packages/codex-protocol/`.
5. Run `pnpm test:contract` (replays wire fixtures against new types).
6. Update `packages/testkit/fixtures/codex-X.Y.Z/` if behavior changed.

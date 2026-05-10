# 0003 — Two-layer capability detection

- **Status**: Accepted
- **Date**: 2026-05-10
- **Slice**: 1 (release-readiness baseline)

## Context

Codex App Server's wire surface evolves between releases. The bridge
ships against a pinned codex version (`codexIm.codexVersion` in
`package.json`), but in practice the codex binary on a user's machine
may be:

- exactly the pinned version;
- an older version the user has not upgraded yet;
- a newer release than the bridge has been tested against;
- an experimental or main-branch build with fields the stable wire
  surface does not declare.

A naive bridge that assumes "if it's in the generated types it works"
or "if codex is at version X.Y, capability Z must exist" will silently
mis-route, drop, or misinterpret messages on the second, third, and
fourth cases above.

## Decision

All codex protocol capability detection is performed in two layers,
both of which must agree before a feature path is taken.

### Layer A — Compile-time

The bridge consults the generated protocol surface
(`packages/codex-protocol/src/generated/`) — produced from the pinned
codex's `generate-ts` / `generate-json-schema` — to confirm that a
type, method, or field exists at all. If a capability is not in the
generated surface, the corresponding code path is unreachable; no
runtime probe is needed.

### Layer B — Runtime

After the `initialize` handshake on each App Server spawn, the bridge
probes the actual codex process for the capability. The probe shape
depends on the capability:

- a method name returned in the handshake's capabilities map; or
- a feature-flag field the handshake exposes; or
- a low-cost no-op call that distinguishes "method understood" from
  "method unknown" (`-32601`).

Only if Layer B confirms the capability is present on the running
codex does the bridge enable the feature path.

### Forbidden shortcuts

- **No "OpenAI main" assumptions.** Fields that exist only on
  upstream `main` but not in the pinned generated surface must not
  be referenced by production code, even speculatively.
- **No version-number inference.** Code must not branch on
  `codex --version` or `codexIm.codexVersion` to decide whether a
  capability exists. A user's local codex may legitimately be
  newer or older than the pin; only Layer A + Layer B together are
  authoritative.

## Consequences

- New features that depend on a codex capability require both: (a) a
  regenerated protocol drop and (b) a runtime probe site. A feature
  flagged into `packages/codex-protocol/src/generated/` but with no
  Layer B probe is incomplete and must not be merged.
- Probe failure handling is fail-closed: an absent capability is
  reported to the user as "not supported on your codex version", not
  as a generic crash.
- This ADR formalises the practice already followed by the Phase 6
  Computer Use capability evidence work and the Phase 7 capability
  matrix; their content is grandfathered as conforming.

## References

- `packages/codex-protocol/src/generated/` — Layer A authority.
- `docs/internal/phase-6/computer-use-capability-evidence.md`
  (frozen) — Layer B precedent.
- `docs/internal/phase-7/capability-matrix.md` (frozen) — capability
  inventory pattern.

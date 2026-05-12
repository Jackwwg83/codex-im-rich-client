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
- **No schema smuggling.** If a field is absent from
  `packages/codex-protocol/schema/**` and
  `packages/codex-protocol/src/generated/**`, production code must not
  tunnel it through an untyped `config` payload or object spread. This
  applies especially to future `permissions` / `additionalWritableRoot`
  work.
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

## Retrospective amendment — 2026-05-10 (Slice 3)

The original "Layer B — Runtime" specification asked for an active
probe at `initialize` handshake. Implementing that against codex
0.128.0 turned out to require either a dedicated capability-discovery
RPC the server does not expose, or speculative calls (e.g.
`thread/setName` with a stub thread) that have surprising side
effects.

Slice 3 ships Layer B as a **passive observe-and-cache** pattern in
`packages/codex-runtime/src/capabilities.ts`:

- `CodexCapabilities` records `unsupported` only when a real
  JSON-RPC call returns code `-32601` (Method Not Found).
- The default for an un-observed method is "likely supported"
  because Layer A (compile-time presence in the generated protocol)
  has already approved it; the bridge would not have compiled
  otherwise.
- Mismatches between the generated protocol and the running codex
  are caught lazily on first invocation; subsequent calls to the
  same method skip the call and fall back without retrying.
- A successful call after a `-32601` re-flips the cache to
  `supported`, since the operator may have upgraded codex while the
  daemon was still running.

This is a strict subset of the originally-specified active-probe
pattern: every call site that consults `isLikelySupported(method)`
still observes Layer A semantics; the only relaxation is when Layer B
runs (lazily on first call instead of eagerly on handshake). The
**forbidden shortcuts** above (no main-branch assumptions, no
version-number inference) remain in force.

If a future codex release exposes an explicit capability-discovery
RPC, an additional ADR can amend this section to use it as the
default; the passive observe-and-cache will continue to apply for
codex versions that lack the RPC.

## Semantic guardrail — 2026-05-12

`scripts/check-app-server-semantics.mjs` is a fast local contract check
for the protocol assumptions that are easy to forget during a Codex pin
bump:

- native thread methods required by the IM bridge must remain present;
- `remoteControl/status/changed` may be parsed as informational status;
- `ThreadResumeParams` and `ThreadForkParams` must continue exposing
  `excludeTurns` for metadata-only resume/fork paths;
- `ThreadStartParams`, `ThreadResumeParams`, and `ThreadForkParams`
  must not silently gain a top-level `permissions` field without
  forcing a reviewed writable-roots enforcement plan.

The current pin still exposes `thread/turns/list`. Upstream evidence
shows that method may drift in newer Codex builds, so any future Codex
pin bump must audit every `thread/turns/list` runtime wrapper and daemon
call before release.

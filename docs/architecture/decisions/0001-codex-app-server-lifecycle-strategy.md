# 0001 — Codex App Server lifecycle strategy

- **Status**: Accepted
- **Date**: 2026-05-10
- **Slice**: 1 (release-readiness baseline)

## Context

The bridge needs a Codex App Server to drive thread / turn / item /
approval / review / Computer Use semantics. There are two upstream
lifecycle modes available at the time of this ADR:

1. **stdio mode** — invoked as `codex app-server --listen stdio://`,
   spawned per-bridge as a child process. The protocol is JSON-RPC
   over stdio. This mode is GA and the surface this project's
   `packages/codex-protocol` has been pinned and verified against
   (`codex 0.128.0`).

2. **`codex app-server daemon`** — a longer-lived, bridge-independent
   server process with machine-readable lifecycle commands and optional
   remote-control enablement. This surface is present on newer upstream
   builds but is not exposed by the pinned `codex 0.128.0` binary. The
   target user is Codex desktop / mobile remote clients, not local IM
   bridges.

A choice is needed because the bridge's `AppServerClient` / runtime /
supervisor wiring is bound to one of these models.

## Decision

`v0.1.x`, including `0.1.0-alpha.1`, runs Codex App Server in stdio
mode. The bridge spawns `codex app-server --listen stdio://` as a
child process and owns its lifecycle (start, restart, drain, stop).

`v0.2.x` will re-evaluate an optional lifecycle provider only after the
upstream lifecycle contract is stable on a pinned Codex release. If that
provider is adopted, lifecycle commands must be parsed as JSON only and
must remain separate from authorization decisions. The re-evaluation
will produce a follow-up ADR; this one is not amended in place.

## Consequences

- The `Supervisor` (per project root `CLAUDE.md` "Phase 2 redlines")
  remains the production wire-up. `runtime-send` stays a dev/operator
  tool only.
- `codex app-server daemon` and its remote-control WebSocket are
  explicitly non-goals for `v0.1.x`. See ADR 0004.
- Capability detection (ADR 0003) is sized for the stdio process
  model: probes happen at `initialize` handshake on each spawn, not
  against a long-lived daemon discovered out-of-band.
- The pinned codex version (`codexIm.codexVersion` in
  `package.json`) controls which generated protocol surface the
  bridge ships against. Switching off stdio mode is a major version
  concern, not a patch one.

## References

- Upstream `codex` `0.128.0` — pinned by `package.json`
  `codexIm.codexVersion`.
- Upstream `codex app-server daemon` lifecycle commands — out-of-scope
  until a follow-up ADR pins a release where they are available.
- ADR 0004 — remote-control non-goal.

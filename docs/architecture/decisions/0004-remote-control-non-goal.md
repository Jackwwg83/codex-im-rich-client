# 0004 — Codex remote-control is a non-goal

- **Status**: Accepted
- **Date**: 2026-05-10
- **Slice**: 1 (release-readiness baseline)

## Context

`codex` `0.130.x` introduced a remote-control WebSocket transport
inside `codex app-server-daemon`. It is the protocol Codex desktop /
mobile remote clients use to drive a long-lived codex daemon over the
network, with its own concerns:

- ack / cursor / segmentation for streamed responses;
- enrollment + auth for remote clients;
- multi-client multiplexing and lifecycle hand-off;
- a separate notification (`RemoteControlStatusChangedNotification`)
  signalling when the daemon is being remote-driven.

Because both products in question — the codex desktop / mobile remote
clients, and this IM bridge — connect IM-style chat surfaces to codex,
the temptation is to repurpose remote-control as the bridge's
transport. That temptation must be refused on principle, not just
postponed.

## Decision

The bridge does not implement, expose, or depend on the codex
remote-control WebSocket.

- The bridge does **not** ship a remote-control WebSocket client. The
  transport between bridge and codex is stdio (see ADR 0001).
- The bridge does **not** offer `enable-remote-control` or any
  equivalent IM-facing toggle. There is no IM command, slash command,
  card action, or admin path that turns remote-control on or off.
- If the bridge receives `RemoteControlStatusChangedNotification`
  from the App Server, it is treated as **status metadata only**. It
  may surface a single-line indicator in the `/status` IM command's
  output. It must **never** be used to:
  - authorize an IM action (approval, command, computer-use trigger);
  - relax `SecurityPolicy` decisions;
  - re-route an `ApprovalBroker` request;
  - alter `SessionRouter` actor or target binding.
  - decide whether to start, stop, restart, or replace the bridge's
    App Server process.

Future app-server daemon lifecycle diagnostics may report whether
`codex app-server daemon version` is available. That diagnostic is also
informational only: it must parse JSON if present, never enable
remote-control, never call mutating lifecycle commands, and never
replace the `Supervisor` / stdio lifecycle path in `v0.1.x`.

## Consequences

- IM-side authorization paths derive from bridge state alone:
  `SecurityPolicy`, `SessionRouter`, `ApprovalBroker`, and the
  configured project bindings (ADR 0002). Whether codex thinks it is
  being remote-driven has no bearing.
- Mixing remote-control's transport semantics (ack / cursor /
  segmentation / enrollment / auth) into the bridge would conflict
  with `ApprovalBroker`'s settle-once invariants and `SecurityPolicy`'s
  fail-closed guarantees. Keeping the two surfaces strictly separate
  preserves both.
- A future need for cross-device chat (e.g. mobile + IM bridge
  sharing a thread) is a product question that belongs upstream in
  codex, not in this bridge. If that need ever lands here, it
  supersedes this ADR explicitly with a new ADR; this one is not
  amended in place.

## References

- ADR 0001 — codex App Server lifecycle strategy (stdio mode).
- Project root `CLAUDE.md` "绝对不要做" — the redline list this ADR
  formalises.

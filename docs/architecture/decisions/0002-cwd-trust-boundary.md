# 0002 — Working-directory trust boundary

- **Status**: Accepted
- **Date**: 2026-05-10
- **Slice**: 1 (release-readiness baseline)

## Context

A Codex thread carries a `cwd` (current working directory) in its
metadata. That `cwd` originates in two places:

1. **Bridge-configured project**. The user defines a project in
   `config.toml` (e.g. `[projects.work]`) with an explicit `cwd`. This
   value is under the user's local control.

2. **Codex App Server**. When a thread is created with no project
   binding, or when codex is the originator (e.g. an existing thread
   the bridge attaches to), codex returns a `cwd` of its own choice.
   This value is **not** under the bridge's control and may, in
   adversarial scenarios, be crafted.

Treating both sources as equivalent would let codex (or anyone able to
inject codex output) trick the bridge into believing the user is
operating inside a configured project, which would in turn unlock
project-scoped allowlists, writable-roots, and approval policy.

A trust boundary is needed.

## Decision

The bridge maintains two distinct project slots:

- **`configured_project`** — populated only from `config.toml`. The
  `cwd` is `fs.realpath`-resolved at load time and validated against
  the configured allowlist (`writable_roots` + an explicit
  symlink-escape check). This slot grants project-scoped permissions
  (allowed users / chats / writable roots).

- **`app_default`** — populated from any `cwd` the bridge receives
  from codex App Server when no `configured_project` matches. This
  slot is informational only: it has no allowlist, no writable
  roots, and never grants project-scoped permission. It exists so
  the bridge can still attach to and operate on a codex-originated
  thread without crashing.

Promotion from `app_default` to `configured_project` is forbidden.
A codex-returned `cwd` must never be matched against the configured
projects table to "discover" a binding; configured bindings are
established only by explicit user action through
`/projects` / `/use`.

In IM-rendered views, the `cwd` of an `app_default` slot is never
displayed verbatim. The renderer projects it to a redacted form (e.g.
`/…/<basename>`), consistent with the broader redaction policy.

## Consequences

- Project ACL evaluation reads the slot kind first. `app_default`
  short-circuits to a "no project binding" decision; only
  `configured_project` queries the allowlist.
- Even if codex returns a `cwd` that exactly equals a configured
  project's `cwd` string, that does **not** establish a binding. The
  slot stays `app_default` until the user runs `/use`.
- Bridge logs must continue to redact `cwd` values from `app_default`
  threads when surfaced to operators or telemetry.
- This decision is the failure mode behind several Phase 3 P1 review
  findings about project-level ACL bypass; the boundary documented
  here is the long-term shape of the rule, independent of any single
  fix.

## References

- Project root `CLAUDE.md` "必须坚持的架构" — the layered architecture
  this slot split lives inside.
- `docs/internal/phase-3/impl-t1-t19-midphase-codex-review.md`
  (frozen) — original P1 findings on project-level ACL.

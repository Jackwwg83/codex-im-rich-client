// T15 (Phase 2) — re-export of `redact` from @codex-im/core.
//
// Per F10 / Codex Q5 / D11, the redact primitive lives canonically in
// core (alongside AuditEmitter which uses it at emit time). The
// renderer also needs it for project-approval text-field redaction,
// so this module just re-exports — no logic, no second definition.
//
// Tests for redact regex coverage live in
// packages/core/test/redact.test.ts. Renderer-side tests assert the
// PROJECTED card has redacted output (T16.2 / gstack T-G1) — they
// don't re-test the underlying patterns.

export { redact } from "@codex-im/core";

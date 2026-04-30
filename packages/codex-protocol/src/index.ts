// Facade: only named exports, never export *. See README.md.
//
// Phase 0 surface — only types consumed by the initialize handshake
// (Section H Task 7.1 `performInitializeHandshake`). Add a new export
// ONLY when a downstream package starts importing it; every new export
// is a deliberate code-review checkpoint.
//
// Note on naming: ts-rs emits `InitializeResponse` (not `InitializeResult`
// as some older drafts of 05-PROTOCOL.md may suggest). The wire spike at
// docs/phase-0/host-environment.md confirms this is the canonical name.

export type {
  ClientInfo,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
} from "./generated/index.js";

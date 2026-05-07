// T1.1 (Phase 3) — @codex-im/storage-sqlite package skeleton.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T1.1
//
// Skeleton: empty exports. Implementation lands in subsequent T-tasks
// (each enters this package's src/ as its own commit):
//   T2a  database.ts        openDatabase + WAL pragma + foreign-keys ON
//   T2b  migration runner   runMigrations(db, dir)
//   T2c  migration runner idempotency
//   T3a  001-init migration (schema_version table)
//   T4a  002-thread_bindings migration + BindingRepository.upsert
//   T4b  BindingRepository.list + delete
//   T4c  BindingRepository D38 sync write-through
//   T5a  003-approvals migration + ApprovalRepository
//   T5b  ApprovalRepository redact roundtrip
//   T6a  004-audit migration + AuditRepository
//   T6b  AuditRepository redact roundtrip
//   T6c  AuditRepository rate-limited failure (D31)
//   T6d  007-callback_tokens migration + CallbackTokenRepository (D34)
//   T6e  callback_tokens hash-only assertion (raw token never persisted)
//   T6f  callback_tokens action enum round-trip (D34 'abort' not 'cancel')
//   B2   008-thread_sessions migration + ThreadSessionRepository
//
// Boundary (D27 + plan §16.2 T1.1 boundary): storage-sqlite has NO
// upward import of:
//   @codex-im/core              broker / redact / audit (storage is below)
//   @codex-im/codex-runtime     runtime / EventNormalizer
//   @codex-im/app-server-client transport / client
//   @codex-im/channel-core      adapter contract
//   @codex-im/protocol          codex protocol types (storage stores
//                                opaque strings, never protocol shapes)
//   @codex-im/render            rich-block rendering
//   @codex-im/daemon            top-level orchestration
//   @codex-im/im-telegram       Phase 3 platform adapter
//
// Boundary tests in test/no-*-import.test.ts enforce. Storage is the
// LOWEST layer in the Phase 3 stack; core consumes storage via
// dependency injection (Daemon constructs repositories then injects
// them into broker / SessionRouter / audit-emit subscribers).
//
// What this package will export at end of T6f:
//   openDatabase                — sync better-sqlite3 wrapper with WAL  (T2a — landed)
//   runMigrations               — idempotent migration runner            (T2b)
//   BindingRepository           — chat ⇄ project ⇄ thread bindings       (T4a-c)
//   ApprovalRepository          — durable audit copy of approval lifecycle (T5a-b)
//   AuditRepository             — write-through audit ring (D31)         (T6a-c)
//   CallbackTokenRepository     — D34 callback_tokens with Target hydration (T6d-f)
//   ThreadSessionRepository     — known real Codex threads per IM target (B2)
//   EventLogRepository          — codex notification log (deferred to Phase 4)

// T2a + T2b (Phase 3) — database lifecycle exports.
export {
  openDatabase,
  runMigrations,
  type DatabaseHandle,
  type MigrationRunResult,
} from "./database.js";

// T4a (Phase 3) — thread_bindings repository exports.
export {
  BindingRepository,
  type BindingTarget,
  type BindingUpsert,
  type ThreadBindingRecord,
} from "./bindings.js";

// T5a (Phase 3) — approvals repository exports.
export {
  ApprovalRepository,
  type ApprovalRecord,
  type ApprovalRepositoryOptions,
  type ApprovalStatus,
  type ApprovalTarget,
  type ApprovalUpsert,
} from "./approvals.js";

// T6a (Phase 3) — audit_log repository exports.
export {
  AuditRepository,
  type AuditInsertBestEffortResult,
  type AuditInsert,
  type AuditRecord,
  type AuditRepositoryOptions,
  type AuditUnavailableMarker,
} from "./audit.js";

// T6d (Phase 3) — callback_tokens repository exports.
export {
  CallbackTokenRepository,
  hashCallbackToken,
  type CallbackTokenApprovalTargetActionLookup,
  type CallbackMessageRef,
  type CallbackTokenAction,
  type CallbackTokenActor,
  type CallbackTokenCasFields,
  type CallbackTokenInsert,
  type CallbackTokenMessageRefActionLookup,
  type CallbackTokenRecord,
  type CallbackTokenStatus,
  type CallbackTokenTarget,
} from "./callback-tokens.js";

// Direct Use Completion B2 — known real Codex thread sessions.
export {
  ThreadSessionRepository,
  type ThreadSessionListOptions,
  type ThreadSessionRecord,
  type ThreadSessionStatus,
  type ThreadSessionSwitchCurrent,
  type ThreadSessionSwitchResult,
  type ThreadSessionTarget,
  type ThreadSessionUpsert,
} from "./thread-sessions.js";

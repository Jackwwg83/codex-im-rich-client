// T2a (Phase 3) — openDatabase + standard pragmas.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T2a
//       + §7 D38 (sync write-through; better-sqlite3 is sync by design)
//       + §7 D39 (preflight-required; better-sqlite3 verified at T1.0)
//
// Returns a `better-sqlite3` Database handle with the project's standard
// pragmas applied:
//
//   journal_mode = WAL
//     Concurrent reader / single writer; faster writes than the default
//     `delete` mode. SQLite's WAL is a no-op on `:memory:` databases —
//     SQLite refuses the change and the journal stays in `memory` mode.
//     Test below documents both branches.
//
//   foreign_keys = ON
//     Enforces FK constraints. SQLite's default is OFF for backwards
//     compatibility with old apps; we always want ON so FK violations
//     fail at write time, not silently corrupt the schema.
//
// Sync API: better-sqlite3 is fully synchronous. This matches D38's
// SessionRouter sync write-through contract and D33's per-callback
// atomic CAS expectations. No `await` needed for any DB op.

import Database from "better-sqlite3";

/**
 * Re-exported Database handle type. Consumers should import this from
 * `@codex-im/storage-sqlite` rather than `better-sqlite3` directly so
 * that swapping the SQLite binding (per D39 fallback path, e.g. to
 * Node 24's built-in `node:sqlite`) only requires updating this
 * single re-export.
 */
export type DatabaseHandle = Database.Database;

/**
 * Open a SQLite database with the project's standard pragmas.
 *
 * @param path Filesystem path to the SQLite file, or `":memory:"` for
 *   an in-process database. The caller owns the path; this function
 *   does NOT mkdir / chmod / clean up. Caller is responsible for
 *   `db.close()` (or end-of-process cleanup).
 *
 * @returns The opened Database handle with `journal_mode = WAL` (when
 *   path is a file) and `foreign_keys = ON` applied.
 */
export function openDatabase(path: string): DatabaseHandle {
  const db = new Database(path);
  // Order matters slightly: WAL pragma should fire before any tables
  // are created so the WAL file exists alongside the main DB. For
  // `:memory:` databases, SQLite ignores the WAL request and keeps
  // `memory` mode; the tests document both branches.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// T2a + T2b (Phase 3) — openDatabase + standard pragmas + migration runner.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md
//   §8.1   storage-sqlite/src/database.ts hosts openDatabase + migration
//          runner (single file, by plan-of-record).
//   §16.2  T2a (openDatabase + WAL + foreign-keys ON, landed)
//          T2b (runMigrations: walk dir, apply, record in schema_version)
//          T2c (idempotency — same runner, second test)
//          T3a (001-init.sql migration that owns schema_version DDL)
//   §7 D38 sync write-through (better-sqlite3 is sync by design)
//   §7 D39 preflight-required (better-sqlite3 verified at T1.0)
//
// openDatabase returns a `better-sqlite3` Database handle with the
// project's standard pragmas:
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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

// ---------------------------------------------------------------------------
// T2b — runMigrations
// ---------------------------------------------------------------------------

/**
 * Result of `runMigrations`. `applied` lists the filenames of migrations
 * that were applied during *this* call, in the order they ran. An empty
 * array means every migration on disk was already recorded in
 * `schema_version` (the steady-state idempotent case).
 */
export interface MigrationRunResult {
  applied: string[];
}

/**
 * Bootstrap DDL for the `schema_version` audit table. T3a adds an explicit
 * `001-init.sql` that owns this table; the runner installs it idempotently
 * here so T2b's tests work without depending on T3a's file existing yet.
 *
 * Both this DDL and the T3a migration use `CREATE TABLE IF NOT EXISTS` so
 * the redundancy is safe and self-documenting.
 */
const SCHEMA_VERSION_DDL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version    TEXT    PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

/**
 * Migration filename convention: `NNN-kebab-name.sql` where NNN is a
 * zero-padded 3-digit ordinal. Lexicographic sort of the matching names
 * is identical to numeric sort for as long as we stay under 1000
 * migrations (Phase 3 plan §8.1 ships 7).
 */
const MIGRATION_FILE_RE = /^\d{3}-[a-z0-9-]+\.sql$/;

/**
 * Apply every `.sql` migration in `dir` that has not yet been recorded
 * in `schema_version`, in filename order. Each file runs inside a
 * transaction together with its `schema_version` insert, so a failed
 * migration leaves both the schema AND the version table untouched.
 *
 * @param db   An open `DatabaseHandle` (typically from `openDatabase`).
 * @param dir  Path to a directory containing migration files matching
 *             `NNN-kebab-name.sql`. Other entries are ignored. Caller
 *             owns the directory; the runner does NOT create it.
 *
 * @returns `{applied}` — filenames of migrations applied this call.
 *          Empty when nothing was new (T2c idempotency).
 */
export function runMigrations(db: DatabaseHandle, dir: string): MigrationRunResult {
  // Idempotent bootstrap so we can record what we apply.
  db.exec(SCHEMA_VERSION_DDL);

  const files = readdirSync(dir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort();

  const alreadyApplied = new Set(
    (
      db.prepare("SELECT version FROM schema_version").all() as {
        version: string;
      }[]
    ).map((row) => row.version),
  );

  const insertVersion = db.prepare(
    "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
  );

  // better-sqlite3 wraps the inner function in a SAVEPOINT, so SQL
  // failure inside `apply` rolls back BOTH the migration body AND the
  // schema_version insert atomically.
  const apply = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    insertVersion.run(file, Date.now());
  });

  const applied: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    apply(file, sql);
    applied.push(file);
  }

  return { applied };
}

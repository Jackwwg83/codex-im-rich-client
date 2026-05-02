// T2b + T2c + T3a (Phase 3) — runMigrations behavior + first real
// migration (001-init.sql owning schema_version).
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T2b/T2c/T3a
//
// T2b — first-run apply: a migrations dir containing one `001-*.sql`
//       file is applied on first run; both the migration's side-effect
//       (a `foo` table appears) AND the schema_version audit row are
//       visible after the call returns.
//
// T2c — idempotency: re-running runMigrations on the same dir applies
//       nothing AND does not re-execute the migration body. We prove
//       no re-execution by corrupting the migration file's contents
//       between runs; if the runner re-read it, the invalid SQL would
//       throw. We further assert applied_at invariance (no re-insert
//       into schema_version).
//
// T2c-extra (codex P2-1) — atomic rollback: a multi-statement migration
//       whose later statement fails must leave BOTH the partial schema
//       (intermediate CREATE TABLEs) AND the schema_version row rolled
//       back, per `runMigrations` JSDoc. Pins the SAVEPOINT contract.
//
// T3a — real `src/migrations/` directory: runMigrations against the
//       package's actual migrations dir applies `001-init.sql` and
//       records it in schema_version. Pins the runner ↔ on-disk
//       migration contract, and pins that 001-init.sql's column
//       shape stays byte-compatible with the runner's bootstrap DDL
//       (different statements with the same shape both succeed).
//
// Synthetic filenames in T2b/T2c match the production convention
// `NNN-kebab.sql` so the runner's filter regex is exercised. T3a
// uses the real on-disk migration so any drift between
// SCHEMA_VERSION_DDL (database.ts) and 001-init.sql breaks loudly.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/database.js";

describe("runMigrations first run (T2b)", () => {
  let migDir: string;

  beforeEach(() => {
    migDir = mkdtempSync(join(tmpdir(), "codex-im-migrations-t2b-"));
  });

  afterEach(() => {
    rmSync(migDir, { recursive: true, force: true });
  });

  it("applies a single migration and records it in schema_version", () => {
    writeFileSync(join(migDir, "001-init.sql"), "CREATE TABLE foo (id INTEGER PRIMARY KEY);");

    const db = openDatabase(":memory:");
    try {
      const result = runMigrations(db, migDir);

      expect(result.applied).toEqual(["001-init.sql"]);

      const fooTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
        .get();
      expect(fooTable).toEqual({ name: "foo" });

      const versionRows = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
      expect(versionRows).toEqual([{ version: "001-init.sql" }]);
    } finally {
      db.close();
    }
  });

  it("ignores files in the migrations dir that don't match NNN-kebab.sql", () => {
    // README.md, .DS_Store, or human notes should not be treated as
    // migrations. The filter regex enforces the prefix shape.
    writeFileSync(join(migDir, "README.md"), "# notes\n");
    writeFileSync(join(migDir, "scratch.sql"), "CREATE TABLE bad (x INT);");
    writeFileSync(join(migDir, "001-init.sql"), "CREATE TABLE foo (id INTEGER PRIMARY KEY);");

    const db = openDatabase(":memory:");
    try {
      const result = runMigrations(db, migDir);
      expect(result.applied).toEqual(["001-init.sql"]);

      const bad = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bad'")
        .get();
      expect(bad).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("applies multiple migrations in numeric (lexicographic) order", () => {
    writeFileSync(join(migDir, "002-add-bar.sql"), "CREATE TABLE bar (id INTEGER PRIMARY KEY);");
    writeFileSync(join(migDir, "001-init.sql"), "CREATE TABLE foo (id INTEGER PRIMARY KEY);");

    const db = openDatabase(":memory:");
    try {
      const result = runMigrations(db, migDir);
      expect(result.applied).toEqual(["001-init.sql", "002-add-bar.sql"]);

      const versions = db
        .prepare("SELECT version FROM schema_version ORDER BY applied_at, version")
        .all();
      expect(versions).toEqual([{ version: "001-init.sql" }, { version: "002-add-bar.sql" }]);
    } finally {
      db.close();
    }
  });
});

describe("runMigrations idempotency (T2c)", () => {
  let migDir: string;

  beforeEach(() => {
    migDir = mkdtempSync(join(tmpdir(), "codex-im-migrations-t2c-"));
  });

  afterEach(() => {
    rmSync(migDir, { recursive: true, force: true });
  });

  it("re-running applies nothing and does not re-execute the migration body", () => {
    const migPath = join(migDir, "001-init.sql");
    writeFileSync(migPath, "CREATE TABLE foo (id INTEGER PRIMARY KEY);");

    const db = openDatabase(":memory:");
    try {
      // First run: applies the migration, records it.
      const first = runMigrations(db, migDir);
      expect(first.applied).toEqual(["001-init.sql"]);

      const firstRow = db
        .prepare("SELECT version, applied_at FROM schema_version WHERE version = ?")
        .get("001-init.sql") as { version: string; applied_at: number };
      expect(firstRow.version).toBe("001-init.sql");

      // Corrupt the migration file. If the runner re-reads or re-executes
      // the body on the second call, SQLite will throw a syntax error and
      // the test fails. The pass condition is therefore proof that the
      // runner skipped the file purely on filename match against
      // schema_version — exactly the idempotency contract T2c demands.
      writeFileSync(migPath, "THIS IS NOT VALID SQL ;;;");

      // Second run: must be a no-op.
      const second = runMigrations(db, migDir);
      expect(second.applied).toEqual([]);

      // schema_version row count is unchanged AND applied_at was NOT
      // overwritten (no INSERT/UPDATE happened against the recorded row).
      const allRows = db
        .prepare("SELECT version, applied_at FROM schema_version ORDER BY version")
        .all();
      expect(allRows).toEqual([{ version: "001-init.sql", applied_at: firstRow.applied_at }]);

      // The first-run side-effect (the `foo` table) is still there.
      const fooTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
        .get();
      expect(fooTable).toEqual({ name: "foo" });
    } finally {
      db.close();
    }
  });

  it("rolls back the partial schema AND schema_version when a migration fails mid-body", () => {
    // Multi-statement migration: first CREATE succeeds, second CREATE
    // duplicates `foo` and throws. better-sqlite3 wraps the inner
    // function in a SAVEPOINT, so SQLite must roll back BOTH the
    // already-applied first statement AND the schema_version insert.
    // This pins the atomicity contract documented in runMigrations'
    // JSDoc — without it a future implementer could accidentally
    // remove the `db.transaction(...)` wrapper and silently break
    // crash-recovery.
    writeFileSync(
      join(migDir, "001-bad.sql"),
      `
        CREATE TABLE foo (id INTEGER PRIMARY KEY);
        CREATE TABLE foo (id INTEGER PRIMARY KEY); -- duplicate, throws
      `,
    );

    const db = openDatabase(":memory:");
    try {
      expect(() => runMigrations(db, migDir)).toThrow();

      // Neither table survives the rollback.
      const fooAfter = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foo'")
        .get();
      expect(fooAfter).toBeUndefined();

      // schema_version is still empty — no row got inserted for the
      // failed migration.
      const versionRows = db.prepare("SELECT version FROM schema_version").all();
      expect(versionRows).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("runMigrations against the real src/migrations/ directory (T3a)", () => {
  // Resolve the package's actual migrations dir relative to this
  // test file. Don't rely on cwd — vitest runs from the workspace
  // root, but the path math here would be wrong for any other cwd.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");
  const CURRENT_MIGRATIONS = ["001-init.sql", "002-thread-bindings.sql"];

  it("applies the current real migrations and records them in schema_version", () => {
    const db = openDatabase(":memory:");
    try {
      const before = Date.now();
      const result = runMigrations(db, REAL_MIGRATIONS_DIR);
      const after = Date.now();

      // Plan §16.2 T3a/T4a: the real migrations dir is append-only,
      // and every migration applied from it must be recorded.
      expect(result.applied).toEqual(CURRENT_MIGRATIONS);

      const rows = db
        .prepare("SELECT version, applied_at FROM schema_version ORDER BY version")
        .all() as { version: string; applied_at: number }[];
      expect(rows.map((row) => row.version)).toEqual(CURRENT_MIGRATIONS);

      // applied_at is Date.now() at apply time; sanity-check it sits
      // inside the test's wall-clock window so a future implementer
      // who switches to seconds-since-epoch would break this.
      for (const row of rows) {
        expect(row.applied_at).toBeGreaterThanOrEqual(before);
        expect(row.applied_at).toBeLessThanOrEqual(after);
      }

      // schema_version's column shape from 001-init.sql must match the
      // runner's bootstrap DDL (database.ts SCHEMA_VERSION_DDL). If
      // they drift, this assertion catches it.
      type ColInfo = {
        name: string;
        type: string;
        notnull: number;
        pk: number;
      };
      const cols = (db.prepare("PRAGMA table_info(schema_version)").all() as ColInfo[]).map(
        (c) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk }),
      );
      expect(cols).toEqual([
        { name: "version", type: "TEXT", notnull: 1, pk: 1 },
        { name: "applied_at", type: "INTEGER", notnull: 1, pk: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("is idempotent against the real migrations dir (re-run is a no-op)", () => {
    const db = openDatabase(":memory:");
    try {
      const first = runMigrations(db, REAL_MIGRATIONS_DIR);
      expect(first.applied).toEqual(CURRENT_MIGRATIONS);

      const second = runMigrations(db, REAL_MIGRATIONS_DIR);
      expect(second.applied).toEqual([]);

      // One audit row per migration, no duplicates.
      const count = db.prepare("SELECT COUNT(*) AS c FROM schema_version").get() as { c: number };
      expect(count.c).toBe(CURRENT_MIGRATIONS.length);
    } finally {
      db.close();
    }
  });
});

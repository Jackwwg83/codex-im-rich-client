// T2b + T2c (Phase 3) — runMigrations apply + idempotency + atomicity.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T2b/T2c
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
// T3a will replace the synthetic fixtures with the real `001-init.sql`
// once that migration ships. Synthetic filenames here match the
// production convention `NNN-kebab.sql` so the runner's filter regex
// is exercised.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

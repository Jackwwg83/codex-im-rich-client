// T2b (Phase 3) — first-run apply for runMigrations.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T2b
//
// One failing test target: a migrations dir containing one `001-*.sql`
// file is applied on first run; both the migration's side-effect (a
// `foo` table appears) AND the schema_version audit row are visible
// after the call returns.
//
// T2c will extend this file with an idempotency test (re-running
// applies nothing). T3a will replace the synthetic fixture with the
// real `001-init.sql` once that migration ships.
//
// Synthetic migration filenames here match the production convention
// `NNN-kebab.sql` so the runner's filter regex is exercised.

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

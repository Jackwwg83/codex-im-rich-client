-- 001-init.sql — Phase 3 T3a
-- Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T3a
--
-- Owns the schema_version audit table that runMigrations records each
-- applied migration into. The runner (database.ts SCHEMA_VERSION_DDL,
-- T2b) already bootstraps the same shape via CREATE TABLE IF NOT
-- EXISTS before walking the migrations directory; this file
-- redeclares the table idempotently so the migration history is
-- self-documenting and so a future implementer who drops the
-- runner's bootstrap (e.g. when migrating to a different runner)
-- still gets a working table on first run.
--
-- Column shape MUST stay byte-identical to SCHEMA_VERSION_DDL in
-- packages/storage-sqlite/src/database.ts. If you change one, change
-- the other in the same commit. The boundary test in
-- test/migrations.test.ts pins the runner-vs-file contract.
--
-- Boil-the-frog note: future migrations (002-thread-bindings, …,
-- 007-callback-tokens) write only their own schema; they do NOT
-- touch schema_version (the runner inserts the audit row).

CREATE TABLE IF NOT EXISTS schema_version (
  version    TEXT    PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);

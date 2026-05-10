VERDICT: APPROVE_WITH_CHANGES
SUMMARY: Scope is clean, but the D27 boundary tests need tightening before T3a.

PER-TASK SCOPE DISCIPLINE:
  T1.1: clean — skeleton commit kept `index.ts` empty (`export {};`) and only defined boundary comments/tests [3ada728:packages/storage-sqlite/src/index.ts:23].
  T2a:  clean — implementation is limited to `openDatabase`, WAL then FK pragmas, type export, and pragma/smoke tests [packages/storage-sqlite/src/database.ts:55].
  T2b:  clean — runner walks filtered files, sorts, applies, and records `schema_version`; no repositories or later schemas landed [packages/storage-sqlite/src/database.ts:117].
  T2c:  clean — one idempotency test only; no source change [packages/storage-sqlite/test/migrations.test.ts:111].

P0 (blocks T3a start):
  - none

P1 (required before T3a):
  - [packages/storage-sqlite/test/no-core-import.test.ts:10] D27 enforcement is too weak: this test explicitly allows `import type` from upper-layer packages and skips them at [packages/storage-sqlite/test/no-core-import.test.ts:63], even though storage’s own boundary says “NO upward import” for the full list [packages/storage-sqlite/src/index.ts:23] and T1.1 requires no core/codex-runtime/app-server imports [docs/superpowers/plans/2026-05-02-phase-3-plan.md:1939]. Also, both boundary tests only match lines starting with `import`, so `export ... from` and multiline imports can slip [packages/storage-sqlite/test/no-core-import.test.ts:61] [packages/storage-sqlite/test/no-protocol-import.test.ts:49]. Fix by using one forbidden-all predicate over import/export declarations for all 8 packages, with type-only imports forbidden.

P2 (nice-to-have):
  - [packages/storage-sqlite/test/migrations.test.ts:39] Add a rollback test for a multi-statement migration where statement 2 fails, because the source promises failed migrations leave both schema and `schema_version` untouched [packages/storage-sqlite/src/database.ts:103] [packages/storage-sqlite/src/database.ts:137].
  - [packages/storage-sqlite/src/database.ts:140] Document or reject transaction-control statements inside migration files; `runMigrations` wraps each body and then executes arbitrary SQL with `db.exec(sql)` [packages/storage-sqlite/src/database.ts:141].

NOTES:
  - Boundary-test fidelity vs channel-core reference: mechanically faithful, but storage’s boundary is stricter than channel-core’s F13 split; allowing type-only upper-layer imports is wrong for D27 [packages/channel-core/test/no-broker-import.test.ts:9] [packages/storage-sqlite/test/no-core-import.test.ts:10].
  - Forward-compat for T3a is acceptable if `001-init.sql` declares exactly the bootstrap shape: `version TEXT PRIMARY KEY NOT NULL`, `applied_at INTEGER NOT NULL` [packages/storage-sqlite/src/database.ts:88]. T6d is unaffected; runner only cares about filenames and migration SQL execution, not table shape [packages/storage-sqlite/src/database.ts:101] [docs/superpowers/plans/2026-05-02-phase-3-plan.md:1087].
  - T2c’s corrupt-file proof is scoped correctly to “does not re-execute the migration body,” not “no SQL at all” [packages/storage-sqlite/test/migrations.test.ts:111] [packages/storage-sqlite/test/migrations.test.ts:131].
  - Pace looks right: T2a/T2b added small extra tests, but they remain within the same behavior surface [packages/storage-sqlite/test/database.test.ts:31] [packages/storage-sqlite/test/migrations.test.ts:60].
  - T3a can begin after the D27 predicate is tightened.

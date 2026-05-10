# Codex outside-voice review — Phase 3 implementation T1.1 + T2a + T2b + T2c

You are the outside-voice reviewer for the FIRST batch of Phase 3
implementation commits on branch `phase-3-implementation`, head
`d891960`. This is the first time real code lands for Phase 3 — every
preceding commit was docs (planning).

## Project boundary (do not violate)

Codex App Server native IM Rich Client. Mac mini daemon controls
codex via Telegram (Phase 3) → Lark/DingTalk (Phase 4/5) → Computer
Use (Phase 6). Storage layer is **the lowest layer** in the stack
and MUST NOT import upward (D27 boundary).

## Phase 3 review trajectory

The plan itself went through 4 rounds of codex review + 2 rounds of
gstack `/plan-eng-review`, ending v2.4 at `4ec2c51` (live-status doc
declared "tag-complete + Phase 3 implementation gate"). Round 4 codex
verdict on v2.3 = APPROVE_WITH_CHANGES with 4 P1 + 2 P2; v2.4 absorbed
those. T1 unlock authorized.

This review is on IMPLEMENTATION, not the plan. Do NOT re-flag plan
findings; do flag any code that diverges from the v2.4 plan.

## Commits in scope (4)

```
d891960 test(storage-sqlite): T2c runMigrations idempotency
f6972de feat(storage-sqlite): T2b runMigrations + schema_version bootstrap
826fdfc feat(storage-sqlite): T2a openDatabase + WAL/foreign_keys pragmas
3ada728 feat(storage-sqlite): T1.1 package skeleton + boundary tests
```

The branch was rebased on top of `chore/codex-upgrade-0.128` (T0.7);
codex 0.128 is the pinned protocol version.

## Your job

Two-axis review. Be honest about both — don't soften either.

### 1. Plan adherence (per-task scope discipline)

For each of T1.1 / T2a / T2b / T2c, verify the commit's diff stays
within the plan §16.2 scope for that T-task and DOES NOT pre-implement
later tasks (T3a/T4a-c/T5a-b/T6a-c/T6d-f) or surface code that the
plan defers to a different package (`@codex-im/core`,
`@codex-im/codex-runtime`, etc.).

Specifically:

**T1.1 (commit `3ada728`)** — package skeleton + boundary tests only.
- `packages/storage-sqlite/package.json` — name, exports, deps placeholder.
- `packages/storage-sqlite/tsconfig.json` — composite project config.
- `packages/storage-sqlite/src/index.ts` — empty exports + boundary
  comment per plan §16.2 T1.1 boundary list (D27).
- `packages/storage-sqlite/test/no-core-import.test.ts` — boundary.
- `packages/storage-sqlite/test/no-protocol-import.test.ts` — boundary.
- `packages/storage-sqlite/test/skeleton.test.ts` — placeholder
  (deleted at T2a).

Did T1.1 leak any premature implementation (database.ts,
migrations.ts, repositories)? Did it copy the boundary-test pattern
faithfully from `packages/channel-core/test/no-broker-import.test.ts`
+ `no-protocol-import.test.ts` (the Phase 2 D14 reference)? Are the
SCANNED_DIRS / ALLOWED_FILES enums (or whatever the equivalent is)
actually correct for storage-sqlite?

**T2a (commit `826fdfc`)** — `openDatabase(path)` + WAL +
`foreign_keys = ON` + 1 failing test (plan said "one failing test
verifying the pragmas"; landed three: file-backed, `:memory:`,
prepared-statement smoke).

- Did `:memory:` test correctly document the WAL fall-back to
  `journal_mode = memory`? (SQLite refuses WAL for in-memory.)
- Is `Database.Database` type re-export the right surface (D39
  fallback path — single-edit swap for `node:sqlite`)?
- Is the order WAL-pragma → foreign_keys-pragma load-bearing?
- Was @types/better-sqlite3 added correctly (Phase 1 typecheck
  hygiene)?
- The pnpm `onlyBuiltDependencies` whitelist in root package.json
  was extended for `better-sqlite3` — is that the right scope, or
  should `kysely` be there too? (Kysely is pure-TS, no postinstall
  scripts, so probably no.)

**T2b (commit `f6972de`)** — migration runner.

- Plan §8.1 says `database.ts # openDatabase, migration runner,
  preflight (D39)`. Implementation puts both in `database.ts`. Good.
- Plan §16.2 T2b says "walks the migrations directory + applies +
  records in `schema_version` table. One test for first-run apply."
- Implementation:
  - `SCHEMA_VERSION_DDL` `CREATE TABLE IF NOT EXISTS` bootstrap.
  - File regex `/^\d{3}-[a-z0-9-]+\.sql$/`.
  - `db.transaction()` wraps migration body + schema_version insert.
  - Returns `{applied: string[]}`.
- Three first-run tests: single migration, filter regex, multi-file
  ordering.

Audit:
- Is the `SCHEMA_VERSION_DDL` bootstrap correct, or does it conflict
  with what T3a's `001-init.sql` will declare? (`CREATE TABLE IF NOT
  EXISTS` is idempotent so they can co-exist, but is the column
  schema (`version TEXT PRIMARY KEY NOT NULL`, `applied_at INTEGER
  NOT NULL`) the right shape for what T3a will need? §16.2 T3a says
  "test that runner records the new row" — implies just version +
  timestamp; should there be `applied_by`, `checksum`, `success`?)
- Does `db.transaction()` actually wrap `db.exec(sql)` + the
  `insertVersion.run` atomically? better-sqlite3 docs say SAVEPOINT;
  verify that a SQL error inside a multi-statement migration
  rolls back BOTH the partial schema AND the schema_version insert.
- Filename regex `/^\d{3}-[a-z0-9-]+\.sql$/`:
  - matches `001-init.sql`, `002-thread-bindings.sql`,
    `007-callback-tokens.sql` (plan §8.1's full list)?
  - rejects `001-INIT.sql` (uppercase), `1-init.sql` (no padding),
    `001_init.sql` (underscore), `001-init.sql.bak`?
  - any pathological case (Unicode dots, control chars)?
- `applied_at INTEGER NOT NULL` storing `Date.now()` ms-since-epoch:
  is INTEGER the right type vs `INTEGER NOT NULL DEFAULT (strftime
  ('%s', 'now'))` server-default? Code passes ms; T3a's `001-init.sql`
  must redeclare the same shape exactly.
- Does the runner handle **ordering** correctly — lexicographic =
  numeric only while N<1000 (plan §8.1 ships 7). Should there be a
  hard cap or sanity check?
- What if `dir` does not exist? `readdirSync` will throw ENOENT.
  Caller's responsibility; correct?
- Multi-statement migrations: `db.exec(sql)` runs all `;`-separated
  statements. Is that the documented contract or accidental?
- Race / concurrency: if two daemon processes call `runMigrations`
  on the same DB simultaneously — does `INSERT INTO schema_version`
  race? Probably moot under D38 sync write-through (single daemon)
  but worth noting.

**T2c (commit `d891960`)** — idempotency test only, no source change.

- "Re-running applies nothing, asserts no SQL execution. One test."
- Implementation: ONE test that runs migrations twice. Between the
  two calls, the test corrupts the migration file's contents to
  invalid SQL ("THIS IS NOT VALID SQL ;;;"). If the runner re-read or
  re-executed, SQLite would throw and the test would fail. Test
  passing = proof of skip.
- Plus assertions: `applied_at` byte-identical (no UPDATE),
  side-effect table still present.

Audit:
- Is the corrupt-file trick airtight, or could SQLite somehow
  ignore the bad bytes and pass? Specifically: would the SQL parser
  accept `THIS IS NOT VALID SQL ;;;` as a no-op (e.g., as nonsense
  identifiers) on some SQLite version?
- Are the assertions sufficient? Specifically: "no SQL execution"
  is not exactly proven — `db.prepare("SELECT version FROM
  schema_version").all()` and the bootstrap `db.exec(SCHEMA_VERSION_DDL)`
  DO execute SQL. The test only proves no MIGRATION BODY re-runs.
  Should the test description / comment be tightened so a future
  reader doesn't misinterpret the contract?
- Plan said "one test"; landed one test. Scope clean. ✓

### 2. Boundary integrity (D27)

The package's stated boundary in `src/index.ts` says NO upward import
of `@codex-im/core`, `@codex-im/codex-runtime`,
`@codex-im/app-server-client`, `@codex-im/channel-core`,
`@codex-im/protocol`, `@codex-im/render`, `@codex-im/daemon`,
`@codex-im/im-telegram`.

- Read `packages/storage-sqlite/test/no-core-import.test.ts` and
  `no-protocol-import.test.ts`. Do they actually walk the source
  tree and assert the import predicate, or are they stub
  placeholders?
- Are the import predicates strong enough — string-match `from
  "@codex-im/core"` vs regex over multiple package names? Could
  `import type` slip through (it shouldn't since Phase 2 D14 was
  explicit that storage is below core; verify)?
- Does the boundary list cover all 8 packages, or only 2?

### 3. Code-quality signals

- Comments: Phase 1/2 style is heavy block comments at file top
  with plan refs + decision IDs (D-numbers) + redlines. Did T2a/T2b
  match? Any drift?
- Naming: any hungarian / unclear identifier names?
- Dead code / unused exports: anything left over from skeleton?
- TypeScript hygiene: `any` casts (one `as { version: string }[]`
  in runMigrations — necessary or could be tighter)? Implicit
  `any` from better-sqlite3?
- Test ergonomics: do `mkdtempSync` + `rmSync` cleanup leak temp
  dirs on test failure? Did the cleanup pattern match Phase 1/2's
  approach (`afterEach` + `rmSync recursive force`)?

### 4. Forward-compatibility into T3a-T6f

- When T3a lands `001-init.sql` containing `CREATE TABLE IF NOT
  EXISTS schema_version (...)` with the same shape, will it cleanly
  apply on top of the runner's bootstrap? Verify the column types
  match exactly (TEXT/INTEGER/PRIMARY KEY/NOT NULL).
- When T6d lands `007-callback-tokens.sql` with the D34 hash-only
  shape (4 explicit Target columns: target_platform, target_chat_id,
  target_thread_key, target_topic_id), does the runner have any
  hidden assumption about column count or DDL structure?
- The transaction wrapping: a future migration that uses BEGIN /
  COMMIT inside its body would conflict with the implicit SAVEPOINT.
  Should the runner document or reject migrations that contain
  BEGIN/COMMIT/SAVEPOINT keywords?

### 5. Project redlines (verify still hold)

- ❌ No raw `AppServerClient.request("...")` (storage doesn't import
  the client; trivially holds).
- ❌ No method literals (storage doesn't deal with codex protocol;
  trivially holds, but verify storage didn't quote any by mistake).
- ❌ No tokens / secrets in code or tests (none here; verify).
- ❌ No public TCP listener (none here).
- ❌ No Computer Use code (none here).
- ❌ No Lark/DingTalk code (none here).
- D38 sync write-through: better-sqlite3 is sync-by-design.
  `runMigrations` is sync. ✓

## Files to read

Implementation:
- `packages/storage-sqlite/package.json`
- `packages/storage-sqlite/tsconfig.json`
- `packages/storage-sqlite/src/index.ts`
- `packages/storage-sqlite/src/database.ts`
- `packages/storage-sqlite/test/database.test.ts`
- `packages/storage-sqlite/test/migrations.test.ts`
- `packages/storage-sqlite/test/no-core-import.test.ts`
- `packages/storage-sqlite/test/no-protocol-import.test.ts`
- root `package.json` (pnpm.onlyBuiltDependencies whitelist)

Plan-of-record:
- `docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md`
  - §8.1 (storage-sqlite directory layout)
  - §16.2 T1.1 / T2a / T2b / T2c / T3a-T6f
  - §7 D27 boundary
  - §7 D38 sync write-through
  - §7 D39 preflight required
  - §9 callback_tokens schema (forward-looking; T6d)

Reference (for boundary-test pattern parity):
- `packages/channel-core/test/no-broker-import.test.ts`
- `packages/channel-core/test/no-protocol-import.test.ts`

Project context:
- `CLAUDE.md`

## Output format (strict)

```
VERDICT: APPROVE | APPROVE_WITH_CHANGES | REJECT
SUMMARY: <one sentence>

PER-TASK SCOPE DISCIPLINE:
  T1.1: clean | leak — <evidence>
  T2a:  clean | leak — <evidence>
  T2b:  clean | leak — <evidence>
  T2c:  clean | leak — <evidence>

P0 (blocks T3a start):
  - [file:line] <issue> — <why P0> — <suggested fix>
  (or "none")

P1 (required before T3a):
  - [file:line] <issue> — <why P1> — <suggested fix>
  (or "none")

P2 (nice-to-have):
  - [file:line] <issue> — <suggested fix>
  (or "none")

NOTES:
  - Boundary-test fidelity vs channel-core reference.
  - Forward-compat for T3a / T6d schema shape.
  - Any signals that implementation pace is too fast / too slow.
  - Whether T3a can begin after this review's required changes.
```

Read on disk; cite file paths + line numbers. No prose claims
without line citations.

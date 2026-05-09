# IM Project And Conversation Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align IM project/conversation entry with Codex App Server native `thread/start`, `thread/list`, and `thread/resume` semantics.

**Architecture:** Treat conversation as the first-class App Server thread and project as an optional bridge-local selector for a known `cwd`. IM never accepts raw paths and never creates projects. If no project is selected, create conversations with `thread/start({})` and persist the returned effective cwd.

**Tech Stack:** TypeScript, Node.js 24, pnpm workspace, SQLite migrations, better-sqlite3, Vitest.

---

## Source Of Truth

- Design: `docs/superpowers/specs/2026-05-09-im-project-conversation-entry-design.md`
- Protocol facts:
  - `packages/codex-protocol/src/generated/v2/ThreadStartParams.ts`
  - `packages/codex-protocol/src/generated/v2/ThreadStartResponse.ts`
  - `packages/codex-protocol/src/generated/v2/Thread.ts`
  - `packages/codex-protocol/src/generated/v2/ThreadListParams.ts`
- User docs to update after behavior lands:
  - `docs/user/commands.md`
  - `docs/user/quickstart.md`
  - `docs/setup/getting-started.md`

## File Structure

- `packages/storage-sqlite/src/migrations/009-im-context-kind.sql`
  - Rebuild `thread_bindings` and `thread_sessions` so `project_id` can be nullable and context metadata is explicit.
- `packages/storage-sqlite/src/bindings.ts`
  - Add `BindingContextKind`, nullable `projectId`, and `projectLabel`.
- `packages/storage-sqlite/src/thread-sessions.ts`
  - Carry the same context metadata and saved effective `cwd` for conversation
    history and `/switch`.
- `packages/storage-sqlite/test/bindings.test.ts`
  - Pin default-context and configured-project binding persistence.
- `packages/storage-sqlite/test/thread-sessions.test.ts`
  - Pin default-context sessions and native-thread switch persistence.
- `packages/core/src/session-router.ts`
  - Allow bound routes without configured `projectId`.
- `packages/daemon/src/daemon.ts`
  - Implement default conversation creation, selected-project conversation creation, and safe project discovery output.
- `packages/daemon/test/daemon.test.ts`
  - Pin command behavior for plain text and `/new`.
- `packages/daemon/test/turn-output.test.ts`
  - Keep output wording path-free.
- `docs/handoffs/direct-use-live-status.md`
  - Record current semantics and gate evidence.

## Task 1: Storage Context Migration

**Files:**
- Create: `packages/storage-sqlite/src/migrations/009-im-context-kind.sql`
- Modify: `packages/storage-sqlite/src/bindings.ts`
- Modify: `packages/storage-sqlite/src/thread-sessions.ts`
- Test: `packages/storage-sqlite/test/bindings.test.ts`
- Test: `packages/storage-sqlite/test/thread-sessions.test.ts`

- [x] **Step 1: Write failing binding tests**

Add tests that call `BindingRepository.upsert()` with no `projectId`:

```ts
expect(
  repo.upsert({
    target,
    contextKind: "app_default",
    projectLabel: "Codex default",
    codexThreadId: "thread-default",
    cwd: "/Users/jackwu/projects/codex-im-rich-client",
    now,
  }),
).toMatchObject({
  projectId: undefined,
  contextKind: "app_default",
  projectLabel: "Codex default",
});
```

Also assert the existing `projectId: "codex-im"` path hydrates as:

```ts
contextKind: "configured_project",
projectLabel: "codex-im"
```

- [x] **Step 2: Write failing thread session tests**

Add tests that call `ThreadSessionRepository.upsert()` and `switchCurrent()` with:

```ts
contextKind: "app_default",
projectLabel: "Codex default",
projectId: undefined,
```

Assert the current binding row also has nullable `projectId`, `contextKind`, and `projectLabel`.

- [x] **Step 3: Run storage tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/storage-sqlite/test/bindings.test.ts packages/storage-sqlite/test/thread-sessions.test.ts
```

Expected: TypeScript or assertion failures showing the context fields and nullable `projectId` are not implemented yet.

- [x] **Step 4: Implement migration and repositories**

Add `009-im-context-kind.sql` with table rebuilds. The migration must not contain explicit transaction statements because `runMigrations()` wraps migrations in `db.transaction()`.

Add this context kind to both repositories:

```ts
export type ImConversationContextKind =
  | "configured_project"
  | "codex_project"
  | "app_default"
  | "native_thread";
```

Normalize configured rows to `configured_project`; normalize no-project rows to `app_default` unless the caller explicitly supplies `native_thread`.

- [x] **Step 5: Run storage tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit packages/storage-sqlite/test/bindings.test.ts packages/storage-sqlite/test/thread-sessions.test.ts
```

Expected: storage tests pass.

## Task 2: Default Conversation Creation

**Files:**
- Modify: `packages/core/src/session-router.ts`
- Modify: `packages/daemon/src/daemon.ts`
- Test: `packages/daemon/test/daemon.test.ts`

- [x] **Step 1: Write failing daemon tests**

Add three tests:

1. Plain text with no binding calls `threadStart({})`, then `turnStart({ threadId, input })`, and stores `contextKind: "app_default"`.
2. `/new fix tests` with no selected project calls `threadStart({})` and stores the returned cwd.
3. Plain text with selected project but no thread calls `threadStart({ cwd })`, then `turnStart({ threadId, input })` without repeating `cwd`.

- [x] **Step 2: Run daemon tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/daemon/test/daemon.test.ts
```

Expected: current code still asks for `/projects` or passes `cwd` into `turnStart`.

- [x] **Step 3: Implement default-context runtime flow**

Update prompt and `/new` routing:

- no binding: `runtime.threadStart({})`;
- selected configured project: `runtime.threadStart({ cwd, model? })`;
- turn start after a new thread: `runtime.turnStart({ threadId, input })`;
- persist returned cwd from `ThreadStartResponse`;
- show `project: Codex default` in normal status output.

- [x] **Step 4: Run daemon tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit packages/daemon/test/daemon.test.ts
```

Expected: daemon tests pass.

## Task 3: Project Discovery And Safe Output

**Files:**
- Modify: `packages/daemon/src/daemon.ts`
- Test: `packages/daemon/test/daemon.test.ts`
- Test: `packages/daemon/test/turn-output.test.ts`

- [x] **Step 1: Write failing tests for `/projects`**

Pin these behaviors:

- configured project entries appear even when App Server has no history;
- discovered cwd groups are hidden or non-selectable unless matching config allows them;
- `/projects`, `/status`, `/whoami`, and `/threads` do not print absolute cwd;
- `/cwds` produces the same safe project list unless diagnostics explicitly asks for redacted cwd.

- [x] **Step 2: Run targeted tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/daemon/test/daemon.test.ts packages/daemon/test/turn-output.test.ts
```

- [x] **Step 3: Implement resolver and output wording**

Add a private resolver in `daemon.ts` unless the code naturally warrants a new daemon-local module. It should merge configured projects with App Server thread history, but only configured entries are selectable by `/use` by default.

- [x] **Step 4: Run targeted tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit packages/daemon/test/daemon.test.ts packages/daemon/test/turn-output.test.ts
```

## Task 4: Docs And Acceptance Evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/user/commands.md`
- Modify: `docs/user/quickstart.md`
- Modify: `docs/setup/getting-started.md`
- Modify: `docs/handoffs/direct-use-live-status.md`

- [x] **Step 1: Update user docs**

Use user-facing terms:

- `project` for optional context;
- `conversation` for App Server thread;
- `Codex default` for no selected project;
- no raw cwd in user-facing first-run text.

- [x] **Step 2: Update operator docs**

Explain that `cwd` is the implementation primitive and only appears in diagnostics/admin docs.

- [x] **Step 3: Run full verification**

Run sequentially:

```bash
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm lint
pnpm protocol:check
```

Expected: all pass.

Actual 2026-05-09 verification:

- `pnpm lint` - passed, 371 files checked, no fixes applied.
- `pnpm typecheck` - passed.
- `pnpm typecheck:tests` - passed.
- `pnpm test` - passed, 163 files, 1530 pass, 1 skip.
- `pnpm protocol:check` - passed, Codex 0.128.0, 234 schema files canonical.
- `git diff --check` - passed.

## Implementation Notes

- `thread_sessions` now persists `cwd` for newly created App Server default
  conversations and native-thread switch records. Existing historical rows may
  have `cwd = NULL`; `/switch` fails closed with an operator-friendly message
  for those rows instead of inventing a cwd or project alias.
- Stored native/default conversations can be resumed from local
  `thread_sessions` fallback without a configured project when their saved
  `cwd` is present. The resume call remains thread-first; the saved `cwd`
  is used only for current binding/cache continuity and future `/new` transient
  context.

## Self-Review

- Spec coverage: Storage nullable project context is Task 1; default thread start is Task 2; safe project discovery is Task 3; user/operator docs are Task 4.
- Placeholder scan: The plan uses concrete files, commands, expected outcomes, and code snippets. No open-ended placeholders remain.
- Type consistency: Storage context fields are named `contextKind`, `projectId`, and `projectLabel` across bindings, sessions, daemon tests, and docs.

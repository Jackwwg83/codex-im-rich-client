// Direct Use Completion / Phase 8 B2 — thread_sessions repository.
//
// This stores known real Codex App threads for an IM target. It is not
// an IM-native task list; codex_thread_id is the durable identity and
// thread_bindings remains the current pointer.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ThreadSessionRepository, openDatabase, runMigrations } from "../src/index.js";

describe("ThreadSessionRepository (Direct Use B2)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");

  it("upserts a known Codex thread and finds it by target + thread id", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456", topicId: "42" };
      const saved = repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        title: "Release hardening",
        now: "2026-05-03T10:00:00.000Z",
      });

      expect(saved).toMatchObject({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        title: "Release hardening",
        status: "open",
        createdAt: "2026-05-03T10:00:00.000Z",
        updatedAt: "2026-05-03T10:00:00.000Z",
        lastUsedAt: "2026-05-03T10:00:00.000Z",
      });
      expect(saved.id).toMatch(/^ts_/);
      expect(repo.findByTargetAndThread(target, "thread_123")).toEqual(saved);
    } finally {
      db.close();
    }
  });

  it("keeps one row per IM target and Codex thread while preserving title by default", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456" };
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        title: "Original title",
        now: "2026-05-03T10:00:00.000Z",
      });
      repo.upsert({
        target,
        projectId: "project-web-renamed",
        codexThreadId: "thread_123",
        now: "2026-05-03T10:05:00.000Z",
      });

      expect(repo.listForTarget(target, { includeArchived: true })).toEqual([
        expect.objectContaining({
          projectId: "project-web-renamed",
          codexThreadId: "thread_123",
          title: "Original title",
          createdAt: "2026-05-03T10:00:00.000Z",
          updatedAt: "2026-05-03T10:05:00.000Z",
          lastUsedAt: "2026-05-03T10:05:00.000Z",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  it("lists target threads by project and last-used time while hiding archived rows", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456" };
      const otherTarget = { platform: "telegram", chatId: "-100999999" };
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_old",
        title: "Old",
        now: "2026-05-03T10:00:00.000Z",
      });
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_new",
        title: "New",
        now: "2026-05-03T10:10:00.000Z",
      });
      repo.upsert({
        target,
        projectId: "project-api",
        codexThreadId: "thread_api",
        now: "2026-05-03T10:20:00.000Z",
      });
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_archived",
        status: "archived",
        now: "2026-05-03T10:30:00.000Z",
      });
      repo.upsert({
        target: otherTarget,
        projectId: "project-web",
        codexThreadId: "thread_other",
        now: "2026-05-03T10:40:00.000Z",
      });

      expect(repo.listForTarget(target, { projectId: "project-web" })).toMatchObject([
        { codexThreadId: "thread_new" },
        { codexThreadId: "thread_old" },
      ]);
      expect(repo.listForTarget(target, { includeArchived: true, limit: 2 })).toMatchObject([
        { codexThreadId: "thread_archived" },
        { codexThreadId: "thread_api" },
      ]);
    } finally {
      db.close();
    }
  });

  it("touches last_used_at without changing the local title", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456" };
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        title: "Keep me",
        now: "2026-05-03T10:00:00.000Z",
      });

      expect(repo.touch(target, "thread_123", "2026-05-03T11:00:00.000Z")).toMatchObject({
        title: "Keep me",
        updatedAt: "2026-05-03T11:00:00.000Z",
        lastUsedAt: "2026-05-03T11:00:00.000Z",
      });
      expect(repo.touch(target, "missing", "2026-05-03T11:05:00.000Z")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("renames local display metadata without replacing Codex thread identity", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456" };
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        now: "2026-05-03T10:00:00.000Z",
      });

      expect(
        repo.rename(target, "thread_123", "Release thread", "2026-05-03T11:00:00.000Z"),
      ).toMatchObject({
        codexThreadId: "thread_123",
        title: "Release thread",
        updatedAt: "2026-05-03T11:00:00.000Z",
        lastUsedAt: "2026-05-03T10:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  it("surfaces SQLite write failure without creating optimistic repository state", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);
      db.exec(`
        CREATE TRIGGER fail_thread_session_insert
        BEFORE INSERT ON thread_sessions
        BEGIN
          SELECT RAISE(ABORT, 'simulated thread_sessions write failure');
        END;
      `);

      const repo = new ThreadSessionRepository(db);
      const target = { platform: "telegram", chatId: "-100123456" };

      expect(() =>
        repo.upsert({
          target,
          projectId: "project-web",
          codexThreadId: "thread_123",
          now: "2026-05-03T10:00:00.000Z",
        }),
      ).toThrow(/simulated thread_sessions write failure/);

      expect(repo.findByTargetAndThread(target, "thread_123")).toBeUndefined();
      expect(repo.listForTarget(target)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

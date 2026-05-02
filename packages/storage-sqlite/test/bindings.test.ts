// T4a (Phase 3) — thread_bindings migration + BindingRepository.upsert.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T4a
// Linear: JAC-14
//
// Single TDD target: upsert a chat -> project -> Codex thread binding
// and find it back by the same opaque IM target. Storage is the lowest
// layer (D27), so the Target shape is redeclared locally in
// storage-sqlite; no core/protocol/channel imports are allowed.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BindingRepository, openDatabase, runMigrations } from "../src/index.js";

describe("BindingRepository (T4a)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");

  it("upserts a binding and finds it by target", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new BindingRepository(db);
      const target = {
        platform: "telegram",
        chatId: "-100123456",
        topicId: "42",
      };

      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        cwd: "/tmp/codex-im/project-web",
        defaultModel: "gpt-5.5",
        activeTurnId: "turn_abc",
        now: "2026-05-02T14:00:00.000Z",
      });

      const found = repo.findByTarget(target);
      expect(found).toMatchObject({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        cwd: "/tmp/codex-im/project-web",
        defaultModel: "gpt-5.5",
        activeTurnId: "turn_abc",
        createdAt: "2026-05-02T14:00:00.000Z",
        updatedAt: "2026-05-02T14:00:00.000Z",
      });
      expect(found?.id).toMatch(/^tb_/);
    } finally {
      db.close();
    }
  });

  it("lists bindings in insertion order", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new BindingRepository(db);
      repo.upsert({
        target: { platform: "telegram", chatId: "-100123456" },
        projectId: "project-web",
        codexThreadId: "thread_web",
        cwd: "/tmp/codex-im/project-web",
        now: "2026-05-02T14:01:00.000Z",
      });
      repo.upsert({
        target: { platform: "telegram", chatId: "-100654321", topicId: "7" },
        projectId: "project-api",
        codexThreadId: "thread_api",
        cwd: "/tmp/codex-im/project-api",
        now: "2026-05-02T14:02:00.000Z",
      });

      expect(
        repo.list().map((binding) => ({
          target: binding.target,
          projectId: binding.projectId,
          codexThreadId: binding.codexThreadId,
          cwd: binding.cwd,
        })),
      ).toEqual([
        {
          target: { platform: "telegram", chatId: "-100123456" },
          projectId: "project-web",
          codexThreadId: "thread_web",
          cwd: "/tmp/codex-im/project-web",
        },
        {
          target: { platform: "telegram", chatId: "-100654321", topicId: "7" },
          projectId: "project-api",
          codexThreadId: "thread_api",
          cwd: "/tmp/codex-im/project-api",
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("deletes a binding by target", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new BindingRepository(db);
      const target = { platform: "telegram", chatId: "-100123456", topicId: "42" };
      repo.upsert({
        target,
        projectId: "project-web",
        codexThreadId: "thread_123",
        cwd: "/tmp/codex-im/project-web",
        now: "2026-05-02T14:03:00.000Z",
      });

      expect(repo.delete(target)).toBe(true);
      expect(repo.findByTarget(target)).toBeUndefined();
      expect(repo.delete(target)).toBe(false);
    } finally {
      db.close();
    }
  });
});

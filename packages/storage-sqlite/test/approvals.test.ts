// T5a (Phase 3) — approvals migration + ApprovalRepository upsert/read.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T5a
// Linear: JAC-32
//
// Storage remains below core/protocol (D27): approval kind, status,
// decision, target, and raw JSON are opaque storage fields. Redaction is
// intentionally not asserted here; T5b owns that failure mode.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApprovalRepository, openDatabase, runMigrations } from "../src/index.js";

describe("ApprovalRepository (T5a)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");

  it("upserts an approval and reads it by id", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new ApprovalRepository(db);
      repo.upsert({
        id: "approval-123",
        appServerRequestId: 123,
        kind: "command_execution",
        status: "pending",
        target: {
          platform: "telegram",
          chatId: "-100123456",
          topicId: "42",
        },
        codexThreadId: "thread_123",
        codexTurnId: "turn_abc",
        title: "Run command",
        body: "pnpm test",
        riskLevel: "medium",
        requestedByUserId: "telegram:123",
        expiresAt: "2026-05-02T14:45:00.000Z",
        createdAt: "2026-05-02T14:15:00.000Z",
        updatedAt: "2026-05-02T14:15:00.000Z",
        rawJson: '{"kind":"fixture"}',
      });

      expect(repo.findById("approval-123")).toEqual({
        id: "approval-123",
        appServerRequestId: "123",
        kind: "command_execution",
        status: "pending",
        target: {
          platform: "telegram",
          chatId: "-100123456",
          topicId: "42",
        },
        codexThreadId: "thread_123",
        codexTurnId: "turn_abc",
        title: "Run command",
        body: "pnpm test",
        riskLevel: "medium",
        requestedByUserId: "telegram:123",
        expiresAt: "2026-05-02T14:45:00.000Z",
        createdAt: "2026-05-02T14:15:00.000Z",
        updatedAt: "2026-05-02T14:15:00.000Z",
        rawJson: '{"kind":"fixture"}',
      });
    } finally {
      db.close();
    }
  });
});

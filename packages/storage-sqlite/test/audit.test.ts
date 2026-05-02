import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuditRepository, openDatabase, runMigrations } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");

describe("AuditRepository (T6a)", () => {
  it("inserts and reads an audit_log record", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new AuditRepository(db);
      const inserted = repo.insert({
        id: "audit-1",
        actorUserId: "operator-1",
        action: "approval.created",
        targetKey: "telegram:-100123456",
        projectId: "project-1",
        codexThreadId: "thread-1",
        codexTurnId: "turn-1",
        approvalId: "approval-1",
        result: "pending",
        metadataJson: JSON.stringify({ source: "unit-test" }),
        createdAt: "2026-05-02T14:30:00.000Z",
      });

      expect(inserted).toEqual({
        id: "audit-1",
        actorUserId: "operator-1",
        action: "approval.created",
        targetKey: "telegram:-100123456",
        projectId: "project-1",
        codexThreadId: "thread-1",
        codexTurnId: "turn-1",
        approvalId: "approval-1",
        result: "pending",
        metadataJson: '{"source":"unit-test"}',
        createdAt: "2026-05-02T14:30:00.000Z",
      });
      expect(repo.findById("audit-1")).toEqual(inserted);
    } finally {
      db.close();
    }
  });
});

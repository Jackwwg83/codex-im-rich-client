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

  it("stores and reads redacted audit text through an injected redactor", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const fakeSensitiveValue = "FAKE_AUDIT_SECRET_FOR_STORAGE_REDACTION_TEST";
      const repo = new AuditRepository(db, {
        redact: (text) => text.replaceAll(fakeSensitiveValue, "***REDACTED:audit-secret***"),
      });

      repo.insert({
        id: "audit-redact",
        actorUserId: `user-${fakeSensitiveValue}`,
        action: "approval.created",
        targetKey: `telegram:${fakeSensitiveValue}`,
        approvalId: `approval-${fakeSensitiveValue}`,
        result: "pending",
        metadataJson: JSON.stringify({ token: fakeSensitiveValue }),
        createdAt: "2026-05-02T14:45:00.000Z",
      });

      const stored = db
        .prepare(
          "SELECT actor_user_id, target_key, approval_id, metadata_json FROM audit_log WHERE id = ?",
        )
        .get("audit-redact") as {
        actor_user_id: string;
        target_key: string;
        approval_id: string;
        metadata_json: string;
      };

      expect(stored.actor_user_id).not.toContain(fakeSensitiveValue);
      expect(stored.target_key).not.toContain(fakeSensitiveValue);
      expect(stored.approval_id).not.toContain(fakeSensitiveValue);
      expect(stored.metadata_json).not.toContain(fakeSensitiveValue);
      expect(repo.findById("audit-redact")).toMatchObject({
        actorUserId: "user-***REDACTED:audit-secret***",
        targetKey: "telegram:***REDACTED:audit-secret***",
        approvalId: "approval-***REDACTED:audit-secret***",
        metadataJson: '{"token":"***REDACTED:audit-secret***"}',
      });
    } finally {
      db.close();
    }
  });

  it("rate-limits SQLite failure markers and aggregates dropped audit writes", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);
      db.exec(`
        CREATE TRIGGER audit_log_insert_failure
        BEFORE INSERT ON audit_log
        BEGIN
          SELECT RAISE(FAIL, 'audit sink unavailable');
        END;
      `);

      const markers: Array<{ action: string; result?: string; metadataJson?: string }> = [];
      const repo = new AuditRepository(db, {
        nowMs: () => Date.parse("2026-05-02T15:00:00.000Z"),
        onUnavailable: (marker) => markers.push(marker),
      });

      const first = repo.insertBestEffort({
        id: "audit-fail-1",
        action: "approval.created",
        approvalId: "approval-1",
        createdAt: "2026-05-02T15:00:00.000Z",
      });
      const second = repo.insertBestEffort({
        id: "audit-fail-2",
        action: "approval.resolved",
        approvalId: "approval-2",
        createdAt: "2026-05-02T15:00:01.000Z",
      });

      expect(first).toMatchObject({ ok: false, droppedCount: 1, markerEmitted: true });
      expect(second).toMatchObject({ ok: false, droppedCount: 2, markerEmitted: false });
      expect(repo.droppedCount()).toBe(2);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({
        action: "audit.sqlite_unavailable",
        result: "failed",
      });
      expect(markers[0]?.metadataJson).toContain("audit sink unavailable");

      const persisted = db.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
        count: number;
      };
      expect(persisted.count).toBe(0);
    } finally {
      db.close();
    }
  });
});

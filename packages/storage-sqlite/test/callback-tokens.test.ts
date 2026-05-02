import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CallbackTokenRepository,
  hashCallbackToken,
  openDatabase,
  runMigrations,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");

describe("CallbackTokenRepository (T6d)", () => {
  it("round-trips insert, guarded status updates, hash lookup, and expired-token prune", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const tokenHash = "0123456789abcdef0123456789abcdef";
      const inserted = repo.insert({
        tokenHash,
        approvalId: "approval-1",
        action: "allow_once",
        callbackNonce: "nonce-1",
        target: { platform: "telegram", chatId: "-100123456", topicId: "99" },
        actor: { kind: "im" },
        createdAt: "2026-05-02T15:30:00.000Z",
        expiresAt: "2026-05-02T16:00:00.000Z",
      });

      expect(inserted).toMatchObject({
        tokenHash,
        approvalId: "approval-1",
        action: "allow_once",
        callbackNonce: "nonce-1",
        target: { platform: "telegram", chatId: "-100123456", topicId: "99" },
        actor: { kind: "im" },
        status: "issued",
      });
      expect(repo.findByHash(tokenHash)).toEqual(inserted);

      const bound = repo.casUpdate(tokenHash, "issued", "bound", {
        messageRef: { chatId: "-100123456", messageId: "777" },
      });
      expect(bound).toMatchObject({
        status: "bound",
        messageRef: { chatId: "-100123456", messageId: "777" },
      });
      expect(repo.casUpdate(tokenHash, "issued", "used")).toBeUndefined();

      const used = repo.casUpdate(tokenHash, "bound", "used", {
        actor: { kind: "im", userId: "telegram-user-1", platform: "telegram" },
      });
      expect(used).toMatchObject({
        status: "used",
        actor: { kind: "im", userId: "telegram-user-1", platform: "telegram" },
      });

      const expiringHash = "fedcba9876543210fedcba9876543210";
      repo.insert({
        tokenHash: expiringHash,
        approvalId: "approval-expiring",
        action: "decline",
        callbackNonce: "nonce-expiring",
        target: { platform: "telegram", chatId: "-100999999" },
        actor: { kind: "im" },
        createdAt: "2026-05-02T15:00:00.000Z",
        expiresAt: "2026-05-02T15:10:00.000Z",
      });
      repo.casUpdate(expiringHash, "issued", "bound");

      expect(repo.pruneExpired("2026-05-02T15:10:01.000Z")).toEqual([
        expect.objectContaining({ tokenHash: expiringHash, status: "expired" }),
      ]);
      expect(repo.findByHash(expiringHash)).toMatchObject({ status: "expired" });
    } finally {
      db.close();
    }
  });

  it("persists only the callback token hash, never the raw token bytes", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const rawToken = "synthetic-callback-token-never-persist";
      const tokenHash = hashCallbackToken(rawToken);
      const repo = new CallbackTokenRepository(db);

      repo.insert({
        tokenHash,
        approvalId: "approval-hash-only",
        action: "allow_session",
        callbackNonce: "nonce-hash-only",
        target: { platform: "telegram", chatId: "-100123456" },
        actor: { kind: "im" },
        createdAt: "2026-05-02T16:10:00.000Z",
        expiresAt: "2026-05-02T16:40:00.000Z",
      });

      const row = db.prepare("SELECT * FROM callback_tokens WHERE token_hash = ?").get(tokenHash) as
        | Record<string, unknown>
        | undefined;

      expect(row).toBeDefined();
      expect(row?.token_hash).toBe(tokenHash);
      expect(tokenHash).not.toContain(rawToken);
      for (const value of Object.values(row ?? {})) {
        if (value !== null && value !== undefined) {
          expect(String(value)).not.toContain(rawToken);
        }
      }
    } finally {
      db.close();
    }
  });
});

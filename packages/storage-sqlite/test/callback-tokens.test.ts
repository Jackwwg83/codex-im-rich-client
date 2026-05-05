import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CallbackTokenAction,
  CallbackTokenRepository,
  hashCallbackToken,
  openDatabase,
  runMigrations,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(HERE, "../src/migrations");
const CALLBACK_ACTIONS = [
  "allow_once",
  "allow_session",
  "decline",
  "abort",
] as const satisfies readonly CallbackTokenAction[];

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

  it("looks up a single bound token by messageRef and action for template-only callbacks", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const allowHash = hashCallbackToken("template-allow-token");
      const declineHash = hashCallbackToken("template-decline-token");
      for (const [tokenHash, action] of [
        [allowHash, "allow_once"],
        [declineHash, "decline"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId: "approval-template",
          action,
          callbackNonce: `nonce-${action}`,
          target: { platform: "dingtalk", chatId: "staff-1" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T16:20:00.000Z",
          expiresAt: "2026-05-02T16:50:00.000Z",
        });
        repo.casUpdate(tokenHash, "issued", "bound", {
          messageRef: { chatId: "staff-1", messageId: "ding-card-1" },
        });
      }

      expect(
        repo.findBoundByMessageRefAction({
          target: { platform: "dingtalk", chatId: "staff-1" },
          messageRef: { chatId: "staff-1", messageId: "ding-card-1" },
          action: "allow_once",
        }),
      ).toMatchObject({ tokenHash: allowHash, action: "allow_once", status: "bound" });
      expect(
        repo.findBoundByMessageRefAction({
          target: { platform: "dingtalk", chatId: "staff-1" },
          messageRef: { chatId: "staff-1", messageId: "ding-card-1" },
          action: "allow_session",
        }),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("round-trips every allowed callback token action and excludes cancel", () => {
    expect(CALLBACK_ACTIONS).not.toContain("cancel" as CallbackTokenAction);

    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      for (const [idx, action] of CALLBACK_ACTIONS.entries()) {
        const tokenHash = hashCallbackToken(`synthetic-action-token-${idx}`);
        repo.insert({
          tokenHash,
          approvalId: `approval-action-${idx}`,
          action,
          callbackNonce: `nonce-action-${idx}`,
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T16:50:00.000Z",
          expiresAt: "2026-05-02T17:20:00.000Z",
        });

        expect(repo.findByHash(tokenHash)).toMatchObject({ action });
      }
    } finally {
      db.close();
    }
  });

  it("force-marks a token used and revokes bound siblings for the same approval", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const usedHash = hashCallbackToken("force-used-token");
      const siblingHash = hashCallbackToken("sibling-token");
      const issuedHash = hashCallbackToken("issued-sibling-token");
      for (const [tokenHash, action] of [
        [usedHash, "allow_once"],
        [siblingHash, "decline"],
        [issuedHash, "abort"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId: "approval-siblings",
          action,
          callbackNonce: "nonce-siblings",
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T18:00:00.000Z",
          expiresAt: "2026-05-02T18:30:00.000Z",
        });
      }
      repo.casUpdate(usedHash, "issued", "bound");
      repo.casUpdate(siblingHash, "issued", "bound");

      expect(
        repo.forceMarkUsed(usedHash, {
          actor: { kind: "im", platform: "telegram", userId: "u-alice" },
        }),
      ).toMatchObject({
        tokenHash: usedHash,
        status: "used",
        actor: { kind: "im", platform: "telegram", userId: "u-alice" },
      });

      expect(repo.revokeBoundSiblings("approval-siblings", usedHash)).toEqual([
        expect.objectContaining({ tokenHash: siblingHash, status: "revoked" }),
      ]);
      expect(repo.findByHash(usedHash)).toMatchObject({ status: "used" });
      expect(repo.findByHash(siblingHash)).toMatchObject({ status: "revoked" });
      expect(repo.findByHash(issuedHash)).toMatchObject({ status: "issued" });
    } finally {
      db.close();
    }
  });

  it("serializes expire-vs-click by status CAS on the same callback token row", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const sweepWinsHash = hashCallbackToken("sweep-wins-token");
      const clickWinsHash = hashCallbackToken("click-wins-token");
      for (const tokenHash of [sweepWinsHash, clickWinsHash]) {
        repo.insert({
          tokenHash,
          approvalId: `approval-${tokenHash}`,
          action: "allow_once",
          callbackNonce: "nonce-race",
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T18:00:00.000Z",
          expiresAt: "2026-05-02T18:00:05.000Z",
        });
        repo.casUpdate(tokenHash, "issued", "bound", {
          messageRef: { chatId: "-100123456", messageId: tokenHash },
        });
      }

      expect(repo.pruneExpired("2026-05-02T18:00:06.000Z", 1)).toEqual([
        expect.objectContaining({ tokenHash: sweepWinsHash, status: "expired" }),
      ]);
      expect(repo.casUpdate(sweepWinsHash, "bound", "used")).toBeUndefined();

      expect(repo.casUpdate(clickWinsHash, "bound", "used")).toMatchObject({
        tokenHash: clickWinsHash,
        status: "used",
      });
      expect(repo.pruneExpired("2026-05-02T18:00:06.000Z")).toEqual([]);
      expect(repo.findByHash(sweepWinsHash)).toMatchObject({ status: "expired" });
      expect(repo.findByHash(clickWinsHash)).toMatchObject({ status: "used" });
    } finally {
      db.close();
    }
  });

  it("revokes all bound tokens on daemon startup while preserving non-bound rows", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const issuedHash = hashCallbackToken("startup-issued");
      const boundHash = hashCallbackToken("startup-bound");
      const usedHash = hashCallbackToken("startup-used");
      for (const [tokenHash, approvalId] of [
        [issuedHash, "approval-issued"],
        [boundHash, "approval-bound"],
        [usedHash, "approval-used"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId,
          action: "allow_once",
          callbackNonce: "nonce-startup",
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T18:10:00.000Z",
          expiresAt: "2026-05-02T18:40:00.000Z",
        });
      }
      repo.casUpdate(boundHash, "issued", "bound");
      repo.casUpdate(usedHash, "issued", "bound");
      repo.casUpdate(usedHash, "bound", "used");

      expect(repo.revokeBound()).toEqual([
        expect.objectContaining({ tokenHash: boundHash, status: "revoked" }),
      ]);
      expect(repo.findByHash(issuedHash)).toMatchObject({ status: "issued" });
      expect(repo.findByHash(boundHash)).toMatchObject({ status: "revoked" });
      expect(repo.findByHash(usedHash)).toMatchObject({ status: "used" });
      expect(repo.revokeBound()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("revokes active issued and bound tokens on daemon startup while preserving terminal rows", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const issuedHash = hashCallbackToken("startup-active-issued");
      const boundHash = hashCallbackToken("startup-active-bound");
      const usedHash = hashCallbackToken("startup-active-used");
      const expiredHash = hashCallbackToken("startup-active-expired");
      for (const [tokenHash, approvalId] of [
        [issuedHash, "approval-issued"],
        [boundHash, "approval-bound"],
        [usedHash, "approval-used"],
        [expiredHash, "approval-expired"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId,
          action: "allow_once",
          callbackNonce: "nonce-startup-active",
          target: { platform: "dingtalk", chatId: "staff-1" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T18:10:00.000Z",
          expiresAt: "2026-05-02T18:40:00.000Z",
        });
      }
      repo.casUpdate(boundHash, "issued", "bound");
      repo.casUpdate(usedHash, "issued", "bound");
      repo.casUpdate(usedHash, "bound", "used");
      repo.casUpdate(expiredHash, "issued", "expired");

      expect(repo.revokeActive()).toEqual([
        expect.objectContaining({ tokenHash: issuedHash, status: "revoked" }),
        expect.objectContaining({ tokenHash: boundHash, status: "revoked" }),
      ]);
      expect(repo.findByHash(issuedHash)).toMatchObject({ status: "revoked" });
      expect(repo.findByHash(boundHash)).toMatchObject({ status: "revoked" });
      expect(repo.findByHash(usedHash)).toMatchObject({ status: "used" });
      expect(repo.findByHash(expiredHash)).toMatchObject({ status: "expired" });
      expect(repo.revokeActive()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("expires stale issued tokens left behind by sendCard failures", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const issuedExpiredHash = hashCallbackToken("issued-expired-token");
      const boundExpiredHash = hashCallbackToken("bound-expired-token");
      const usedExpiredHash = hashCallbackToken("used-expired-token");
      for (const [tokenHash, expiresAt] of [
        [issuedExpiredHash, "2026-05-02T18:20:00.000Z"],
        [boundExpiredHash, "2026-05-02T18:21:00.000Z"],
        [usedExpiredHash, "2026-05-02T18:22:00.000Z"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId: `approval-${tokenHash}`,
          action: "decline",
          callbackNonce: "nonce-expire-issued",
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt: "2026-05-02T18:00:00.000Z",
          expiresAt,
        });
      }
      repo.casUpdate(boundExpiredHash, "issued", "bound");
      repo.casUpdate(usedExpiredHash, "issued", "bound");
      repo.casUpdate(usedExpiredHash, "bound", "used");

      expect(repo.pruneExpired("2026-05-02T18:30:00.000Z")).toEqual([
        expect.objectContaining({ tokenHash: issuedExpiredHash, status: "expired" }),
        expect.objectContaining({ tokenHash: boundExpiredHash, status: "expired" }),
      ]);
      expect(repo.findByHash(issuedExpiredHash)).toMatchObject({ status: "expired" });
      expect(repo.findByHash(boundExpiredHash)).toMatchObject({ status: "expired" });
      expect(repo.findByHash(usedExpiredHash)).toMatchObject({ status: "used" });
    } finally {
      db.close();
    }
  });

  it("revokes only flagged old issued tokens for stuck step-5 bind failures", () => {
    const db = openDatabase(":memory:");
    try {
      runMigrations(db, REAL_MIGRATIONS_DIR);

      const repo = new CallbackTokenRepository(db);
      const flaggedOld = hashCallbackToken("flagged-old-issued");
      const flaggedRecent = hashCallbackToken("flagged-recent-issued");
      const unflaggedOld = hashCallbackToken("unflagged-old-issued");
      const flaggedBound = hashCallbackToken("flagged-bound-token");
      for (const [tokenHash, approvalId, createdAt] of [
        [flaggedOld, "approval-flagged", "2026-05-02T18:00:00.000Z"],
        [flaggedRecent, "approval-flagged", "2026-05-02T18:00:10.000Z"],
        [unflaggedOld, "approval-unflagged", "2026-05-02T18:00:00.000Z"],
        [flaggedBound, "approval-flagged", "2026-05-02T18:00:00.000Z"],
      ] as const) {
        repo.insert({
          tokenHash,
          approvalId,
          action: "decline",
          callbackNonce: "nonce-stuck",
          target: { platform: "telegram", chatId: "-100123456" },
          actor: { kind: "im" },
          createdAt,
          expiresAt: "2026-05-02T18:30:00.000Z",
        });
      }
      repo.casUpdate(flaggedBound, "issued", "bound");

      expect(repo.revokeStuckIssued("2026-05-02T18:00:05.000Z", ["approval-flagged"])).toEqual([
        expect.objectContaining({ tokenHash: flaggedOld, status: "revoked" }),
      ]);
      expect(repo.findByHash(flaggedOld)).toMatchObject({ status: "revoked" });
      expect(repo.findByHash(flaggedRecent)).toMatchObject({ status: "issued" });
      expect(repo.findByHash(unflaggedOld)).toMatchObject({ status: "issued" });
      expect(repo.findByHash(flaggedBound)).toMatchObject({ status: "bound" });
    } finally {
      db.close();
    }
  });
});

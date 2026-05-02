// T2a (Phase 3) — pragma verification for openDatabase.
//
// Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T2a
//
// Single failing test target: openDatabase applies WAL + foreign_keys
// pragmas. Two scenarios documented:
//   - file-backed: WAL takes effect (journal_mode = wal)
//   - :memory:: WAL is silently rejected by SQLite; mode stays
//     `memory`. foreign_keys still applies.
//
// Both scenarios MUST have foreign_keys = 1 (the integer SQLite
// returns for the boolean ON state).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";

describe("openDatabase pragmas (T2a)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codex-im-storage-t2a-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file-backed db: journal_mode=wal + foreign_keys=on", () => {
    const dbPath = join(tmpDir, "t2a.db");
    const db = openDatabase(dbPath);
    try {
      const journal = db.pragma("journal_mode", { simple: true });
      expect(journal).toBe("wal");

      const fk = db.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);
    } finally {
      db.close();
    }
  });

  it(":memory: db: journal_mode falls back to memory; foreign_keys=on still applies", () => {
    const db = openDatabase(":memory:");
    try {
      // SQLite refuses WAL for in-memory databases — the journal
      // stays at the default `memory` mode. We document this so a
      // future implementer doesn't try to "fix" the test by forcing
      // WAL on `:memory:`.
      const journal = db.pragma("journal_mode", { simple: true });
      expect(journal).toBe("memory");

      const fk = db.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);
    } finally {
      db.close();
    }
  });

  it("returns a usable Database handle (smoke: prepared statement runs)", () => {
    const db = openDatabase(":memory:");
    try {
      const row = db.prepare("select 1 as ok").get();
      expect(row).toEqual({ ok: 1 });
    } finally {
      db.close();
    }
  });
});

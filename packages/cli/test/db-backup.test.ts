import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDbBackupPaths, parseDbBackupArgs, runDbBackupCore } from "../src/db-backup.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-im-db-backup-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("codex-im db backup (T33)", () => {
  it("backs up a live WAL-mode SQLite database and prunes only old backup files", async () => {
    const root = makeTempRoot();
    const source = join(root, "state.db");
    const backupDir = join(root, "backups");
    const outsideBackupDir = join(root, "state-20260301.db");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(outsideBackupDir, "do not delete");
    const db = new Database(source);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    db.prepare("INSERT INTO smoke (value) VALUES (?)").run("committed-in-wal");
    expect(existsSync(`${source}-wal`)).toBe(true);

    for (let day = 1; day <= 31; day++) {
      writeFileSync(join(backupDir, `state-202603${String(day).padStart(2, "0")}.db`), "old");
    }
    writeFileSync(join(backupDir, "state-20260301.db.tmp"), "not a backup");
    writeFileSync(join(backupDir, "notes.txt"), "not a backup");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runDbBackupCore({
      argv: ["--source", source, "--backup-dir", backupDir],
      env: { HOME: root },
      now: new Date("2026-05-02T01:02:03.000Z"),
      output: (line) => stdout.push(line),
      errorOutput: (line) => stderr.push(line),
    });
    db.close();

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const backup = new Database(join(backupDir, "state-20260502.db"), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(backup.prepare("SELECT value FROM smoke WHERE id = 1").pluck().get()).toBe(
        "committed-in-wal",
      );
    } finally {
      backup.close();
    }
    expect(existsSync(join(backupDir, "state-20260301.db"))).toBe(false);
    expect(existsSync(join(backupDir, "state-20260302.db"))).toBe(false);
    expect(existsSync(outsideBackupDir)).toBe(true);
    expect(existsSync(join(backupDir, "state-20260301.db.tmp"))).toBe(true);
    expect(existsSync(join(backupDir, "notes.txt"))).toBe(true);

    const backups = readdirSync(backupDir).filter((name) => /^state-\d{8}\.db$/.test(name));
    expect(backups).toHaveLength(30);
    expect(stdout.join("\n")).toContain("created: ");
    expect(stdout.join("\n")).toContain("pruned: 2");
  });

  it("uses ~/.codex-im-bridge state and backup paths by default", () => {
    expect(defaultDbBackupPaths({ HOME: "/Users/operator" })).toEqual({
      sourcePath: join("/Users/operator", ".codex-im-bridge", "state.db"),
      backupDir: join("/Users/operator", ".codex-im-bridge", "backups"),
    });
  });

  it("parses explicit source, backup dir, and retention flags", () => {
    expect(
      parseDbBackupArgs([
        "--source",
        "/tmp/state.db",
        "--backup-dir",
        "/tmp/backups",
        "--keep",
        "7",
      ]),
    ).toEqual({
      sourcePath: "/tmp/state.db",
      backupDir: "/tmp/backups",
      keep: 7,
    });
    expect(() => parseDbBackupArgs(["--source"])).toThrow(/--source.*value/i);
    expect(() => parseDbBackupArgs(["--keep", "0"])).toThrow(/--keep.*positive integer/i);
    expect(() => parseDbBackupArgs(["--bogus"])).toThrow(/unknown flag.*--bogus/);
  });

  it("fails closed when the source database is missing", async () => {
    const root = makeTempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runDbBackupCore({
      argv: ["--source", join(root, "missing-state.db"), "--backup-dir", join(root, "backups")],
      env: { HOME: root },
      now: new Date("2026-05-02T01:02:03.000Z"),
      output: (line) => stdout.push(line),
      errorOutput: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("source database not found");
  });

  it("fails closed when the source file is not a SQLite database", async () => {
    const root = makeTempRoot();
    const source = join(root, "state.db");
    const stdout: string[] = [];
    const stderr: string[] = [];
    writeFileSync(source, "not sqlite");

    const exitCode = await runDbBackupCore({
      argv: ["--source", source, "--backup-dir", join(root, "backups")],
      env: { HOME: root },
      now: new Date("2026-05-02T01:02:03.000Z"),
      output: (line) => stdout.push(line),
      errorOutput: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(3);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("failed to create SQLite backup");
  });

  it("ships a cron template without secrets or launchd side effects", () => {
    const template = readFileSync(
      join(import.meta.dirname, "../../../templates/codex-im-db-backup.cron.tmpl"),
      "utf8",
    );

    expect(template).toContain("pnpm");
    expect(template).toContain("db:backup");
    expect(template).toContain("{{REPO_DIR}}");
    expect(template).toContain("{{PNPM_BIN}}");
    expect(template).not.toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(template).not.toContain("launchctl");
  });
});

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_KEEP = 30;
const BACKUP_FILE_RE = /^state-(\d{8})\.db$/;

export interface DbBackupFlags {
  readonly sourcePath?: string;
  readonly backupDir?: string;
  readonly keep?: number;
}

export interface DbBackupPaths {
  readonly sourcePath: string;
  readonly backupDir: string;
}

export interface RunDbBackupCoreOptions {
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly now?: Date;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
}

interface BackupEntry {
  readonly name: string;
  readonly path: string;
}

export function parseDbBackupArgs(argv: readonly string[]): DbBackupFlags {
  const flags: { sourcePath?: string; backupDir?: string; keep?: number } = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--source") {
      flags.sourcePath = requireFlagValue(arg, next);
      i += 2;
      continue;
    }
    if (arg === "--backup-dir") {
      flags.backupDir = requireFlagValue(arg, next);
      i += 2;
      continue;
    }
    if (arg === "--keep") {
      const raw = requireFlagValue(arg, next);
      const keep = Number(raw);
      if (!Number.isInteger(keep) || keep <= 0) {
        throw new Error("db backup: --keep must be a positive integer");
      }
      flags.keep = keep;
      i += 2;
      continue;
    }
    throw new Error(`db backup: unknown flag '${arg}'`);
  }
  return flags;
}

export function defaultDbBackupPaths(
  env: Record<string, string | undefined> = process.env,
): DbBackupPaths {
  const home = env.HOME;
  if (home === undefined || home.length === 0) {
    throw new Error("db backup: HOME is required when --source/--backup-dir are not provided");
  }
  const dataDir = join(home, ".codex-im-bridge");
  return {
    sourcePath: join(dataDir, "state.db"),
    backupDir: join(dataDir, "backups"),
  };
}

export function runDbBackupCore(options: RunDbBackupCoreOptions = {}): number {
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const env = options.env ?? process.env;
  let flags: DbBackupFlags;
  let defaults: DbBackupPaths;

  try {
    flags = parseDbBackupArgs(options.argv ?? []);
    defaults = defaultDbBackupPaths(env);
  } catch (error) {
    errorOutput(errorMessage(error));
    return 2;
  }

  const sourcePath = flags.sourcePath ?? defaults.sourcePath;
  const backupDir = flags.backupDir ?? defaults.backupDir;
  const keep = flags.keep ?? DEFAULT_KEEP;

  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    errorOutput(`db backup: source database not found: ${sourcePath}`);
    return 2;
  }

  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `state-${formatBackupDate(options.now ?? new Date())}.db`);
  copyFileSync(sourcePath, backupPath);
  const pruned = pruneOldBackups(backupDir, keep);

  output(`created: ${backupPath}`);
  output(`pruned: ${pruned}`);
  return 0;
}

export async function run(argv: readonly string[] = process.argv.slice(4)): Promise<void> {
  const exitCode = runDbBackupCore({ argv });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function pruneOldBackups(backupDir: string, keep: number): number {
  const entries = listManagedBackups(backupDir).sort((a, b) => b.name.localeCompare(a.name));
  const toPrune = entries.slice(keep);
  for (const entry of toPrune) {
    rmSync(entry.path);
  }
  return toPrune.length;
}

function listManagedBackups(backupDir: string): BackupEntry[] {
  const resolvedBackupDir = resolve(backupDir);
  const entries: BackupEntry[] = [];
  for (const dirent of readdirSync(resolvedBackupDir, { withFileTypes: true })) {
    if (!dirent.isFile() || !BACKUP_FILE_RE.test(dirent.name)) {
      continue;
    }
    const path = resolve(resolvedBackupDir, dirent.name);
    if (dirname(path) !== resolvedBackupDir) {
      continue;
    }
    entries.push({ name: dirent.name, path });
  }
  return entries;
}

function formatBackupDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function requireFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`db backup: ${flag} requires a value`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

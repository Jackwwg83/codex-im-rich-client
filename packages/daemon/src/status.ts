import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DaemonStatusFatal {
  readonly at: string;
  readonly message: string;
}

export interface DaemonStatusSnapshot {
  readonly pid: number;
  readonly startedAt: string;
  readonly currentCodexThreadCount: number;
  readonly pendingApprovalCount: number;
  readonly lastCodexSpawnAt?: string | null;
  readonly supervisorFailureCount: number;
  readonly lastFatal?: DaemonStatusFatal | null;
}

export interface DaemonStatusSnapshotIo {
  readonly mkdir?: typeof mkdir;
  readonly rename?: typeof rename;
  readonly writeFile?: typeof writeFile;
  readonly tmpSuffix?: string;
}

export async function writeDaemonStatusSnapshot(
  path: string,
  snapshot: DaemonStatusSnapshot,
  io: DaemonStatusSnapshotIo = {},
): Promise<void> {
  const mkdirFn = io.mkdir ?? mkdir;
  const renameFn = io.rename ?? rename;
  const writeFileFn = io.writeFile ?? writeFile;
  const tmpPath = `${path}.${io.tmpSuffix ?? `${process.pid}.tmp`}`;
  await mkdirFn(dirname(path), { recursive: true });
  await writeFileFn(tmpPath, `${JSON.stringify(redactSnapshot(snapshot), null, 2)}\n`, {
    mode: 0o600,
  });
  await renameFn(tmpPath, path);
}

function redactSnapshot(snapshot: DaemonStatusSnapshot): DaemonStatusSnapshot {
  if (snapshot.lastFatal === undefined || snapshot.lastFatal === null) {
    return snapshot;
  }
  return {
    ...snapshot,
    lastFatal: {
      ...snapshot.lastFatal,
      message: redactStatusText(snapshot.lastFatal.message),
    },
  };
}

function redactStatusText(value: string): string {
  return value
    .replace(/IM_TELEGRAM_BOT_TOKEN=([^\s]+)/g, "IM_TELEGRAM_BOT_TOKEN=<redacted>")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "<redacted:telegram-token>");
}

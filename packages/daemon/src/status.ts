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

export interface DaemonWebStatusConsoleOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface DaemonWebStatusConsolePlan {
  readonly host: string;
  readonly port: number;
  readonly readOnly: true;
}

export interface DaemonWebStatusViewOptions {
  readonly bind?: DaemonWebStatusConsolePlan;
  readonly title?: string;
}

export interface DaemonWebStatusView {
  readonly contentType: "text/html; charset=utf-8";
  readonly body: string;
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

export function planDaemonWebStatusConsole(
  options: DaemonWebStatusConsoleOptions = {},
): DaemonWebStatusConsolePlan {
  const host = (options.host ?? "127.0.0.1").trim().toLowerCase();
  const port = options.port ?? 0;
  if (!isLoopbackHost(host)) {
    throw new Error(`web status console is loopback-only; rejected host ${host}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("web status console port must be an integer from 0 to 65535");
  }
  return {
    host,
    port,
    readOnly: true,
  };
}

export function renderDaemonWebStatusView(
  snapshot: DaemonStatusSnapshot,
  options: DaemonWebStatusViewOptions = {},
): DaemonWebStatusView {
  const bind = options.bind ?? planDaemonWebStatusConsole();
  const title = options.title ?? "Codex IM Daemon Status";
  const safeSnapshot = redactSnapshot(snapshot);
  const rows: readonly (readonly [string, string])[] = [
    ["pid", String(safeSnapshot.pid)],
    ["startedAt", safeSnapshot.startedAt],
    ["currentCodexThreadCount", String(safeSnapshot.currentCodexThreadCount)],
    ["pendingApprovalCount", String(safeSnapshot.pendingApprovalCount)],
    ["lastCodexSpawnAt", safeSnapshot.lastCodexSpawnAt ?? "none"],
    ["supervisorFailureCount", String(safeSnapshot.supervisorFailureCount)],
    ["bind", `${bind.host}:${bind.port}`],
    ["mode", "Read-only"],
  ];
  const fatalRows =
    safeSnapshot.lastFatal === undefined || safeSnapshot.lastFatal === null
      ? ""
      : `<section aria-labelledby="last-fatal"><h2 id="last-fatal">Last fatal</h2><dl><dt>at</dt><dd>${escapeHtml(
          safeSnapshot.lastFatal.at,
        )}</dd><dt>message</dt><dd>${escapeHtml(safeSnapshot.lastFatal.message)}</dd></dl></section>`;

  const statusRows = rows
    .map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");

  return {
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>Read-only local daemon status. Mutation controls are disabled.</p>
    <section aria-labelledby="runtime-status">
      <h2 id="runtime-status">Runtime status</h2>
      <dl>${statusRows}</dl>
    </section>
    ${fatalRows}
  </main>
</body>
</html>
`,
  };
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
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)=([^\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "<redacted:telegram-token>")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "<redacted:secret>");
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

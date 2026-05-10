// Slice 3 A4 — passive observer for codex's remote-control status.
//
// codex 0.130.x emits `remoteControl/status/changed` notifications when
// its app-server-daemon attaches to a remote control client (e.g. a
// codex desktop / mobile remote). The IM bridge is NOT a remote
// control client (ADR 0004 forbids it), but operators may still want
// to know whether the codex they are talking to is being driven by
// some other party.
//
// This module exposes a tiny pure parser; the daemon stores the latest
// observation in a private field and renders it as an extra line in
// `/status`. Per ADR 0004 the value is informational only — never used
// for authorization decisions.

export type RemoteControlConnectionStatus = "disabled" | "connecting" | "connected" | "errored";

export interface RemoteControlStatusUpdate {
  readonly status: RemoteControlConnectionStatus;
  readonly environmentId: string | null;
}

/**
 * Parse a `remoteControl/status/changed` notification's params into a
 * structurally-validated update. Returns undefined if the input does
 * not match the expected shape — callers should leave their cached
 * status untouched in that case (we don't know the new value).
 */
export function parseRemoteControlStatusParams(
  params: unknown,
): RemoteControlStatusUpdate | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const raw = params as { status?: unknown; environmentId?: unknown };
  if (!isConnectionStatus(raw.status)) {
    return undefined;
  }
  const environmentId = typeof raw.environmentId === "string" ? raw.environmentId : null;
  return { status: raw.status, environmentId };
}

/**
 * Render the cached status as a single `/status` line. Returns the
 * literal string the daemon appends (no trailing newline).
 */
export function formatRemoteControlStatusLine(
  update: RemoteControlStatusUpdate | undefined,
): string {
  if (update === undefined) {
    return "Codex remote control: unknown";
  }
  return `Codex remote control: ${update.status}`;
}

function isConnectionStatus(value: unknown): value is RemoteControlConnectionStatus {
  return (
    value === "disabled" || value === "connecting" || value === "connected" || value === "errored"
  );
}

#!/usr/bin/env -S pnpm exec tsx
// T3 (Phase 1, Codex B2): JSON-aware capture splitter.
//
// Codex outside-voice flagged that the original T4 split step used grep
// to separate notifications from server-initiated requests. grep is
// unsafe for nested JSON (a frame can have a string field literally
// containing "method": "..." that grep would match). This script does
// the split with a real JSON parser.
//
// Used by T4 step 4.5 — between smoke:real-turn --capture and
// scripts/redact-fixture.mjs.
//
// Frame discrimination (top-level JSON-RPC lite shape):
//
//   { method, ... } with NO "id"     -> notification
//   { method, id, ... }              -> server-initiated request
//   { id, result | error, ... }      -> response (skipped — these are
//                                       client-initiated request answers,
//                                       not part of the wire-shape
//                                       fixtures we commit)
//
// Usage:
//   pnpm exec tsx scripts/split-capture.mts <raw> <notif-out> <req-out>
//
// Exits non-zero if any line is not parseable JSON. (T4 requires a clean
// capture; noisy stderr leaks should be investigated before splitting,
// not silently dropped.)

import { readFileSync, writeFileSync } from "node:fs";

interface JsonRpcFrame {
  method?: unknown;
  id?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface SplitCounts {
  notifications: number;
  requests: number;
  responses: number;
  unknown: number;
}

export interface SplitResult {
  notifications: string[];
  requests: string[];
  counts: SplitCounts;
}

/**
 * Split a JSONL document into notifications and server-initiated requests.
 * Responses (id without method) and other shapes are counted but not
 * emitted into either output stream.
 */
export function splitCapture(jsonlText: string): SplitResult {
  const lines = jsonlText.split("\n").filter((l) => l.length > 0);

  const notifications: string[] = [];
  const requests: string[] = [];
  const counts: SplitCounts = {
    notifications: 0,
    requests: 0,
    responses: 0,
    unknown: 0,
  };

  for (const line of lines) {
    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(line) as JsonRpcFrame;
    } catch (e) {
      throw new Error(`split-capture: line is not valid JSON: ${(e as Error).message}\n  ${line}`);
    }

    if (typeof frame !== "object" || frame === null) {
      counts.unknown++;
      continue;
    }

    const hasMethod = typeof frame.method === "string";
    const hasId = "id" in frame && frame.id !== undefined;
    const hasResultOrError = "result" in frame || "error" in frame;

    if (hasMethod && hasId) {
      requests.push(line);
      counts.requests++;
    } else if (hasMethod && !hasId) {
      notifications.push(line);
      counts.notifications++;
    } else if (hasId && hasResultOrError) {
      counts.responses++;
    } else {
      counts.unknown++;
    }
  }

  return { notifications, requests, counts };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function main(): void {
  const [, , inPath, notifOut, reqOut] = process.argv;
  if (!inPath || !notifOut || !reqOut) {
    console.error(
      "usage: pnpm exec tsx scripts/split-capture.mts <raw.jsonl> <notif-out.jsonl> <req-out.jsonl>",
    );
    process.exit(2);
  }

  const text = readFileSync(inPath, "utf8");
  const result = splitCapture(text);

  const notifBody = result.notifications.length > 0 ? `${result.notifications.join("\n")}\n` : "";
  const reqBody = result.requests.length > 0 ? `${result.requests.join("\n")}\n` : "";

  writeFileSync(notifOut, notifBody);
  writeFileSync(reqOut, reqBody);

  console.log(
    `split-capture: ${result.counts.notifications} notifications, ` +
      `${result.counts.requests} server-requests, ` +
      `${result.counts.responses} responses (skipped), ` +
      `${result.counts.unknown} unknown shapes (skipped)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

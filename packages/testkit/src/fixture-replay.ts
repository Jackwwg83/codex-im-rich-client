/**
 * Fixture loader for `packages/testkit/fixtures/codex-X.Y.Z/`.
 *
 * Codex outside-voice finding #9: a fake server that only mirrors planned
 * messages will silently drift from real codex output. Wire fixtures
 * captured during the Phase 0 wire spike (host-environment.md) are committed
 * verbatim and replayed by contract tests on every CI run.
 *
 * Fixture file layout (per version dir):
 *   metadata.json                          — codex version + capture context
 *   initialize-response.jsonl              — case 1 wire spike
 *   string-id-initialize-response.jsonl    — case 2
 *   unknown-method-error.jsonl             — case 3
 *   invalid-params-error.jsonl             — case 4
 *   malformed-json.stderr.txt              — case 5 (NOT JSONL — plaintext)
 *   server-request-sample.jsonl            — captured during smoke:real-turn
 *   harmless-turn-event-stream.jsonl       — captured during smoke:real-turn
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve `packages/testkit/fixtures/codex-<version>/<name>` from src/. */
function fixturePath(version: string, name: string): string {
  return join(here, "..", "fixtures", `codex-${version}`, name);
}

export interface FixtureMetadata {
  codexVersion: string;
  platform: string;
  platformOs?: string;
  platformFamily?: string;
  capturedAt: string;
  capturedBy?: string;
  experimentalFlag?: boolean;
  notes: string[];
  [key: string]: unknown;
}

/** Load and parse `metadata.json` for a captured codex version. */
export function loadFixtureMetadata(version: string): FixtureMetadata {
  const path = fixturePath(version, "metadata.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as FixtureMetadata;
}

/**
 * Load a `*.jsonl` fixture as an array of parsed JSON values.
 * Skips comment lines (starting with `#`) and blank lines.
 */
export function loadFixture(version: string, name: string): unknown[] {
  const path = fixturePath(version, name);
  const raw = readFileSync(path, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

/** Load a plaintext fixture (e.g. malformed-json.stderr.txt). */
export function loadFixtureText(version: string, name: string): string {
  return readFileSync(fixturePath(version, name), "utf8");
}

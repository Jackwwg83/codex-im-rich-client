#!/usr/bin/env node
/**
 * Canonicalize JSON schemas under packages/codex-protocol/schema/ by recursively
 * sorting object keys. Without this, `codex app-server generate-json-schema`
 * is non-deterministic — Rust serde's default HashMap iteration order can
 * vary across runs, producing spurious diffs.
 *
 * Run as the final step of `pnpm protocol:generate` so committed artifacts
 * are reproducible. `pnpm protocol:check` (= protocol:generate && git diff
 * --exit-code) then guards against accidental schema drift.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = "packages/codex-protocol/schema";

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

function walk(dir, paths) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, paths);
    else if (entry.endsWith(".json")) paths.push(full);
  }
}

const paths = [];
walk(SCHEMA_DIR, paths);

for (const path of paths) {
  const obj = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, `${JSON.stringify(sortKeys(obj), null, 2)}\n`);
}

console.log(`[canonicalize-schema] sorted ${paths.length} JSON files in ${SCHEMA_DIR}`);

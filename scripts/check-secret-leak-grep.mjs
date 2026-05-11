#!/usr/bin/env node
// Contract check: no source file under packages/*/src or scripts/ may
// log a `length` / `size` / `chars` field within a few lines of a
// `***REDACTED***` payload. Numeric length is a side-channel hint about
// secret shape — see docs/architecture/decisions/0005-version-tag-sync-rule.md
// is unrelated; the guarding policy lives in the config secret resolver
// (packages/config/src/index.ts) and the test config.test.ts.
//
// Heuristic: scan production source files line by line, flag any line
// that contains a JS object-literal field named `length:` / `size:` /
// `chars:` AND whose 5-line neighbourhood contains the literal token
// `***REDACTED***`. This catches the resolveSecretEnv-style regression
// while ignoring legitimate `.length` / `.size` property reads.

import { basename, dirname, join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_PATHS = ["packages", "scripts"];
const EXTS = new Set([".ts", ".mts", ".mjs", ".js"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test",
  "tests",
  "generated",
  "fixtures",
  "coverage",
]);
// Skip the contract check scripts themselves. Their JSDoc and inline
// rationale mention `length:` and `***REDACTED***` literally as part of
// the explanation, which trips the heuristic on the scanner's own file.
function isContractCheckFile(file) {
  return basename(file).startsWith("check-") && file.endsWith(".mjs");
}

function listFiles(root, out = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(full, out);
    else {
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot) : "";
      if (EXTS.has(ext) && !isContractCheckFile(full)) out.push(full);
    }
  }
  return out;
}

export function check(src) {
  const findings = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/\b(length|size|chars)\s*:/.test(line)) continue;
    const lo = Math.max(0, i - 5);
    const hi = Math.min(lines.length, i + 6);
    const window = lines.slice(lo, hi).join("\n");
    if (window.includes("***REDACTED***")) {
      findings.push({ line: i + 1, src: line.trim() });
    }
  }
  return findings;
}

export function main({ repoRoot = REPO_ROOT } = {}) {
  const files = [];
  for (const sp of SCAN_PATHS) listFiles(join(repoRoot, sp), files);
  const failures = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const findings = check(src);
    if (findings.length > 0) failures.push({ file, findings });
  }
  if (failures.length === 0) {
    console.log(
      `check-secret-leak-grep: OK (scanned ${files.length} production source files)`,
    );
    return 0;
  }
  console.error(
    "check-secret-leak-grep: FAIL — length/size/chars field near ***REDACTED*** payload",
  );
  for (const { file, findings } of failures) {
    const rel = file.startsWith(repoRoot) ? file.slice(repoRoot.length + 1) : file;
    for (const f of findings) {
      console.error(`  ${rel}:${f.line}  ${f.src}`);
    }
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

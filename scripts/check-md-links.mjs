#!/usr/bin/env node
// Contract check: every relative markdown link in the customer-facing
// docs must resolve to a real file on disk. External (http/https/mailto)
// links and pure anchors are skipped — we only care about files we
// promised to ship.
//
// Internal phase / handoff / superpowers / release-readiness packets are
// intentionally NOT scanned: they are frozen evidence whose stale links
// document the pre-2026-05-10 docs reorg (see docs/internal/README.md).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Roots to scan, relative to REPO_ROOT. Mix of single files and
// directories; directories are walked recursively for .md files.
const SCAN_ROOTS = [
  "README.md",
  "SECURITY.md",
  "CLAUDE.md",
  "docs/user",
  "docs/setup",
  "docs/ops",
  "docs/maintainer",
  "docs/architecture",
  "docs/internal/README.md",
  "docs/internal/design/README.md",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".vitest-cache"]);

function listMarkdown(rootAbs, out = []) {
  let entries;
  try {
    const st = statSync(rootAbs);
    if (st.isFile()) {
      if (rootAbs.endsWith(".md")) out.push(rootAbs);
      return out;
    }
    entries = readdirSync(rootAbs);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(rootAbs, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) listMarkdown(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

export function findBrokenLinks(filePath, src) {
  const broken = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of src.matchAll(re)) {
    let target = match[1].trim();
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("mailto:") || target.startsWith("tel:")) continue;
    if (target.startsWith("#")) continue;
    target = target.split("#")[0];
    if (target.length === 0) continue;
    const resolved = resolvePath(dirname(filePath), target);
    try {
      statSync(resolved);
    } catch {
      broken.push({ target: match[1], resolved });
    }
  }
  return broken;
}

export function main({ repoRoot = REPO_ROOT } = {}) {
  const files = [];
  for (const root of SCAN_ROOTS) listMarkdown(join(repoRoot, root), files);
  let totalLinks = 0;
  const failures = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    totalLinks += (src.match(/\]\(/g) ?? []).length;
    const broken = findBrokenLinks(file, src);
    if (broken.length > 0) failures.push({ file, broken });
  }
  if (failures.length === 0) {
    console.log(
      `check-md-links: OK (${totalLinks} link references scanned across ${files.length} markdown files)`,
    );
    return 0;
  }
  console.error(`check-md-links: FAIL — broken local link(s) in ${failures.length} file(s)`);
  for (const { file, broken } of failures) {
    const rel = file.startsWith(repoRoot) ? file.slice(repoRoot.length + 1) : file;
    console.error(`  in ${rel}:`);
    for (const b of broken) {
      console.error(`    -> ${b.target}`);
    }
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

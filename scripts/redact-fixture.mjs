#!/usr/bin/env node
// T3 (Phase 1, P1-5): JSONL fixture redactor.
//
// Used by T4 step 4.5 to scrub PII before committing captures into
// packages/testkit/fixtures/codex-0.125.0/. Idempotent — running twice
// yields the same output as running once (asserted in
// redact-fixture.test.mjs).
//
// Two redaction classes:
//   - filesystem paths (absolute, host-specific)  -> <CWD>
//   - model names (gpt-*, o1-*, o3-*, o4-*, claude-*)  -> <MODEL>
//
// Lines that fail to parse as JSON pass through verbatim. The script must
// never crash on a captured fixture — if a stderr leak somehow ended up in
// the input, that is the operator's signal that something went wrong with
// the smoke-real-turn capture flow, not a redact-fixture bug.
//
// Usage:
//   node scripts/redact-fixture.mjs < raw.jsonl > clean.jsonl
//   node scripts/redact-fixture.mjs raw.jsonl                # also accepted

import { readFileSync } from "node:fs";

// ─── Path patterns ──────────────────────────────────────────────────────
// These match an entire absolute path; the placeholder <CWD> is intended
// to be a substitution for the whole string field, so we anchor at start.
// Using individual prefix patterns keeps the matcher easy to audit.
const PATH_PREFIX_PATTERNS = [
  // /Users/<name>/...   (macOS user dirs)
  /^\/Users\/[^/]+(?:\/.*)?$/,
  // /home/<name>/...    (Linux user dirs)
  /^\/home\/[^/]+(?:\/.*)?$/,
  // /private/var/folders/... (macOS per-user temp; mkdtemp lives here)
  /^\/private\/var\/folders\/.*/,
  // /tmp/codex-fixture-<rand>/... (T4 sandbox dir; matches the specific
  // prefix the plan uses, narrower than a blanket /tmp redaction so we
  // don't paper over unrelated /tmp usage)
  /^\/tmp\/codex-fixture-.*/,
];

// ─── Model name patterns ────────────────────────────────────────────────
const MODEL_NAME_PATTERNS = [/^gpt-.*/, /^o[1-9][0-9]*(?:-.*)?$/, /^claude-.*/];

const PLACEHOLDER_PATH = "<CWD>";
const PLACEHOLDER_MODEL = "<MODEL>";

function isAlreadyRedacted(s) {
  return s === PLACEHOLDER_PATH || s === PLACEHOLDER_MODEL;
}

function shouldRedactAsPath(s) {
  if (isAlreadyRedacted(s)) return false;
  return PATH_PREFIX_PATTERNS.some((re) => re.test(s));
}

function shouldRedactAsModel(s) {
  if (isAlreadyRedacted(s)) return false;
  return MODEL_NAME_PATTERNS.some((re) => re.test(s));
}

/**
 * Recursively walk a parsed JSON value, replacing any string that matches
 * a path / model pattern with its placeholder. Arrays + objects are
 * recursed into; primitives other than string are passed through.
 */
function redactValue(v) {
  if (v === null) return v;
  if (typeof v === "string") {
    if (shouldRedactAsPath(v)) return PLACEHOLDER_PATH;
    if (shouldRedactAsModel(v)) return PLACEHOLDER_MODEL;
    return v;
  }
  if (Array.isArray(v)) return v.map(redactValue);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redactValue(val);
    return out;
  }
  return v;
}

/**
 * Redact a single JSONL line. Empty input passes through. Non-JSON input
 * passes through verbatim (the script never crashes on noise).
 */
export function redactLine(line) {
  if (line.length === 0) return "";
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Pass through verbatim. Real fixtures should never contain non-JSON
    // lines; if they do, that is operator visibility, not a redactor bug.
    return line;
  }
  return JSON.stringify(redactValue(parsed));
}

/**
 * Redact a multi-line JSONL document. Trailing/leading blank lines are
 * dropped from the output so idempotency holds (running redact twice
 * yields the same output as once).
 */
export function redactJsonl(text) {
  if (text.length === 0) return "";
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    out.push(redactLine(line));
  }
  if (out.length === 0) return "";
  return `${out.join("\n")}\n`;
}

// ─── CLI ────────────────────────────────────────────────────────────────

async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const arg = process.argv[2];
  let input;
  if (arg && arg !== "-") {
    input = readFileSync(arg, "utf8");
  } else {
    input = await readAllStdin();
  }
  process.stdout.write(redactJsonl(input));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

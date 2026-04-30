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
// Inline substring match: real captured fixtures embed absolute paths in
// prose-like fields (e.g. `warning.message`, `agent_message_delta`). T4
// surfaced one such case — `Under-development features ... in
// /Users/jackwu/.codex/config.toml.` — that whole-string anchored
// patterns silently missed. Each regex is global and consumes a path up
// to the next whitespace or string-quote / paren / comma terminator.
//
// Trailing punctuation (period, semicolon) is intentionally consumed:
// "in <CWD>" reads better than "in <CWD>." and the captured period was
// part of the host path anyway. Idempotency holds because <CWD> contains
// `<` and `>`, neither of which match the path patterns.
const PATH_INLINE_PATTERNS = [
  // /Users/<name>/...   (macOS user dirs)
  /\/Users\/[^\s)"',\\]+/g,
  // /home/<name>/...    (Linux user dirs)
  /\/home\/[^\s)"',\\]+/g,
  // /private/var/folders/... (macOS per-user temp; mkdtemp lives here)
  /\/private\/var\/folders\/[^\s)"',\\]+/g,
  // /tmp/codex-fixture-<rand>/... (T4 sandbox dir; narrower than a
  // blanket /tmp redaction so we don't paper over unrelated /tmp usage)
  /\/tmp\/codex-fixture-[^\s)"',\\]+/g,
];

// ─── Model name patterns ────────────────────────────────────────────────
// Inline word-boundary match: a model name embedded in prose
// ("the gpt-5-codex run...") should also redact, not just bare strings.
// The o1/o3/o4 family is matched only with a digit-and-suffix shape to
// avoid false positives on standalone "o1" inside unrelated text — there
// must be at least one alphanumeric char after the digit run.
const MODEL_INLINE_PATTERNS = [
  /\bgpt-[a-zA-Z0-9.-]+/g,
  /\bo[1-9][0-9]*-[a-zA-Z0-9.-]+/g,
  /\bclaude-[a-zA-Z0-9.-]+/g,
];

const PLACEHOLDER_PATH = "<CWD>";
const PLACEHOLDER_MODEL = "<MODEL>";

function redactStringInline(s) {
  let out = s;
  for (const re of PATH_INLINE_PATTERNS) {
    out = out.replace(re, PLACEHOLDER_PATH);
  }
  for (const re of MODEL_INLINE_PATTERNS) {
    out = out.replace(re, PLACEHOLDER_MODEL);
  }
  return out;
}

/**
 * Recursively walk a parsed JSON value, replacing path / model patterns
 * inside any string field with placeholders. Arrays + objects are
 * recursed into; primitives other than string are passed through.
 */
function redactValue(v) {
  if (v === null) return v;
  if (typeof v === "string") return redactStringInline(v);
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

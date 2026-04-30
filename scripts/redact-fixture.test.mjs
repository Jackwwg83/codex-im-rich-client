// T3 (Phase 1, P1-5): redact-fixture round-trip tests.
//
// Runs in the default `pnpm test` unit gate via vitest's scripts/ include.
// Verifies the script that T4 step 4.5 pipes the captured raw stream
// through, before committing fixtures into
// packages/testkit/fixtures/codex-0.125.0/.

import { describe, expect, it } from "vitest";
import { redactJsonl, redactLine } from "./redact-fixture.mjs";

describe("redactJsonl", () => {
  it("returns empty string for empty input", () => {
    expect(redactJsonl("")).toBe("");
  });

  it("redacts /Users/<name>/... paths to <CWD>", () => {
    const input = JSON.stringify({ cwd: "/Users/jackwu/projects/x" });
    const output = redactJsonl(input);
    const parsed = JSON.parse(output.trim());
    expect(parsed.cwd).toBe("<CWD>");
  });

  it("redacts /home/<name>/... paths to <CWD>", () => {
    const input = JSON.stringify({ cwd: "/home/runner/work/repo" });
    const parsed = JSON.parse(redactJsonl(input).trim());
    expect(parsed.cwd).toBe("<CWD>");
  });

  it("redacts /tmp/codex-fixture-<rand> paths to <CWD>", () => {
    const input = JSON.stringify({ cwd: "/tmp/codex-fixture-spike" });
    const parsed = JSON.parse(redactJsonl(input).trim());
    expect(parsed.cwd).toBe("<CWD>");
  });

  it("redacts /private/var/folders/... (macOS tmp) paths to <CWD>", () => {
    const input = JSON.stringify({ cwd: "/private/var/folders/abc/T/x" });
    const parsed = JSON.parse(redactJsonl(input).trim());
    expect(parsed.cwd).toBe("<CWD>");
  });

  it("redacts model names to <MODEL>", () => {
    const cases = [
      { in: "gpt-4o", expected: "<MODEL>" },
      { in: "gpt-5-codex", expected: "<MODEL>" },
      { in: "o1-preview", expected: "<MODEL>" },
      { in: "o3-mini", expected: "<MODEL>" },
      { in: "o4-2025-04", expected: "<MODEL>" },
      { in: "claude-opus-4-7", expected: "<MODEL>" },
    ];
    for (const c of cases) {
      const input = JSON.stringify({ model: c.in });
      const parsed = JSON.parse(redactJsonl(input).trim());
      expect(parsed.model, `expected ${c.in} -> ${c.expected}`).toBe(c.expected);
    }
  });

  it("preserves non-matching strings verbatim", () => {
    const input = JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-abc-123", turnId: "turn-xyz-456" },
    });
    const parsed = JSON.parse(redactJsonl(input).trim());
    expect(parsed.method).toBe("turn/started");
    expect(parsed.params.threadId).toBe("thread-abc-123");
    expect(parsed.params.turnId).toBe("turn-xyz-456");
  });

  it("processes multi-line JSONL", () => {
    const input = `${JSON.stringify({ cwd: "/Users/jackwu/x" })}\n${JSON.stringify({ method: "turn/started" })}\n${JSON.stringify({ model: "gpt-5" })}`;
    const out = redactJsonl(input).trim().split("\n");
    expect(out.length).toBe(3);
    expect(JSON.parse(out[0]).cwd).toBe("<CWD>");
    expect(JSON.parse(out[1]).method).toBe("turn/started");
    expect(JSON.parse(out[2]).model).toBe("<MODEL>");
  });

  it("is idempotent: redact(redact(x)) === redact(x)", () => {
    const dirty = JSON.stringify({
      cwd: "/Users/jackwu/projects/codex-im-rich-client",
      model: "gpt-4o",
      method: "turn/started",
    });
    const once = redactJsonl(dirty);
    const twice = redactJsonl(once);
    expect(twice).toBe(once);
  });

  it("skips blank lines without crashing", () => {
    const input = `${JSON.stringify({ cwd: "/Users/x/y" })}\n\n\n`;
    const out = redactJsonl(input);
    // Single output line, no extras for the blanks.
    expect(out.trim().split("\n").length).toBe(1);
  });

  it("preserves non-JSON lines unchanged (defensive — never crash on stderr leak)", () => {
    // If a noisy stderr line somehow ended up in the input, redact-fixture
    // should not corrupt it. Real fixtures should never contain such lines,
    // but the script must not blow up if they do.
    const input = `not json here\n${JSON.stringify({ ok: true })}`;
    const out = redactJsonl(input).trim().split("\n");
    expect(out[0]).toBe("not json here");
    expect(JSON.parse(out[1]).ok).toBe(true);
  });
});

describe("redactLine (single-line API)", () => {
  it("redacts a single JSON line", () => {
    const out = redactLine(JSON.stringify({ cwd: "/Users/x/y" }));
    expect(JSON.parse(out).cwd).toBe("<CWD>");
  });

  it("returns empty input unchanged", () => {
    expect(redactLine("")).toBe("");
  });
});

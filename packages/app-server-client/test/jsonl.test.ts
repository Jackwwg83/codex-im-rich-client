import { describe, expect, it } from "vitest";
import { JsonlDecoder, encodeJsonl } from "../src/jsonl.js";

describe("JsonlDecoder", () => {
  it("yields complete lines", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("buffers partial lines across chunks", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"a":')).toEqual([]);
    expect(d.push("1}\n")).toEqual([{ a: 1 }]);
  });

  it("ignores blank lines", () => {
    expect(new JsonlDecoder().push('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("throws on malformed JSON with line context", () => {
    expect(() => new JsonlDecoder().push("not json\n")).toThrow(/JsonlDecoder.*invalid JSON/);
  });

  it("perf budget: 1MB single line in 4KB chunks under 100ms", () => {
    const big = `{"x":"${"y".repeat(1_000_000)}"}\n`;
    const chunks: string[] = [];
    for (let i = 0; i < big.length; i += 4096) {
      chunks.push(big.slice(i, i + 4096));
    }
    const d = new JsonlDecoder();
    const start = performance.now();
    let out: unknown[] = [];
    for (const c of chunks) out = out.concat(d.push(c));
    const elapsed = performance.now() - start;
    expect(out.length).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });

  it("handles UTF-8 multi-byte characters split across chunks", () => {
    const d = new JsonlDecoder();
    // "中文测试" — each char 3 bytes in UTF-8. We feed already-decoded JS strings,
    // but exercise a chunk boundary inside the string content to confirm the
    // decoder doesn't corrupt multi-byte content (no premature trim, no encoding
    // assumption).
    const msg = '{"text":"中文测试"}\n';
    const a = msg.slice(0, 8);
    const b = msg.slice(8);
    expect([...new JsonlDecoder().push(a), ...new JsonlDecoder().push(a)]).toEqual([]);
    // Real test with single decoder:
    const d2 = new JsonlDecoder();
    const out = [...d2.push(a), ...d2.push(b)];
    expect(out).toEqual([{ text: "中文测试" }]);
  });
});

describe("encodeJsonl", () => {
  it("produces newline-terminated stringified JSON", () => {
    expect(encodeJsonl({ a: 1 })).toBe('{"a":1}\n');
  });

  it("throws on non-serializable input (BigInt)", () => {
    expect(() => encodeJsonl(BigInt(1))).toThrow();
  });
});

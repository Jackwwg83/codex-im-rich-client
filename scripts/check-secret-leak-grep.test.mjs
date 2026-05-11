import { describe, expect, it } from "vitest";
import { check, main } from "./check-secret-leak-grep.mjs";

describe("check-secret-leak-grep", () => {
  it("flags a `length:` field inside a structured log payload that also redacts a value", () => {
    const src = [
      "function resolveSecret() {",
      "  logger.info({",
      "    event: 'config.secret_resolved',",
      "    value: '***REDACTED***',",
      "    length: secret.length,",
      "  });",
      "}",
    ].join("\n");
    const findings = check(src);
    expect(findings).toHaveLength(1);
    expect(findings[0].src).toContain("length:");
  });

  it("flags `size:` next to ***REDACTED***", () => {
    const src = ["{ value: '***REDACTED***', size: 32 }"].join("\n");
    const findings = check(src);
    expect(findings).toHaveLength(1);
  });

  it("does not flag a `.length === 0` expression unrelated to a redacted log payload", () => {
    const src = [
      "function shortLabel(token) {",
      "  return token.length === 0 ? 'item' : token.slice(0, 80);",
      "}",
    ].join("\n");
    expect(check(src)).toEqual([]);
  });

  it("does not flag a `length:` field that is nowhere near ***REDACTED***", () => {
    const src = [
      "const config = {",
      "  cwd: '/home/me/proj',",
      "  length: 0,",
      "};",
    ].join("\n");
    expect(check(src)).toEqual([]);
  });

  it("does not flag a `present: true` log payload (the post-fix shape)", () => {
    const src = [
      "logger.info({",
      "  event: 'config.secret_resolved',",
      "  value: '***REDACTED***',",
      "  present: true,",
      "});",
    ].join("\n");
    expect(check(src)).toEqual([]);
  });

  it("agrees with the real repo state (regression guard)", () => {
    expect(main()).toBe(0);
  });
});

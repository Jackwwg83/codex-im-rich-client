// T2 (Phase 1): smoke-real-turn argv parsing.
//
// Pure unit test — runs in the default `pnpm test` gate, alongside other
// unit tests. No subprocess, no transport, no codex.
//
// Covers the three new flags from plan §"Task 2: CLI capture flags":
//   --capture <path>      where to write captured JSONL
//   --prompt-file <path>  override the harmless prompt
//   --cwd <path>          working directory for the codex subprocess
//                         (NOT the harness; subprocess-only per plan T2)

import { describe, expect, it } from "vitest";
import { parseSmokeRealTurnArgs } from "../src/smoke-real-turn.js";

describe("parseSmokeRealTurnArgs", () => {
  it("returns empty options when no flags are passed", () => {
    expect(parseSmokeRealTurnArgs([])).toEqual({});
  });

  it("accepts --capture <path>", () => {
    expect(parseSmokeRealTurnArgs(["--capture", "/tmp/out.jsonl"])).toEqual({
      capturePath: "/tmp/out.jsonl",
    });
  });

  it("accepts --prompt-file <path>", () => {
    expect(
      parseSmokeRealTurnArgs(["--prompt-file", "packages/cli/src/prompts/richer-turn.txt"]),
    ).toEqual({ promptFile: "packages/cli/src/prompts/richer-turn.txt" });
  });

  it("accepts --cwd <path> for the codex subprocess working dir", () => {
    expect(parseSmokeRealTurnArgs(["--cwd", "/tmp/codex-fixture-spike"])).toEqual({
      subprocessCwd: "/tmp/codex-fixture-spike",
    });
  });

  it("accepts all three together in any order", () => {
    expect(
      parseSmokeRealTurnArgs([
        "--cwd",
        "/tmp/x",
        "--capture",
        "/tmp/cap.jsonl",
        "--prompt-file",
        "p.txt",
      ]),
    ).toEqual({
      subprocessCwd: "/tmp/x",
      capturePath: "/tmp/cap.jsonl",
      promptFile: "p.txt",
    });
  });

  it("rejects unknown flags loudly", () => {
    expect(() => parseSmokeRealTurnArgs(["--bogus"])).toThrow(/unknown flag.*--bogus/);
  });

  it("rejects --capture without a value", () => {
    expect(() => parseSmokeRealTurnArgs(["--capture"])).toThrow(/--capture.*missing value/i);
  });

  it("rejects --prompt-file without a value", () => {
    expect(() => parseSmokeRealTurnArgs(["--prompt-file"])).toThrow(
      /--prompt-file.*missing value/i,
    );
  });

  it("rejects --cwd without a value", () => {
    expect(() => parseSmokeRealTurnArgs(["--cwd"])).toThrow(/--cwd.*missing value/i);
  });

  it("rejects --capture followed by another flag (treats next flag as missing value)", () => {
    // If user types `--capture --cwd /tmp`, that's a typo — refuse to silently
    // treat "--cwd" as the path.
    expect(() => parseSmokeRealTurnArgs(["--capture", "--cwd", "/tmp/x"])).toThrow(
      /--capture.*missing value/i,
    );
  });
});

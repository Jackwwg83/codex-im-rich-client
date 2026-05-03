import { describe, expect, it } from "vitest";
import { assertNoSecretMaterial, buildReleaseReadinessSteps } from "./release-readiness-check.mts";

describe("release-readiness-check (JAC-169)", () => {
  it("includes mandatory CI gates before operational dry-run checks by default", () => {
    const ids = buildReleaseReadinessSteps().map((step) => step.id);

    expect(ids.slice(0, 8)).toEqual([
      "check-codex-version",
      "typecheck",
      "typecheck-tests",
      "test",
      "test-cli-smoke",
      "lint",
      "protocol-check",
      "verify-fixtures",
    ]);
    expect(ids).toContain("launchd-install-dry-run");
    expect(ids).toContain("load-and-run-dry-run");
    expect(ids).toContain("db-backup-proof");
    expect(ids).toContain("smoke-telegram-live-default-gate");
    expect(ids).toContain("smoke-computer-use-default-skip");
  });

  it("can build an ops-only plan without CI gates for fast local dry-run checks", () => {
    const ids = buildReleaseReadinessSteps({ includeFullGates: false }).map((step) => step.id);

    expect(ids).not.toContain("typecheck");
    expect(ids[0]).toBe("launchd-install-dry-run");
  });

  it("treats Telegram live smokes as explicit default gates, not default live calls", () => {
    const telegram = buildReleaseReadinessSteps({ includeFullGates: false }).filter((step) =>
      step.id.startsWith("smoke-telegram"),
    );

    expect(telegram.map((step) => [step.id, step.expectedExitCodes])).toContainEqual([
      "smoke-telegram-live-default-gate",
      [1],
    ]);
    expect(telegram.map((step) => [step.id, step.expectedExitCodes])).toContainEqual([
      "smoke-telegram-real-default-gate",
      [1],
    ]);
  });

  it("fails if command output contains token-shaped material", () => {
    expect(() =>
      assertNoSecretMaterial("leaked 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"),
    ).toThrow(/token-shaped/);
    expect(() => assertNoSecretMaterial("Authorization: Bearer secret-token-abcdef")).toThrow(
      /token-shaped/,
    );
  });
});

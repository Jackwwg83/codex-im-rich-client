import { describe, expect, it } from "vitest";
import {
  assertNoSecretMaterial,
  buildReleaseReadinessSteps,
  buildStepEnv,
} from "./release-readiness-check.mts";

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

  it("keeps operational temp fixture setup lazy until a step runs", () => {
    const steps = buildReleaseReadinessSteps({ includeFullGates: false });
    const keychain = steps.find((step) => step.id === "load-and-run-dry-run");
    const backup = steps.find((step) => step.id === "db-backup-proof");

    expect(keychain?.env).toBeUndefined();
    expect(keychain?.prepare).toEqual(expect.any(Function));
    expect(backup?.args).toEqual(["db:backup", "--"]);
    expect(backup?.prepare).toEqual(expect.any(Function));
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

  it("clears ambient live-smoke env before default live-gate checks", () => {
    const hostileEnv = {
      TELEGRAM_LIVE: "1",
      TELEGRAM_LIVE_DURATION_MS: "0",
      IM_TELEGRAM_BOT_TOKEN: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      CODEX_REAL_SMOKE: "1",
      CODEX_REAL_SMOKE_PROMPT: "real prompt",
      LARK_LIVE: "1",
      LARK_LIVE_DRY_RUN: "1",
      LARK_APP_ID: "app-id",
      LARK_APP_SECRET_ENV: "LARK_APP_SECRET",
      LARK_APP_SECRET: "secret",
      LARK_TARGET_CHAT_ID: "chat-id",
      LARK_LIVE_TEXT: "text",
      DINGTALK_LIVE: "1",
      DINGTALK_LIVE_DRY_RUN: "1",
      DINGTALK_CLIENT_ID: "client-id",
      DINGTALK_CLIENT_SECRET_ENV: "DINGTALK_CLIENT_SECRET",
      DINGTALK_CLIENT_SECRET: "secret",
      COMPUTER_USE_LIVE: "1",
      COMPUTER_USE_PROVIDER_VERIFIED: "1",
      COMPUTER_USE_LIVE_DRY_RUN: "1",
      COMPUTER_USE_LIVE_APP: "Google Chrome",
      COMPUTER_USE_LIVE_TASK: "open a page",
      PATH: "/usr/bin",
    };
    const defaultLiveStepIds = [
      "smoke-telegram-live-default-gate",
      "smoke-telegram-real-default-gate",
      "smoke-lark-live-default-skip",
      "smoke-dingtalk-live-default-skip",
      "smoke-computer-use-default-skip",
    ];

    for (const step of buildReleaseReadinessSteps({ includeFullGates: false }).filter((item) =>
      defaultLiveStepIds.includes(item.id),
    )) {
      const env = buildStepEnv(step, hostileEnv);

      expect(env.PATH).toBe("/usr/bin");
      expect(env.TELEGRAM_LIVE).toBeUndefined();
      expect(env.IM_TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(env.CODEX_REAL_SMOKE).toBeUndefined();
      expect(env.LARK_LIVE).toBeUndefined();
      expect(env.LARK_APP_SECRET_ENV).toBeUndefined();
      expect(env.LARK_APP_SECRET).toBeUndefined();
      expect(env.DINGTALK_LIVE).toBeUndefined();
      expect(env.DINGTALK_CLIENT_SECRET_ENV).toBeUndefined();
      expect(env.DINGTALK_CLIENT_SECRET).toBeUndefined();
      expect(env.COMPUTER_USE_LIVE).toBeUndefined();
      expect(env.COMPUTER_USE_LIVE_DRY_RUN).toBeUndefined();
    }
  });

  it("requires default live-skip commands to prove gate-disabled output", () => {
    const steps = buildReleaseReadinessSteps({ includeFullGates: false });
    const skipIds = [
      "smoke-lark-live-default-skip",
      "smoke-dingtalk-live-default-skip",
      "smoke-computer-use-default-skip",
    ];
    const safeSkipOutput = [
      "{",
      '  "status": "skip",',
      '  "gate": "disabled"',
      "}",
      "[smoke] SKIP: disabled.",
    ].join("\n");
    const unsafeDryRunOutput = [
      "{",
      '  "status": "ready_dry_run",',
      '  "gate": "enabled"',
      "}",
      "[smoke] READY_DRY_RUN: no network call made.",
    ].join("\n");

    for (const step of steps.filter((item) => skipIds.includes(item.id))) {
      expect(step.safeOutputPattern).toBeDefined();
      expect(step.safeOutputPattern?.test(safeSkipOutput)).toBe(true);
      expect(step.safeOutputPattern?.test(unsafeDryRunOutput)).toBe(false);
    }
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

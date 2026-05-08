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
    expect(ids.slice(8, 14)).toEqual([
      "bridge-build",
      "bridge-install-dry-run",
      "bridge-install",
      "launchd-install-dry-run",
      "load-and-run-dry-run",
      "bridge-redaction-scan",
    ]);
    expect(ids).toContain("launchd-install-dry-run");
    expect(ids).toContain("load-and-run-dry-run");
    expect(ids).toContain("bridge-redaction-scan");
    expect(ids).toContain("db-backup-proof");
    expect(ids).toContain("smoke-daemon-roundtrip");
    expect(ids).toContain("smoke-telegram-live-default-gate");
    expect(ids).toContain("smoke-telegram-live-roundtrip-default-gate");
    expect(ids).toContain("smoke-slack-live-default-skip");
    expect(ids).toContain("smoke-computer-use-default-skip");
  });

  it("can build an ops-only plan without CI gates for fast local dry-run checks", () => {
    const ids = buildReleaseReadinessSteps({ includeFullGates: false }).map((step) => step.id);

    expect(ids).not.toContain("typecheck");
    expect(ids[0]).toBe("bridge-build");
  });

  it("keeps operational temp fixture setup lazy until a step runs", () => {
    const steps = buildReleaseReadinessSteps({ includeFullGates: false });
    const bridgeDryRun = steps.find((step) => step.id === "bridge-install-dry-run");
    const bridgeInstall = steps.find((step) => step.id === "bridge-install");
    const launchd = steps.find((step) => step.id === "launchd-install-dry-run");
    const keychain = steps.find((step) => step.id === "load-and-run-dry-run");
    const redaction = steps.find((step) => step.id === "bridge-redaction-scan");
    const roundtrip = steps.find((step) => step.id === "smoke-daemon-roundtrip");
    const backup = steps.find((step) => step.id === "db-backup-proof");

    expect(bridgeDryRun?.prepare).toEqual(expect.any(Function));
    expect(bridgeInstall?.prepare).toEqual(expect.any(Function));
    expect(launchd?.prepare).toEqual(expect.any(Function));
    expect(keychain?.env).toBeUndefined();
    expect(keychain?.prepare).toEqual(expect.any(Function));
    expect(redaction?.prepare).toEqual(expect.any(Function));
    expect(roundtrip?.prepare).toEqual(expect.any(Function));
    expect(backup?.args).toEqual(["db:backup", "--"]);
    expect(backup?.prepare).toEqual(expect.any(Function));
  });

  it("uses one shared temp HOME for bridge install, launchd dry-run, wrapper dry-run, redaction scan, and daemon roundtrip", () => {
    const steps = buildReleaseReadinessSteps({ includeFullGates: false });
    const bridgeDryRun = steps.find((step) => step.id === "bridge-install-dry-run");
    const bridgeInstall = steps.find((step) => step.id === "bridge-install");
    const launchd = steps.find((step) => step.id === "launchd-install-dry-run");
    const keychain = steps.find((step) => step.id === "load-and-run-dry-run");
    const redaction = steps.find((step) => step.id === "bridge-redaction-scan");
    const roundtrip = steps.find((step) => step.id === "smoke-daemon-roundtrip");

    const dryArgs = bridgeDryRun?.prepare?.().args ?? [];
    const installArgs = bridgeInstall?.prepare?.().args ?? [];
    const launchdArgs = launchd?.prepare?.().args ?? [];
    const keychainEnv = keychain?.prepare?.().env ?? {};
    const redactionEnv = redaction?.prepare?.().env ?? {};
    const roundtripEnv = roundtrip?.prepare?.().env ?? {};
    const home = dryArgs[dryArgs.indexOf("--home") + 1];

    expect(home).toBeDefined();
    expect(installArgs).toContain(home);
    expect(launchdArgs).toContain(home);
    expect(keychainEnv.DAEMON_ENTRY).toBe(`${home}/.codex-im-bridge/app/daemon.mjs`);
    expect(keychainEnv.CONFIG_PATH).toBe(`${home}/.codex-im-bridge/config.toml`);
    expect(redactionEnv.BRIDGE_HOME).toBe(home);
    expect(redactionEnv.BRIDGE_DAEMON).toBe(`${home}/.codex-im-bridge/app/daemon.mjs`);
    expect(roundtripEnv.CODEX_IM_SMOKE_MIGRATIONS_DIR).toBe(
      `${home}/.codex-im-bridge/app/migrations`,
    );
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
      "smoke-telegram-live-roundtrip-default-gate",
      [1],
    ]);
    expect(telegram.map((step) => [step.id, step.expectedExitCodes])).toContainEqual([
      "smoke-telegram-side-by-side-default-gate",
      [1],
    ]);
  });

  it("clears ambient live-smoke env before default live-gate checks", () => {
    const hostileEnv = {
      TELEGRAM_LIVE: "1",
      TELEGRAM_LIVE_FILE: "1",
      TELEGRAM_LIVE_INBOUND_ATTACHMENT: "1",
      TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND: "file",
      TELEGRAM_LIVE_TARGET_CHAT_ID: "12345",
      TELEGRAM_LIVE_ROUNDTRIP: "1",
      TELEGRAM_LIVE_DURATION_MS: "0",
      IM_TELEGRAM_BOT_TOKEN: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      TELEGRAM_ROUNDTRIP_ALLOWED_CHAT_ID: "-1001",
      TELEGRAM_ROUNDTRIP_ALLOWED_USER_ID: "42",
      TELEGRAM_ROUNDTRIP_NONCE: "abc123",
      TELEGRAM_ROUNDTRIP_TIMEOUT_MS: "1000",
      CODEX_REAL_SMOKE: "1",
      CODEX_REAL_SMOKE_PROMPT: "real prompt",
      LARK_LIVE: "1",
      LARK_LIVE_FILE: "1",
      LARK_LIVE_INBOUND_ATTACHMENT: "1",
      LARK_LIVE_INBOUND_ATTACHMENT_KIND: "image",
      LARK_LIVE_DURATION_MS: "0",
      LARK_LIVE_DRY_RUN: "1",
      LARK_APP_ID: "app-id",
      LARK_APP_SECRET_ENV: "LARK_APP_SECRET",
      LARK_APP_SECRET: "secret",
      LARK_TARGET_CHAT_ID: "chat-id",
      LARK_LIVE_TEXT: "text",
      DINGTALK_LIVE: "1",
      DINGTALK_LIVE_DRY_RUN: "1",
      DINGTALK_LIVE_INBOUND_ATTACHMENT: "1",
      DINGTALK_LIVE_INBOUND_ATTACHMENT_KIND: "file",
      DINGTALK_CLIENT_ID: "client-id",
      DINGTALK_CLIENT_SECRET_ENV: "DINGTALK_CLIENT_SECRET",
      DINGTALK_CLIENT_SECRET: "secret",
      SLACK_LIVE: "1",
      SLACK_LIVE_DRY_RUN: "1",
      SLACK_LIVE_TEXT: "status",
      SLACK_LIVE_FILE: "1",
      SLACK_TARGET_CHANNEL_ID: "C_TEST",
      SLACK_BOT_TOKEN: "xoxb-test-token",
      SLACK_APP_TOKEN: "xapp-test-token",
      SLACK_BOT_TOKEN_ENV: "SLACK_BOT_TOKEN",
      COMPUTER_USE_LIVE: "1",
      COMPUTER_USE_PROVIDER_VERIFIED: "1",
      COMPUTER_USE_LIVE_DRY_RUN: "1",
      COMPUTER_USE_LIVE_APP: "Google Chrome",
      COMPUTER_USE_LIVE_TASK: "open a page",
      PATH: "/usr/bin",
    };
    const defaultLiveStepIds = [
      "smoke-telegram-live-default-gate",
      "smoke-telegram-live-roundtrip-default-gate",
      "smoke-telegram-side-by-side-default-gate",
      "smoke-lark-live-default-skip",
      "smoke-dingtalk-live-default-skip",
      "smoke-slack-live-default-skip",
      "smoke-computer-use-default-skip",
    ];

    for (const step of buildReleaseReadinessSteps({ includeFullGates: false }).filter((item) =>
      defaultLiveStepIds.includes(item.id),
    )) {
      const env = buildStepEnv(step, hostileEnv);

      expect(env.PATH).toBe("/usr/bin");
      expect(env.TELEGRAM_LIVE).toBeUndefined();
      expect(env.TELEGRAM_LIVE_FILE).toBeUndefined();
      expect(env.TELEGRAM_LIVE_INBOUND_ATTACHMENT).toBeUndefined();
      expect(env.TELEGRAM_LIVE_INBOUND_ATTACHMENT_KIND).toBeUndefined();
      expect(env.TELEGRAM_LIVE_TARGET_CHAT_ID).toBeUndefined();
      expect(env.TELEGRAM_LIVE_ROUNDTRIP).toBeUndefined();
      expect(env.IM_TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(env.TELEGRAM_ROUNDTRIP_ALLOWED_CHAT_ID).toBeUndefined();
      expect(env.TELEGRAM_ROUNDTRIP_ALLOWED_USER_ID).toBeUndefined();
      expect(env.TELEGRAM_ROUNDTRIP_NONCE).toBeUndefined();
      expect(env.TELEGRAM_ROUNDTRIP_TIMEOUT_MS).toBeUndefined();
      expect(env.CODEX_REAL_SMOKE).toBeUndefined();
      expect(env.LARK_LIVE).toBeUndefined();
      expect(env.LARK_LIVE_FILE).toBeUndefined();
      expect(env.LARK_LIVE_INBOUND_ATTACHMENT).toBeUndefined();
      expect(env.LARK_LIVE_INBOUND_ATTACHMENT_KIND).toBeUndefined();
      expect(env.LARK_LIVE_DURATION_MS).toBeUndefined();
      expect(env.LARK_APP_SECRET_ENV).toBeUndefined();
      expect(env.LARK_APP_SECRET).toBeUndefined();
      expect(env.DINGTALK_LIVE).toBeUndefined();
      expect(env.DINGTALK_LIVE_INBOUND_ATTACHMENT).toBeUndefined();
      expect(env.DINGTALK_LIVE_INBOUND_ATTACHMENT_KIND).toBeUndefined();
      expect(env.DINGTALK_CLIENT_SECRET_ENV).toBeUndefined();
      expect(env.DINGTALK_CLIENT_SECRET).toBeUndefined();
      expect(env.SLACK_LIVE).toBeUndefined();
      expect(env.SLACK_LIVE_DRY_RUN).toBeUndefined();
      expect(env.SLACK_LIVE_TEXT).toBeUndefined();
      expect(env.SLACK_LIVE_FILE).toBeUndefined();
      expect(env.SLACK_TARGET_CHANNEL_ID).toBeUndefined();
      expect(env.SLACK_BOT_TOKEN).toBeUndefined();
      expect(env.SLACK_APP_TOKEN).toBeUndefined();
      expect(env.SLACK_BOT_TOKEN_ENV).toBeUndefined();
      expect(env.COMPUTER_USE_LIVE).toBeUndefined();
      expect(env.COMPUTER_USE_LIVE_DRY_RUN).toBeUndefined();
    }
  });

  it("requires default live-skip commands to prove gate-disabled output", () => {
    const steps = buildReleaseReadinessSteps({ includeFullGates: false });
    const skipIds = [
      "smoke-lark-live-default-skip",
      "smoke-dingtalk-live-default-skip",
      "smoke-slack-live-default-skip",
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

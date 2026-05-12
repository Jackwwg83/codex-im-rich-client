import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseConfigToml } from "../packages/config/src/index.js";
import { type SetupAnswers, buildSetupPlan, keychainServiceForSecret } from "./setup-im.mts";

describe("setup-im wizard planning", () => {
  it("generates a Telegram config without writing the bot token into TOML", () => {
    const plan = buildSetupPlan({
      now: new Date("2026-05-08T07:30:00.000Z"),
      home: "/Users/operator",
      existingConfigPresent: true,
      answers: baseAnswers({
        platform: "telegram",
        telegramBotToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
      }),
    });

    expect(plan.configPath).toBe("/Users/operator/.codex-im-bridge/config.toml");
    expect(plan.backupPath).toBe(
      "/Users/operator/.codex-im-bridge/config.toml.bak-20260508-073000",
    );
    expect(plan.configToml).not.toContain("1234567890:");
    expect(plan.configToml).toContain('bot_token_env = "IM_TELEGRAM_BOT_TOKEN"');
    expect(plan.keychainWrites).toEqual([
      {
        service: "codex-im-bridge",
        account: "operator",
        envName: "IM_TELEGRAM_BOT_TOKEN",
        secret: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
      },
    ]);

    const config = parseConfigToml(plan.configToml);
    expect(config.adapters.telegram.enabled).toBe(true);
    expect(config.security.allowedUsers).toContain("telegram:user-123");
    expect(config.projects["codex-im"]?.cwd).toBe("/Users/operator/src/codex-im");
  });

  it("plans two Slack Keychain writes and keeps both tokens out of config", () => {
    const plan = buildSetupPlan({
      now: new Date("2026-05-08T07:30:00.000Z"),
      home: "/Users/operator",
      existingConfigPresent: false,
      answers: baseAnswers({
        platform: "slack",
        allowedUserId: "T_TEST:U_TEST",
        allowedChatId: "T_TEST:C_TEST",
        slackBotToken: "xoxb-redacted-test-token",
        slackAppToken: "xapp-redacted-test-token",
      }),
    });

    expect(plan.backupPath).toBeUndefined();
    expect(plan.configToml).not.toContain("xoxb-redacted");
    expect(plan.configToml).not.toContain("xapp-redacted");
    expect(plan.configToml).toContain('bot_token_env = "SLACK_BOT_TOKEN"');
    expect(plan.configToml).toContain('app_token_env = "SLACK_APP_TOKEN"');
    expect(plan.keychainWrites.map((write) => write.service)).toEqual([
      "codex-im-bridge-slack-bot",
      "codex-im-bridge-slack-app",
    ]);

    const config = parseConfigToml(plan.configToml);
    expect(config.adapters.slack.enabled).toBe(true);
    expect(config.adapters.slack.allowedChannelIds).toEqual(["T_TEST:C_TEST"]);
    expect(config.projects["codex-im"]?.allowedChats).toContain("slack:T_TEST:C_TEST");
  });

  it("documents the stable Keychain service for each secret", () => {
    expect(keychainServiceForSecret("telegramBotToken")).toBe("codex-im-bridge");
    expect(keychainServiceForSecret("larkAppSecret")).toBe("codex-im-bridge-lark");
    expect(keychainServiceForSecret("dingtalkClientSecret")).toBe("codex-im-bridge-dingtalk");
    expect(keychainServiceForSecret("slackBotToken")).toBe("codex-im-bridge-slack-bot");
    expect(keychainServiceForSecret("slackAppToken")).toBe("codex-im-bridge-slack-app");
  });

  it("defaults customer IM output to normal mode and warns when setup points at this bridge repo", () => {
    const plan = buildSetupPlan({
      now: new Date("2026-05-08T07:30:00.000Z"),
      home: "/Users/operator",
      existingConfigPresent: false,
      answers: baseAnswers({
        projectName: "bridge",
        projectCwd: "/Users/operator/src/codex-im-rich-client",
        telegramBotToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
      }),
    });

    const config = parseConfigToml(plan.configToml);
    expect(config.im.output.mode).toBe("normal");
    expect(plan.configToml).toContain("[im.output]");
    expect(plan.configToml).toContain('mode = "normal"');
    expect(plan.warnings).toContain(
      "Project cwd points at codex-im-rich-client. For customer use, choose the application repo you want Codex to operate on.",
    );
  });

  it("accepts piped input for dry-run setup without echoing secrets", () => {
    const secret = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
    const result = spawnSync(
      "pnpm",
      [
        "--silent",
        "exec",
        "tsx",
        "scripts/setup-im.mts",
        "--platform",
        "telegram",
        "--dry-run",
        "--no-keychain",
        "--no-doctor",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: [
          "codex-im",
          "/Users/operator/src/codex-im",
          "user-123",
          "chat-456",
          "codex",
          "0.130.0",
          secret,
          "",
        ].join("\n"),
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("setup:im plan");
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(result.stdout).toMatch(
      /IM_TELEGRAM_BOT_TOKEN: Keychain service \S+, account \S+, present/,
    );
    expect(result.stdout).not.toMatch(/length=\d+/);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  });
});

function baseAnswers(input: Partial<SetupAnswers> = {}): SetupAnswers {
  return {
    platform: "telegram",
    projectName: "codex-im",
    projectCwd: "/Users/operator/src/codex-im",
    allowedUserId: "user-123",
    allowedChatId: "chat-456",
    codexBinary: "codex",
    codexVersion: "0.130.0",
    telegramBotToken: "",
    larkAppId: "cli_lark_test",
    larkAppSecret: "",
    larkDomain: "feishu",
    dingtalkClientId: "ding_test",
    dingtalkClientSecret: "",
    dingtalkCardTemplateId: "card_template_test",
    slackBotToken: "",
    slackAppToken: "",
    ...input,
  };
}

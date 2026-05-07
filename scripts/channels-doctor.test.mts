import { describe, expect, it } from "vitest";
import type { CodexImConfig } from "../packages/config/src/index.js";
import { evaluateChannelsDoctor, formatChannelsDoctorReport } from "./channels-doctor.mts";

describe("channels doctor (JAC-237)", () => {
  it("reports local per-platform readiness without leaking secret values", () => {
    const report = evaluateChannelsDoctor({
      config: makeConfig(),
      configPath: "/Users/operator/.codex-im-bridge/config.toml",
      env: {
        IM_TELEGRAM_BOT_TOKEN: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
        IM_LARK_APP_SECRET: "sk-testsecret1234567890abcdef",
        SLACK_BOT_TOKEN: "xoxb-test-secret-never-log",
        SLACK_APP_TOKEN: "xapp-test-secret-never-log",
      },
      keychainSecretPresent: (service) => service === "codex-im-bridge-dingtalk",
      installed: {
        plistPresent: true,
        daemonStatus: {
          pid: 4242,
          startedAt: "2026-05-06T10:00:00.000Z",
          currentCodexThreadCount: 2,
          pendingApprovalCount: 0,
        },
      },
    });

    const output = formatChannelsDoctorReport(report);

    expect(report.status).toBe("ready");
    expect(output).toContain("im doctor: ready");
    expect(output).toContain("telegram: ready");
    expect(output).toContain("lark: ready");
    expect(output).toContain("dingtalk: ready");
    expect(output).toContain("slack: ready");
    expect(output).toContain(
      "adapter_start: info (not checked by default; use DingTalk live gate)",
    );
    expect(output).toContain("socket_mode: info (not checked by default; use Slack live gate)");
    expect(output).toContain("slash_command: info (/codex ingress supported by adapter)");
    expect(output).toContain(
      "callback_click: info (not checked by default; use DINGTALK_LIVE_CARD_CALLBACK=1 with a real client click)",
    );
    expect(output).toContain(
      "daemon.status: pass (running pid=4242 codexThreads=2 pendingApprovals=0)",
    );
    expect(output).toContain(
      "edit_semantics: info (text refs append by lifecycle contract with progress edits suppressed; card refs update through CardKit)",
    );
    expect(output).toContain(
      "file: info (outbound files/images supported; live send not checked by default)",
    );
    expect(output).toContain(
      "file: info (outbound files/images supported after inbound session reply URL; live send not checked by default)",
    );
    expect(output).not.toContain("attachments unsupported");
    expect(output).not.toContain("1234567890:");
    expect(output).not.toContain("sk-testsecret");
    expect(output).not.toContain("xoxb-test");
    expect(output).not.toContain("xapp-test");
  });

  it("blocks when enabled adapters are missing local secret sources or allowlists", () => {
    const config = makeConfig({
      telegramEnabled: true,
      larkEnabled: false,
      dingtalkEnabled: false,
      slackEnabled: false,
      securityAllowedUsers: [],
      securityAllowedChats: [],
      projectAllowedUsers: [],
      projectAllowedChats: [],
    });
    const report = evaluateChannelsDoctor({
      config,
      configPath: "/tmp/config.toml",
      env: {},
      keychainSecretPresent: () => false,
      installed: { plistPresent: false },
    });

    const output = formatChannelsDoctorReport(report);

    expect(report.status).toBe("blocked");
    expect(output).toContain("telegram: blocked");
    expect(output).toContain(
      "secret: fail (missing from env IM_TELEGRAM_BOT_TOKEN and Keychain service codex-im-bridge)",
    );
    expect(output).toContain("security.allowlist: fail (no telegram allowed user/chat)");
    expect(output).toContain("lark: disabled");
    expect(output).toContain("dingtalk: disabled");
    expect(output).toContain("slack: disabled");
  });

  it("blocks enabled Slack when either Socket Mode token source or allowlist is missing", () => {
    const config = makeConfig({
      telegramEnabled: false,
      larkEnabled: false,
      dingtalkEnabled: false,
      slackEnabled: true,
      securityAllowedUsers: ["slack:T_TEST:U_TEST"],
      securityAllowedChats: ["slack:T_TEST:C_TEST"],
      projectAllowedUsers: [],
      projectAllowedChats: [],
    });
    const report = evaluateChannelsDoctor({
      config,
      configPath: "/tmp/config.toml",
      env: { SLACK_BOT_TOKEN: "xoxb-secret-never-log" },
      keychainSecretPresent: () => false,
      installed: { plistPresent: false },
    });

    const output = formatChannelsDoctorReport(report);

    expect(report.status).toBe("blocked");
    expect(output).toContain("slack: blocked");
    expect(output).toContain(
      "app_token: fail (missing from env SLACK_APP_TOKEN and Keychain service codex-im-bridge-slack-app)",
    );
    expect(output).toContain("project.allowlist: fail (no project allows slack user/chat)");
    expect(output).not.toContain("xoxb-secret");
  });
});

function makeConfig(
  input: {
    readonly telegramEnabled?: boolean;
    readonly larkEnabled?: boolean;
    readonly dingtalkEnabled?: boolean;
    readonly slackEnabled?: boolean;
    readonly securityAllowedUsers?: string[];
    readonly securityAllowedChats?: string[];
    readonly projectAllowedUsers?: string[];
    readonly projectAllowedChats?: string[];
  } = {},
): CodexImConfig {
  const securityAllowedUsers = input.securityAllowedUsers ?? [
    "telegram:user",
    "lark:user",
    "dingtalk:user",
    "slack:T_TEST:U_TEST",
  ];
  const securityAllowedChats = input.securityAllowedChats ?? [
    "telegram:chat",
    "lark:chat",
    "dingtalk:chat",
    "slack:T_TEST:C_TEST",
  ];
  const projectAllowedUsers = input.projectAllowedUsers ?? [
    "telegram:user",
    "lark:user",
    "dingtalk:user",
    "slack:T_TEST:U_TEST",
  ];
  const projectAllowedChats = input.projectAllowedChats ?? [
    "telegram:chat",
    "lark:chat",
    "dingtalk:chat",
    "slack:T_TEST:C_TEST",
  ];

  return {
    daemon: {
      dataDir: "/Users/operator/.codex-im-bridge",
      logDir: "/Users/operator/.codex-im-bridge/logs",
    },
    storage: { sqlitePath: "/Users/operator/.codex-im-bridge/state.db", autoMigrate: true },
    codex: { binary: "codex", versionPin: "0.128.0" },
    security: {
      allowedUsers: securityAllowedUsers,
      allowedChats: securityAllowedChats,
      adminUsers: securityAllowedUsers,
      commands: { denyPatterns: [], requireAdminPatterns: [] },
    },
    computerUse: {
      enabled: false,
      requireExplicitPrefix: true,
      defaultApp: "Google Chrome",
      allowedApps: ["Google Chrome"],
      denyApps: [],
      unknownAppPolicy: "deny",
      requireApprovalKeywords: [],
      liveSmokeEnabled: false,
    },
    adapters: {
      telegram: { enabled: input.telegramEnabled ?? true, botTokenEnv: "IM_TELEGRAM_BOT_TOKEN" },
      lark: {
        enabled: input.larkEnabled ?? true,
        appId: "cli_test",
        appSecretEnv: "IM_LARK_APP_SECRET",
        domain: "feishu",
        allowedChatIds: ["chat"],
      },
      dingtalk: {
        enabled: input.dingtalkEnabled ?? true,
        clientId: "ding_test",
        clientSecretEnv: "DINGTALK_CLIENT_SECRET",
        cardTemplateId: "card_template",
      },
      slack: {
        enabled: input.slackEnabled ?? true,
        botTokenEnv: "SLACK_BOT_TOKEN",
        appTokenEnv: "SLACK_APP_TOKEN",
        allowedChannelIds: ["T_TEST:C_TEST"],
      },
    },
    projects: {
      "codex-im": {
        cwd: "/Users/operator/project",
        allowedUsers: projectAllowedUsers,
        allowedChats: projectAllowedChats,
        writableRoots: ["/Users/operator/project"],
      },
    },
  };
}

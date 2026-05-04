import { describe, expect, it } from "vitest";
import type { CodexImConfig } from "../packages/config/src/index.js";
import { evaluateDingTalkReadiness, formatDingTalkReadinessReport } from "./dingtalk-readiness.mts";

describe("dingtalk-readiness", () => {
  it("reports blocked without leaking credentials when direct-use config is incomplete", () => {
    const report = evaluateDingTalkReadiness({
      config: makeConfig({
        dingtalk: {
          enabled: false,
          clientId: "disabled",
          clientSecretEnv: "DINGTALK_CLIENT_SECRET",
        },
        securityAllowedUsers: ["telegram:user"],
        securityAllowedChats: ["telegram:chat"],
        projectAllowedUsers: ["lark:user"],
        projectAllowedChats: ["lark:chat"],
      }),
      keychainSecretPresent: true,
    });

    expect(report.status).toBe("blocked");
    expect(formatDingTalkReadinessReport(report, { configPath: "/tmp/config.toml" })).toBe(
      [
        "dingtalk readiness: blocked",
        "config: /tmp/config.toml",
        "adapter.enabled: fail (disabled)",
        "client_id: fail (missing)",
        "client_secret: pass (present via Keychain service codex-im-bridge-dingtalk)",
        "card_template_id: fail (missing)",
        "robot_code: info (derived_from_client_id)",
        "security.allowlist: fail (no dingtalk allowed user/chat)",
        "project.allowlist: fail (no project allows dingtalk user/chat)",
      ].join("\n"),
    );
  });

  it("reports ready when local config, secret source, card template, and allowlists are present", () => {
    const report = evaluateDingTalkReadiness({
      config: makeConfig({
        dingtalk: {
          enabled: true,
          clientId: "ding_test_client_id",
          clientSecretEnv: "DINGTALK_CLIENT_SECRET",
          cardTemplateId: "card_template_test",
        },
        securityAllowedUsers: ["dingtalk:staff_test"],
        securityAllowedChats: [],
        projectAllowedUsers: [],
        projectAllowedChats: ["dingtalk:staff_test"],
      }),
      env: { DINGTALK_CLIENT_SECRET: "not-printed" },
      keychainSecretPresent: false,
    });

    expect(report.status).toBe("ready");
    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
  });
});

function makeConfig(input: {
  readonly dingtalk: CodexImConfig["adapters"]["dingtalk"];
  readonly securityAllowedUsers: string[];
  readonly securityAllowedChats: string[];
  readonly projectAllowedUsers: string[];
  readonly projectAllowedChats: string[];
}): CodexImConfig {
  return {
    daemon: { dataDir: "/tmp/codex-im", logDir: "/tmp/codex-im/logs" },
    storage: { sqlitePath: "/tmp/codex-im/state.db", autoMigrate: true },
    codex: { binary: "codex", versionPin: "0.128.0" },
    security: {
      allowedUsers: input.securityAllowedUsers,
      allowedChats: input.securityAllowedChats,
      adminUsers: input.securityAllowedUsers,
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
      telegram: { enabled: false, botTokenEnv: "IM_TELEGRAM_BOT_TOKEN" },
      lark: {
        enabled: false,
        appId: "cli_test",
        appSecretEnv: "IM_LARK_APP_SECRET",
        domain: "feishu",
        allowedChatIds: [],
      },
      dingtalk: input.dingtalk,
    },
    projects: {
      "codex-im": {
        cwd: "/Users/jackwu/projects/codex-im-rich-client",
        allowedUsers: input.projectAllowedUsers,
        allowedChats: input.projectAllowedChats,
        writableRoots: ["/Users/jackwu/projects/codex-im-rich-client"],
      },
    },
  };
}

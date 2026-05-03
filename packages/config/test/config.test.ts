import { describe, expect, it } from "vitest";
import { parseConfigToml, resolveConfigSecrets, resolveEnvReferences } from "../src/index.js";

const EXAMPLE_CONFIG = `
[daemon]
data_dir = "~/.codex-im-bridge"
log_dir  = "~/.codex-im-bridge/logs"

[storage]
sqlite_path  = "~/.codex-im-bridge/state.db"
auto_migrate = false

[codex]
binary = "codex"
version_pin = "0.128.0"

[security]
allowed_users = ["telegram:123456789"]
allowed_chats = ["telegram:-100123456"]
admin_users   = ["telegram:123456789"]

[security.commands]
deny_patterns          = ["rm -rf /", "sudo ", "chmod -R 777"]
require_admin_patterns = ["git push", "gh pr merge"]

[computer_use]
enabled = false
require_explicit_prefix = true
default_app = "Google Chrome"
allowed_apps = ["Google Chrome"]
deny_apps = ["1Password", "Keychain Access", "System Settings", "Terminal"]
unknown_app_policy = "deny"
require_approval_keywords = ["login", "password", "token"]
live_smoke_enabled = false

[adapters.telegram]
enabled       = true
bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

[adapters.lark]
enabled                = true
app_id                 = "cli_test_app_id"
app_secret_env         = "LARK_APP_SECRET"
domain                 = "feishu"
encrypt_key_env        = "LARK_ENCRYPT_KEY"
verification_token_env = "LARK_VERIFICATION_TOKEN"
allowed_chat_ids       = ["oc_test_chat"]

[projects.web]
cwd            = "/Users/mini/code/web"
allowed_users  = ["telegram:123456789"]
allowed_chats  = ["telegram:-100123456"]
writable_roots = ["/Users/mini/code/web"]
`;

describe("@codex-im/config (T7-T8)", () => {
  it("parses the Phase 3 example TOML and rejects literal Telegram bot tokens", () => {
    const config = parseConfigToml(EXAMPLE_CONFIG);

    expect(config.adapters.telegram).toEqual({
      enabled: true,
      botTokenEnv: "IM_TELEGRAM_BOT_TOKEN",
    });
    expect(config.adapters.lark).toEqual({
      enabled: true,
      appId: "cli_test_app_id",
      appSecretEnv: "LARK_APP_SECRET",
      domain: "feishu",
      encryptKeyEnv: "LARK_ENCRYPT_KEY",
      verificationTokenEnv: "LARK_VERIFICATION_TOKEN",
      allowedChatIds: ["oc_test_chat"],
    });
    expect(config.storage.autoMigrate).toBe(false);
    expect(config.computerUse).toEqual({
      enabled: false,
      requireExplicitPrefix: true,
      defaultApp: "Google Chrome",
      allowedApps: ["Google Chrome"],
      denyApps: ["1Password", "Keychain Access", "System Settings", "Terminal"],
      unknownAppPolicy: "deny",
      requireApprovalKeywords: ["login", "password", "token"],
      liveSmokeEnabled: false,
    });
    expect(config.projects.web).toMatchObject({
      cwd: "/Users/mini/code/web",
      writableRoots: ["/Users/mini/code/web"],
    });

    expect(() =>
      parseConfigToml(`
        [daemon]
        data_dir = "/tmp/codex-im"
        log_dir = "/tmp/codex-im/logs"

        [storage]
        sqlite_path = "/tmp/codex-im/state.db"
        auto_migrate = true

        [codex]
        binary = "codex"
        version_pin = "0.128.0"

        [security]
        allowed_users = []
        allowed_chats = []
        admin_users = []

        [security.commands]
        deny_patterns = []
        require_admin_patterns = []

        [computer_use]
        enabled = false
        allowed_apps = ["Google Chrome"]
        deny_apps = ["1Password"]

        [adapters.telegram]
        enabled = true
        bot_token_env = "IM_TELEGRAM_BOT_TOKEN"
        bot_token = "literal-token-must-not-be-accepted"

        [adapters.lark]
        enabled = false
        app_id = "cli_test_app_id"
        app_secret_env = "LARK_APP_SECRET"
        domain = "feishu"
        allowed_chat_ids = []

        [projects.web]
        cwd = "/tmp/project"
        allowed_users = []
        allowed_chats = []
        writable_roots = ["/tmp/project"]
      `),
    ).toThrow(/bot_token/);
  });

  it("rejects invalid Lark domains and literal-looking Lark secret fields", () => {
    expect(() =>
      parseConfigToml(
        EXAMPLE_CONFIG.replace(
          'domain                 = "feishu"',
          'domain                 = "mars"',
        ),
      ),
    ).toThrow(/domain/);

    expect(() =>
      parseConfigToml(
        EXAMPLE_CONFIG.replace(
          'app_secret_env         = "LARK_APP_SECRET"',
          'app_secret_env         = "literal-secret-value"',
        ),
      ),
    ).toThrow(/environment variable name/);
  });

  it("parses Computer Use app policy and rejects token-looking app values", () => {
    const config = parseConfigToml(
      EXAMPLE_CONFIG.replace(
        'deny_apps = ["1Password", "Keychain Access", "System Settings", "Terminal"]',
        'deny_apps = ["1Password"]',
      ),
    );

    expect(config.computerUse.denyApps).toEqual(["1Password"]);

    expect(() =>
      parseConfigToml(
        EXAMPLE_CONFIG.replace(
          'allowed_apps = ["Google Chrome"]',
          'allowed_apps = ["sk-testsecret1234567890"]',
        ),
      ),
    ).toThrow(/secret or token/);
  });

  it("resolves ${ENV.NAME} references and fails closed when env is missing", () => {
    const resolved = resolveEnvReferences(
      {
        dataDir: "${ENV.CODEX_IM_DATA_DIR}",
        nested: { logDir: "${ENV.CODEX_IM_LOG_DIR}" },
      },
      {
        env: {
          CODEX_IM_DATA_DIR: "/tmp/codex-im",
          CODEX_IM_LOG_DIR: "/tmp/codex-im/logs",
        },
      },
    );

    expect(resolved).toEqual({
      dataDir: "/tmp/codex-im",
      nested: { logDir: "/tmp/codex-im/logs" },
    });
    expect(() => resolveEnvReferences("${ENV.MISSING_CODEX_IM_ENV}", { env: {} })).toThrow(
      /MISSING_CODEX_IM_ENV/,
    );
  });

  it("returns resolved adapter secrets without logging secret values", () => {
    const config = parseConfigToml(EXAMPLE_CONFIG);
    const syntheticToken = "TEST_TELEGRAM_TOKEN_NEVER_LOGGED";
    const syntheticLarkSecret = "TEST_LARK_SECRET_NEVER_LOGGED";
    const syntheticLarkEncryptKey = "TEST_LARK_ENCRYPT_KEY_NEVER_LOGGED";
    const syntheticLarkVerificationToken = "TEST_LARK_VERIFY_NEVER_LOGGED";
    const logLines: string[] = [];

    const secrets = resolveConfigSecrets(config, {
      env: {
        IM_TELEGRAM_BOT_TOKEN: syntheticToken,
        LARK_APP_SECRET: syntheticLarkSecret,
        LARK_ENCRYPT_KEY: syntheticLarkEncryptKey,
        LARK_VERIFICATION_TOKEN: syntheticLarkVerificationToken,
      },
      logger: { info: (...args) => logLines.push(JSON.stringify(args)) },
    });

    expect(secrets.telegramBotToken).toBe(syntheticToken);
    expect(secrets.larkAppSecret).toBe(syntheticLarkSecret);
    expect(secrets.larkEncryptKey).toBe(syntheticLarkEncryptKey);
    expect(secrets.larkVerificationToken).toBe(syntheticLarkVerificationToken);
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(syntheticToken);
    expect(logLines.join("\n")).not.toContain(syntheticLarkSecret);
    expect(logLines.join("\n")).not.toContain(syntheticLarkEncryptKey);
    expect(logLines.join("\n")).not.toContain(syntheticLarkVerificationToken);
    expect(logLines.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(logLines.join("\n")).toContain("LARK_APP_SECRET");
    expect(() => resolveConfigSecrets(config, { env: {} })).toThrow(/IM_TELEGRAM_BOT_TOKEN/);
  });
});

import { describe, expect, it } from "vitest";
import { parseConfigToml, resolveConfigSecrets, resolveEnvReferences } from "../src/index.js";

const EXAMPLE_CONFIG = `
[daemon]
data_dir = "~/.codex-im-bridge"
log_dir  = "~/.codex-im-bridge/logs"
max_inbound_attachment_bytes = 26214400

[storage]
sqlite_path  = "~/.codex-im-bridge/state.db"
auto_migrate = false

[codex]
binary = "codex"
version_pin = "0.130.0"

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

[adapters.dingtalk]
enabled            = true
client_id          = "ding_test_client_id"
client_secret_env  = "DINGTALK_CLIENT_SECRET"
robot_code         = "ding_test_robot_code"
card_template_id   = "ding_test_card_template"
callback_route_key = "codex_im"

[adapters.slack]
enabled                = true
bot_token_env          = "SLACK_BOT_TOKEN"
app_token_env          = "SLACK_APP_TOKEN"
allowed_channel_ids    = ["T_TEST:C_TEST"]

[projects.web]
cwd            = "/Users/mini/code/web"
allowed_users  = ["telegram:123456789"]
allowed_chats  = ["telegram:-100123456"]
writable_roots = ["/Users/mini/code/web"]
`;

describe("@codex-im/config (T7-T8)", () => {
  it("parses the Phase 3 example TOML and rejects literal Telegram bot tokens", () => {
    const config = parseConfigToml(EXAMPLE_CONFIG);

    expect(config.daemon).toEqual({
      dataDir: "~/.codex-im-bridge",
      logDir: "~/.codex-im-bridge/logs",
      maxInboundAttachmentBytes: 26_214_400,
    });
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
    expect(config.adapters.dingtalk).toEqual({
      enabled: true,
      clientId: "ding_test_client_id",
      clientSecretEnv: "DINGTALK_CLIENT_SECRET",
      robotCode: "ding_test_robot_code",
      cardTemplateId: "ding_test_card_template",
      callbackRouteKey: "codex_im",
    });
    expect(config.adapters.slack).toEqual({
      enabled: true,
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
      allowedChannelIds: ["T_TEST:C_TEST"],
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
    expect(config.im).toEqual({
      output: { mode: "normal" },
      nativeThreadVisibility: "project_limited",
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
        version_pin = "0.130.0"

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

        [adapters.dingtalk]
        enabled = false
        client_id = "disabled"
        client_secret_env = "DINGTALK_CLIENT_SECRET"

        [adapters.slack]
        enabled = false
        bot_token_env = "SLACK_BOT_TOKEN"
        app_token_env = "SLACK_APP_TOKEN"
        allowed_channel_ids = []

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

  it("defaults Slack to disabled for existing configs without a Slack adapter block", () => {
    const config = parseConfigToml(
      EXAMPLE_CONFIG.replace(
        `
[adapters.slack]
enabled                = true
bot_token_env          = "SLACK_BOT_TOKEN"
app_token_env          = "SLACK_APP_TOKEN"
allowed_channel_ids    = ["T_TEST:C_TEST"]
`,
        "",
      ),
    );

    expect(config.adapters.slack).toEqual({
      enabled: false,
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
      allowedChannelIds: [],
    });
  });

  it("parses explicit personal native thread visibility opt-in", () => {
    const config = parseConfigToml(`
      [daemon]
      data_dir = "~/.codex-im-bridge"
      log_dir = "~/.codex-im-bridge/logs"

      [storage]
      sqlite_path = "~/.codex-im-bridge/state.db"
      auto_migrate = true

      [codex]
      binary = "codex"
      version_pin = "0.130.0"

      [security]
      allowed_users = ["telegram:123456789"]
      allowed_chats = ["telegram:123456789"]
      admin_users = ["telegram:123456789"]

      [security.commands]
      deny_patterns = []
      require_admin_patterns = []

      [im]
      native_thread_visibility = "personal"

      [adapters.telegram]
      enabled = true
      bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

      [adapters.lark]
      enabled = false
      app_id = "disabled"
      app_secret_env = "LARK_APP_SECRET"
      domain = "feishu"
      allowed_chat_ids = []

      [projects]
    `);

    expect(config.im.nativeThreadVisibility).toBe("personal");
  });

  it("defaults daemon inbound attachment size cap for older configs", () => {
    const config = parseConfigToml(
      EXAMPLE_CONFIG.replace("\nmax_inbound_attachment_bytes = 26214400", ""),
    );

    expect(config.daemon.maxInboundAttachmentBytes).toBe(25 * 1024 * 1024);
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
    const syntheticDingTalkSecret = "TEST_DINGTALK_SECRET_NEVER_LOGGED";
    const syntheticSlackBotToken = "TEST_SLACK_BOT_TOKEN_NEVER_LOGGED";
    const syntheticSlackAppToken = "TEST_SLACK_APP_TOKEN_NEVER_LOGGED";
    const logLines: string[] = [];

    const secrets = resolveConfigSecrets(config, {
      env: {
        IM_TELEGRAM_BOT_TOKEN: syntheticToken,
        LARK_APP_SECRET: syntheticLarkSecret,
        LARK_ENCRYPT_KEY: syntheticLarkEncryptKey,
        LARK_VERIFICATION_TOKEN: syntheticLarkVerificationToken,
        DINGTALK_CLIENT_SECRET: syntheticDingTalkSecret,
        SLACK_BOT_TOKEN: syntheticSlackBotToken,
        SLACK_APP_TOKEN: syntheticSlackAppToken,
      },
      logger: { info: (...args) => logLines.push(JSON.stringify(args)) },
    });

    expect(secrets.telegramBotToken).toBe(syntheticToken);
    expect(secrets.larkAppSecret).toBe(syntheticLarkSecret);
    expect(secrets.larkEncryptKey).toBe(syntheticLarkEncryptKey);
    expect(secrets.larkVerificationToken).toBe(syntheticLarkVerificationToken);
    expect(secrets.dingtalkClientSecret).toBe(syntheticDingTalkSecret);
    expect(secrets.slackBotToken).toBe(syntheticSlackBotToken);
    expect(secrets.slackAppToken).toBe(syntheticSlackAppToken);
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(syntheticToken);
    expect(logLines.join("\n")).not.toContain(syntheticLarkSecret);
    expect(logLines.join("\n")).not.toContain(syntheticLarkEncryptKey);
    expect(logLines.join("\n")).not.toContain(syntheticLarkVerificationToken);
    expect(logLines.join("\n")).not.toContain(syntheticDingTalkSecret);
    expect(logLines.join("\n")).not.toContain(syntheticSlackBotToken);
    expect(logLines.join("\n")).not.toContain(syntheticSlackAppToken);
    expect(logLines.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(logLines.join("\n")).toContain("LARK_APP_SECRET");
    expect(logLines.join("\n")).toContain("DINGTALK_CLIENT_SECRET");
    expect(logLines.join("\n")).toContain("SLACK_BOT_TOKEN");
    expect(logLines.join("\n")).toContain("SLACK_APP_TOKEN");
    // No size/length/chars field is allowed in the resolved-secret log
    // record. A numeric length is a side-channel hint about secret shape.
    const merged = logLines.join("\n");
    expect(merged).not.toMatch(/"length"/);
    expect(merged).not.toMatch(/"size"/);
    expect(merged).not.toMatch(/"chars"/);
    expect(merged).not.toMatch(/length=\d+/);
    expect(merged).not.toMatch(/size=\d+/);
    // Presence-only signalling is fine.
    expect(merged).toContain("present");
    expect(merged).toContain("***REDACTED***");
    expect(() => resolveConfigSecrets(config, { env: {} })).toThrow(/IM_TELEGRAM_BOT_TOKEN/);
  });

  it("expands reusable access groups into global and project allowlists", () => {
    const config = parseConfigToml(`
      [daemon]
      data_dir = "/tmp/codex-im"
      log_dir = "/tmp/codex-im/logs"

      [storage]
      sqlite_path = "/tmp/codex-im/state.db"
      auto_migrate = true

      [codex]
      binary = "codex"
      version_pin = "0.130.0"

      [security]
      allowed_users = ["telegram:explicit-user"]
      allowed_chats = ["telegram:explicit-chat"]
      admin_users = []
      default_access_groups = ["operators"]

      [security.commands]
      deny_patterns = []
      require_admin_patterns = []

      [security.group_policy]
      mention_required_chats = ["telegram:group-chat"]
      mention_aliases = ["@codex"]

      [security.access_groups.operators]
      allowed_users = ["telegram:group-user", "lark:group-user"]
      allowed_chats = ["telegram:group-chat", "lark:group-chat"]

      [adapters.telegram]
      enabled = false
      bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

      [adapters.lark]
      enabled = false
      app_id = "cli_test_app_id"
      app_secret_env = "LARK_APP_SECRET"
      domain = "feishu"
      allowed_chat_ids = []

      [adapters.dingtalk]
      enabled = false
      client_id = "disabled"
      client_secret_env = "DINGTALK_CLIENT_SECRET"

      [adapters.slack]
      enabled = false
      bot_token_env = "SLACK_BOT_TOKEN"
      app_token_env = "SLACK_APP_TOKEN"
      allowed_channel_ids = []

      [projects.web]
      cwd = "/tmp/project"
      allowed_users = []
      allowed_chats = []
      access_groups = ["operators"]
      writable_roots = ["/tmp/project"]
    `);

    expect(config.security.accessGroups).toEqual({
      operators: {
        allowedUsers: ["telegram:group-user", "lark:group-user"],
        allowedChats: ["telegram:group-chat", "lark:group-chat"],
      },
    });
    expect(config.security.allowedUsers).toEqual([
      "telegram:explicit-user",
      "telegram:group-user",
      "lark:group-user",
    ]);
    expect(config.security.allowedChats).toEqual([
      "telegram:explicit-chat",
      "telegram:group-chat",
      "lark:group-chat",
    ]);
    expect(config.security.groupPolicy).toEqual({
      mentionRequiredChats: ["telegram:group-chat"],
      mentionAliases: ["@codex"],
    });
    const webProject = config.projects.web;
    expect(webProject).toBeDefined();
    expect(webProject?.allowedUsers).toEqual(["telegram:group-user", "lark:group-user"]);
    expect(webProject?.allowedChats).toEqual(["telegram:group-chat", "lark:group-chat"]);
  });

  it("fails closed when a global or project access group reference is unknown", () => {
    const globalReference = EXAMPLE_CONFIG.replace(
      'admin_users   = ["telegram:123456789"]',
      'admin_users   = ["telegram:123456789"]\ndefault_access_groups = ["missing"]',
    );
    const projectReference = EXAMPLE_CONFIG.replace(
      "writable_roots =",
      'access_groups = ["missing"]\nwritable_roots =',
    );

    expect(() => parseConfigToml(globalReference)).toThrow(/Unknown access group missing/);
    expect(() => parseConfigToml(projectReference)).toThrow(/Unknown access group missing/);
  });
});

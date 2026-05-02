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

[adapters.telegram]
enabled       = true
bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

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
    expect(config.storage.autoMigrate).toBe(false);
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

        [adapters.telegram]
        enabled = true
        bot_token_env = "IM_TELEGRAM_BOT_TOKEN"
        bot_token = "literal-token-must-not-be-accepted"
      `),
    ).toThrow(/bot_token/);
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

  it("returns resolved Telegram token without logging the secret value", () => {
    const config = parseConfigToml(EXAMPLE_CONFIG);
    const syntheticToken = "TEST_TELEGRAM_TOKEN_NEVER_LOGGED";
    const logLines: string[] = [];

    const secrets = resolveConfigSecrets(config, {
      env: { IM_TELEGRAM_BOT_TOKEN: syntheticToken },
      logger: { info: (...args) => logLines.push(JSON.stringify(args)) },
    });

    expect(secrets.telegramBotToken).toBe(syntheticToken);
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(syntheticToken);
    expect(logLines.join("\n")).toContain("IM_TELEGRAM_BOT_TOKEN");
    expect(() => resolveConfigSecrets(config, { env: {} })).toThrow(/IM_TELEGRAM_BOT_TOKEN/);
  });
});

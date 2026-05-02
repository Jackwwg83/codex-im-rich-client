import { parse as parseToml } from "smol-toml";
import { z } from "zod";

export interface CodexImConfig {
  daemon: {
    dataDir: string;
    logDir: string;
  };
  storage: {
    sqlitePath: string;
    autoMigrate: boolean;
  };
  codex: {
    binary: string;
    versionPin: string;
  };
  security: {
    allowedUsers: string[];
    allowedChats: string[];
    adminUsers: string[];
    commands: {
      denyPatterns: string[];
      requireAdminPatterns: string[];
    };
  };
  adapters: {
    telegram: {
      enabled: boolean;
      botTokenEnv: string;
    };
    lark: {
      enabled: boolean;
      appId: string;
      appSecretEnv: string;
      domain: "feishu" | "lark";
      encryptKeyEnv?: string;
      verificationTokenEnv?: string;
      allowedChatIds: string[];
    };
  };
  projects: Record<
    string,
    {
      cwd: string;
      allowedUsers: string[];
      allowedChats: string[];
      writableRoots: string[];
    }
  >;
}

export interface EnvResolverOptions {
  env: Record<string, string | undefined>;
}

export interface ConfigSecretLogger {
  info(...args: unknown[]): void;
}

export interface ConfigSecretResolverOptions extends EnvResolverOptions {
  logger?: ConfigSecretLogger;
}

export interface ResolvedConfigSecrets {
  telegramBotToken?: string;
  larkAppSecret?: string;
  larkEncryptKey?: string;
  larkVerificationToken?: string;
}

const envNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, {
  message: "must be an environment variable name",
});

const rawConfigSchema = z
  .object({
    daemon: z
      .object({
        data_dir: z.string().min(1),
        log_dir: z.string().min(1),
      })
      .strict(),
    storage: z
      .object({
        sqlite_path: z.string().min(1),
        auto_migrate: z.boolean(),
      })
      .strict(),
    codex: z
      .object({
        binary: z.string().min(1),
        version_pin: z.string().min(1),
      })
      .strict(),
    security: z
      .object({
        allowed_users: z.array(z.string()),
        allowed_chats: z.array(z.string()),
        admin_users: z.array(z.string()),
        commands: z
          .object({
            deny_patterns: z.array(z.string()),
            require_admin_patterns: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    adapters: z
      .object({
        telegram: z
          .object({
            enabled: z.boolean(),
            bot_token_env: z.string().min(1),
          })
          .strict(),
        lark: z
          .object({
            enabled: z.boolean(),
            app_id: z.string().min(1),
            app_secret_env: envNameSchema,
            domain: z.enum(["feishu", "lark"]),
            encrypt_key_env: envNameSchema.optional(),
            verification_token_env: envNameSchema.optional(),
            allowed_chat_ids: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    projects: z.record(
      z.string(),
      z
        .object({
          cwd: z.string().min(1),
          allowed_users: z.array(z.string()),
          allowed_chats: z.array(z.string()),
          writable_roots: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export function parseConfigToml(source: string): CodexImConfig {
  const parsed = rawConfigSchema.parse(parseToml(source));
  return {
    daemon: {
      dataDir: parsed.daemon.data_dir,
      logDir: parsed.daemon.log_dir,
    },
    storage: {
      sqlitePath: parsed.storage.sqlite_path,
      autoMigrate: parsed.storage.auto_migrate,
    },
    codex: {
      binary: parsed.codex.binary,
      versionPin: parsed.codex.version_pin,
    },
    security: {
      allowedUsers: parsed.security.allowed_users,
      allowedChats: parsed.security.allowed_chats,
      adminUsers: parsed.security.admin_users,
      commands: {
        denyPatterns: parsed.security.commands.deny_patterns,
        requireAdminPatterns: parsed.security.commands.require_admin_patterns,
      },
    },
    adapters: {
      telegram: {
        enabled: parsed.adapters.telegram.enabled,
        botTokenEnv: parsed.adapters.telegram.bot_token_env,
      },
      lark: {
        enabled: parsed.adapters.lark.enabled,
        appId: parsed.adapters.lark.app_id,
        appSecretEnv: parsed.adapters.lark.app_secret_env,
        domain: parsed.adapters.lark.domain,
        allowedChatIds: parsed.adapters.lark.allowed_chat_ids,
        ...(parsed.adapters.lark.encrypt_key_env === undefined
          ? {}
          : { encryptKeyEnv: parsed.adapters.lark.encrypt_key_env }),
        ...(parsed.adapters.lark.verification_token_env === undefined
          ? {}
          : { verificationTokenEnv: parsed.adapters.lark.verification_token_env }),
      },
    },
    projects: Object.fromEntries(
      Object.entries(parsed.projects).map(([name, project]) => [
        name,
        {
          cwd: project.cwd,
          allowedUsers: project.allowed_users,
          allowedChats: project.allowed_chats,
          writableRoots: project.writable_roots,
        },
      ]),
    ),
  };
}

const ENV_REF = /\$\{ENV\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function resolveEnvReferences<T>(input: T, opts: EnvResolverOptions): T {
  if (typeof input === "string") {
    return input.replace(ENV_REF, (_match, name: string) => {
      const value = opts.env[name];
      if (value === undefined) {
        throw new Error(`Missing environment variable ${name}`);
      }
      return value;
    }) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => resolveEnvReferences(item, opts)) as T;
  }

  if (input !== null && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, resolveEnvReferences(value, opts)]),
    ) as T;
  }

  return input;
}

export function resolveConfigSecrets(
  config: CodexImConfig,
  opts: ConfigSecretResolverOptions,
): ResolvedConfigSecrets {
  const secrets: ResolvedConfigSecrets = {};

  if (config.adapters.telegram.enabled) {
    secrets.telegramBotToken = resolveSecretEnv(
      "telegram",
      config.adapters.telegram.botTokenEnv,
      opts,
    );
  }

  if (config.adapters.lark.enabled) {
    secrets.larkAppSecret = resolveSecretEnv("lark", config.adapters.lark.appSecretEnv, opts);
    if (config.adapters.lark.encryptKeyEnv !== undefined) {
      secrets.larkEncryptKey = resolveSecretEnv("lark", config.adapters.lark.encryptKeyEnv, opts);
    }
    if (config.adapters.lark.verificationTokenEnv !== undefined) {
      secrets.larkVerificationToken = resolveSecretEnv(
        "lark",
        config.adapters.lark.verificationTokenEnv,
        opts,
      );
    }
  }

  return secrets;
}

function resolveSecretEnv(
  adapter: "telegram" | "lark",
  envName: string,
  opts: ConfigSecretResolverOptions,
): string {
  const value = opts.env[envName];
  if (value === undefined) {
    throw new Error(`Missing environment variable ${envName}`);
  }

  opts.logger?.info({
    event: "config.secret_resolved",
    adapter,
    envVar: envName,
    value: "***REDACTED***",
    length: value.length,
  });

  return value;
}

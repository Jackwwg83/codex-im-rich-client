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
    defaultAccessGroups?: string[];
    accessGroups?: Record<string, CodexImAccessGroupConfig>;
    commands: {
      denyPatterns: string[];
      requireAdminPatterns: string[];
    };
  };
  computerUse: {
    enabled: boolean;
    requireExplicitPrefix: boolean;
    defaultApp: string;
    allowedApps: string[];
    denyApps: string[];
    unknownAppPolicy: "deny";
    requireApprovalKeywords: string[];
    liveSmokeEnabled: boolean;
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
    dingtalk: {
      enabled: boolean;
      clientId: string;
      clientSecretEnv: string;
      robotCode?: string;
      cardTemplateId?: string;
      callbackRouteKey?: string;
    };
  };
  projects: Record<
    string,
    {
      cwd: string;
      allowedUsers: string[];
      allowedChats: string[];
      accessGroups?: string[];
      writableRoots: string[];
    }
  >;
}

export interface CodexImAccessGroupConfig {
  allowedUsers: string[];
  allowedChats: string[];
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
  dingtalkClientSecret?: string;
}

const envNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, {
  message: "must be an environment variable name",
});

const SECRET_LOOKING_VALUE =
  /(?:sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})/u;

const configPlainStringSchema = z
  .string()
  .min(1)
  .refine((value) => !SECRET_LOOKING_VALUE.test(value), {
    message: "must not look like a secret or token",
  });

const computerUseConfigDefaults = {
  enabled: false,
  require_explicit_prefix: true,
  default_app: "Google Chrome",
  allowed_apps: ["Google Chrome"],
  deny_apps: ["1Password", "Keychain Access", "System Settings", "Terminal"],
  unknown_app_policy: "deny" as const,
  require_approval_keywords: [
    "login",
    "password",
    "token",
    "payment",
    "checkout",
    "delete",
    "send",
    "submit",
    "publish",
    "transfer",
  ],
  live_smoke_enabled: false,
};

const rawAccessGroupSchema = z
  .object({
    allowed_users: z.array(z.string()).default([]),
    allowed_chats: z.array(z.string()).default([]),
  })
  .strict();

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
        default_access_groups: z.array(z.string()).default([]),
        access_groups: z.record(z.string(), rawAccessGroupSchema).default({}),
        commands: z
          .object({
            deny_patterns: z.array(z.string()),
            require_admin_patterns: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    computer_use: z
      .object({
        enabled: z.boolean().default(computerUseConfigDefaults.enabled),
        require_explicit_prefix: z
          .boolean()
          .default(computerUseConfigDefaults.require_explicit_prefix),
        default_app: configPlainStringSchema.default(computerUseConfigDefaults.default_app),
        allowed_apps: z
          .array(configPlainStringSchema)
          .default(computerUseConfigDefaults.allowed_apps),
        deny_apps: z.array(configPlainStringSchema).default(computerUseConfigDefaults.deny_apps),
        unknown_app_policy: z.literal("deny").default(computerUseConfigDefaults.unknown_app_policy),
        require_approval_keywords: z
          .array(configPlainStringSchema)
          .default(computerUseConfigDefaults.require_approval_keywords),
        live_smoke_enabled: z.boolean().default(computerUseConfigDefaults.live_smoke_enabled),
      })
      .strict()
      .default(computerUseConfigDefaults),
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
        dingtalk: z
          .object({
            enabled: z.boolean(),
            client_id: z.string().min(1),
            client_secret_env: envNameSchema,
            robot_code: configPlainStringSchema.optional(),
            card_template_id: configPlainStringSchema.optional(),
            callback_route_key: configPlainStringSchema.optional(),
          })
          .strict()
          .default({
            enabled: false,
            client_id: "disabled",
            client_secret_env: "DINGTALK_CLIENT_SECRET",
          }),
      })
      .strict(),
    projects: z.record(
      z.string(),
      z
        .object({
          cwd: z.string().min(1),
          allowed_users: z.array(z.string()),
          allowed_chats: z.array(z.string()),
          access_groups: z.array(z.string()).default([]),
          writable_roots: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export function parseConfigToml(source: string): CodexImConfig {
  const parsed = rawConfigSchema.parse(parseToml(source));
  const accessGroups = Object.fromEntries(
    Object.entries(parsed.security.access_groups).map(([name, group]) => [
      name,
      {
        allowedUsers: group.allowed_users,
        allowedChats: group.allowed_chats,
      },
    ]),
  );
  const securityAccess = expandAccessGroups({
    scope: "security.default_access_groups",
    allowedUsers: parsed.security.allowed_users,
    allowedChats: parsed.security.allowed_chats,
    groupNames: parsed.security.default_access_groups,
    accessGroups,
  });
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
      allowedUsers: securityAccess.allowedUsers,
      allowedChats: securityAccess.allowedChats,
      adminUsers: parsed.security.admin_users,
      defaultAccessGroups: parsed.security.default_access_groups,
      accessGroups,
      commands: {
        denyPatterns: parsed.security.commands.deny_patterns,
        requireAdminPatterns: parsed.security.commands.require_admin_patterns,
      },
    },
    computerUse: {
      enabled: parsed.computer_use.enabled,
      requireExplicitPrefix: parsed.computer_use.require_explicit_prefix,
      defaultApp: parsed.computer_use.default_app,
      allowedApps: parsed.computer_use.allowed_apps,
      denyApps: parsed.computer_use.deny_apps,
      unknownAppPolicy: parsed.computer_use.unknown_app_policy,
      requireApprovalKeywords: parsed.computer_use.require_approval_keywords,
      liveSmokeEnabled: parsed.computer_use.live_smoke_enabled,
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
      dingtalk: {
        enabled: parsed.adapters.dingtalk.enabled,
        clientId: parsed.adapters.dingtalk.client_id,
        clientSecretEnv: parsed.adapters.dingtalk.client_secret_env,
        ...(parsed.adapters.dingtalk.robot_code === undefined
          ? {}
          : { robotCode: parsed.adapters.dingtalk.robot_code }),
        ...(parsed.adapters.dingtalk.card_template_id === undefined
          ? {}
          : { cardTemplateId: parsed.adapters.dingtalk.card_template_id }),
        ...(parsed.adapters.dingtalk.callback_route_key === undefined
          ? {}
          : { callbackRouteKey: parsed.adapters.dingtalk.callback_route_key }),
      },
    },
    projects: Object.fromEntries(
      Object.entries(parsed.projects).map(([name, project]) => {
        const projectAccess = expandAccessGroups({
          scope: `projects.${name}.access_groups`,
          allowedUsers: project.allowed_users,
          allowedChats: project.allowed_chats,
          groupNames: project.access_groups,
          accessGroups,
        });
        return [
          name,
          {
            cwd: project.cwd,
            allowedUsers: projectAccess.allowedUsers,
            allowedChats: projectAccess.allowedChats,
            accessGroups: project.access_groups,
            writableRoots: project.writable_roots,
          },
        ];
      }),
    ),
  };
}

function expandAccessGroups(input: {
  readonly scope: string;
  readonly allowedUsers: readonly string[];
  readonly allowedChats: readonly string[];
  readonly groupNames: readonly string[];
  readonly accessGroups: Record<string, CodexImAccessGroupConfig>;
}): { allowedUsers: string[]; allowedChats: string[] } {
  const users = [...input.allowedUsers];
  const chats = [...input.allowedChats];
  for (const name of input.groupNames) {
    const group = input.accessGroups[name];
    if (group === undefined) {
      throw new Error(`Unknown access group ${name} in ${input.scope}`);
    }
    users.push(...group.allowedUsers);
    chats.push(...group.allowedChats);
  }
  return {
    allowedUsers: uniqueStrings(users),
    allowedChats: uniqueStrings(chats),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
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

  if (config.adapters.dingtalk.enabled) {
    secrets.dingtalkClientSecret = resolveSecretEnv(
      "dingtalk",
      config.adapters.dingtalk.clientSecretEnv,
      opts,
    );
  }

  return secrets;
}

function resolveSecretEnv(
  adapter: "telegram" | "lark" | "dingtalk",
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

#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type Interface, createInterface } from "node:readline/promises";

export type SetupPlatform = "telegram" | "lark" | "dingtalk" | "slack";

export type SetupSecretKind =
  | "telegramBotToken"
  | "larkAppSecret"
  | "dingtalkClientSecret"
  | "slackBotToken"
  | "slackAppToken";

export interface SetupAnswers {
  readonly platform: SetupPlatform;
  readonly projectName: string;
  readonly projectCwd: string;
  readonly allowedUserId: string;
  readonly allowedChatId: string;
  readonly codexBinary: string;
  readonly codexVersion: string;
  readonly telegramBotToken: string;
  readonly larkAppId: string;
  readonly larkAppSecret: string;
  readonly larkDomain: "feishu" | "lark";
  readonly dingtalkClientId: string;
  readonly dingtalkClientSecret: string;
  readonly dingtalkCardTemplateId: string;
  readonly slackBotToken: string;
  readonly slackAppToken: string;
}

export interface KeychainWritePlan {
  readonly service: string;
  readonly account: string;
  readonly envName: string;
  readonly secret: string;
}

export interface SetupPlan {
  readonly configPath: string;
  readonly backupPath?: string;
  readonly configToml: string;
  readonly keychainWrites: readonly KeychainWritePlan[];
  readonly nextCommands: readonly string[];
}

export interface BuildSetupPlanInput {
  readonly home: string;
  readonly now: Date;
  readonly answers: SetupAnswers;
  readonly existingConfigPresent: boolean;
  readonly configPath?: string;
}

interface CliOptions {
  readonly platform?: SetupPlatform;
  readonly configPath?: string;
  readonly dryRun: boolean;
  readonly printTemplate: boolean;
  readonly noKeychain: boolean;
  readonly noDoctor: boolean;
}

const DEFAULT_ENV_NAMES = {
  telegramBotToken: "IM_TELEGRAM_BOT_TOKEN",
  larkAppSecret: "IM_LARK_APP_SECRET",
  dingtalkClientSecret: "DINGTALK_CLIENT_SECRET",
  slackBotToken: "SLACK_BOT_TOKEN",
  slackAppToken: "SLACK_APP_TOKEN",
} as const satisfies Record<SetupSecretKind, string>;

const SECRET_SERVICES = {
  telegramBotToken: "codex-im-bridge",
  larkAppSecret: "codex-im-bridge-lark",
  dingtalkClientSecret: "codex-im-bridge-dingtalk",
  slackBotToken: "codex-im-bridge-slack-bot",
  slackAppToken: "codex-im-bridge-slack-app",
} as const satisfies Record<SetupSecretKind, string>;

const DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function keychainServiceForSecret(secret: SetupSecretKind): string {
  return SECRET_SERVICES[secret];
}

export function buildSetupPlan(input: BuildSetupPlanInput): SetupPlan {
  const configPath = input.configPath ?? join(input.home, ".codex-im-bridge", "config.toml");
  const account = basename(input.home) || "$USER";
  const configToml = renderConfigToml(input.home, input.answers);
  const backupPath = input.existingConfigPresent
    ? `${configPath}.bak-${timestamp(input.now)}`
    : undefined;

  return {
    configPath,
    ...(backupPath === undefined ? {} : { backupPath }),
    configToml,
    keychainWrites: keychainWritesFor(input.answers, account),
    nextCommands: [
      `pnpm im:doctor --config ${shellQuote(configPath)}`,
      "pnpm bridge:build",
      "pnpm bridge:install",
      "pnpm launchd:install",
      "pnpm launchd:status",
    ],
  };
}

function keychainWritesFor(answers: SetupAnswers, account: string): readonly KeychainWritePlan[] {
  switch (answers.platform) {
    case "telegram":
      return [
        keychainWrite(
          "telegramBotToken",
          account,
          required(answers.telegramBotToken, "Telegram bot token"),
        ),
      ];
    case "lark":
      return [
        keychainWrite("larkAppSecret", account, required(answers.larkAppSecret, "Lark app secret")),
      ];
    case "dingtalk":
      return [
        keychainWrite(
          "dingtalkClientSecret",
          account,
          required(answers.dingtalkClientSecret, "DingTalk client secret"),
        ),
      ];
    case "slack":
      return [
        keychainWrite("slackBotToken", account, required(answers.slackBotToken, "Slack bot token")),
        keychainWrite("slackAppToken", account, required(answers.slackAppToken, "Slack app token")),
      ];
  }
}

function keychainWrite(kind: SetupSecretKind, account: string, secret: string): KeychainWritePlan {
  return {
    service: SECRET_SERVICES[kind],
    account,
    envName: DEFAULT_ENV_NAMES[kind],
    secret,
  };
}

function renderConfigToml(home: string, answers: SetupAnswers): string {
  const dataDir = join(home, ".codex-im-bridge");
  const platformUser = platformScoped(answers.platform, answers.allowedUserId);
  const platformChat = platformScoped(answers.platform, answers.allowedChatId);
  const rawChat = rawPlatformId(answers.platform, answers.allowedChatId);
  const rawUser = rawPlatformId(answers.platform, answers.allowedUserId);
  const projectName = tomlKey(answers.projectName);
  const lines = [
    "# Generated by pnpm setup:im. Secrets live in macOS Keychain, not this file.",
    "",
    "[daemon]",
    `data_dir = ${tomlString(dataDir)}`,
    `log_dir = ${tomlString(join(dataDir, "logs"))}`,
    `max_inbound_attachment_bytes = ${DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES}`,
    "",
    "[storage]",
    `sqlite_path = ${tomlString(join(dataDir, "state.db"))}`,
    "auto_migrate = true",
    "",
    "[codex]",
    `binary = ${tomlString(nonEmpty(answers.codexBinary, "codex"))}`,
    `version_pin = ${tomlString(nonEmpty(answers.codexVersion, "0.128.0"))}`,
    "",
    "[security]",
    `allowed_users = ${tomlArray([platformUser])}`,
    `allowed_chats = ${tomlArray([platformChat])}`,
    `admin_users = ${tomlArray([platformUser])}`,
    "default_access_groups = []",
    "",
    "[security.group_policy]",
    "mention_required_chats = []",
    'mention_aliases = ["codex", "codex-im"]',
    "",
    "[security.commands]",
    "deny_patterns = []",
    "require_admin_patterns = []",
    "",
    "[computer_use]",
    "enabled = false",
    "require_explicit_prefix = true",
    'default_app = "Google Chrome"',
    'allowed_apps = ["Google Chrome"]',
    'deny_apps = ["1Password", "Keychain Access", "System Settings", "Terminal"]',
    'unknown_app_policy = "deny"',
    'require_approval_keywords = ["login", "password", "token", "payment", "checkout", "delete", "send", "submit", "publish", "transfer"]',
    "live_smoke_enabled = false",
    "",
    "[adapters.telegram]",
    `enabled = ${answers.platform === "telegram"}`,
    `bot_token_env = ${tomlString(DEFAULT_ENV_NAMES.telegramBotToken)}`,
    "",
    "[adapters.lark]",
    `enabled = ${answers.platform === "lark"}`,
    `app_id = ${tomlString(answers.platform === "lark" ? required(answers.larkAppId, "Lark app id") : "disabled")}`,
    `app_secret_env = ${tomlString(DEFAULT_ENV_NAMES.larkAppSecret)}`,
    `domain = ${tomlString(answers.platform === "lark" ? answers.larkDomain : "feishu")}`,
    `allowed_chat_ids = ${tomlArray(answers.platform === "lark" ? [rawChat] : [])}`,
    "",
    "[adapters.dingtalk]",
    `enabled = ${answers.platform === "dingtalk"}`,
    `client_id = ${tomlString(
      answers.platform === "dingtalk"
        ? required(answers.dingtalkClientId, "DingTalk client id")
        : "disabled",
    )}`,
    `client_secret_env = ${tomlString(DEFAULT_ENV_NAMES.dingtalkClientSecret)}`,
    ...(answers.platform === "dingtalk"
      ? [
          `card_template_id = ${tomlString(required(answers.dingtalkCardTemplateId, "DingTalk card template id"))}`,
        ]
      : []),
    "",
    "[adapters.slack]",
    `enabled = ${answers.platform === "slack"}`,
    `bot_token_env = ${tomlString(DEFAULT_ENV_NAMES.slackBotToken)}`,
    `app_token_env = ${tomlString(DEFAULT_ENV_NAMES.slackAppToken)}`,
    `allowed_channel_ids = ${tomlArray(answers.platform === "slack" ? [rawChat] : [])}`,
    "",
    `[projects.${projectName}]`,
    `cwd = ${tomlString(required(answers.projectCwd, "project cwd"))}`,
    `allowed_users = ${tomlArray([platformUser])}`,
    `allowed_chats = ${tomlArray([platformChat])}`,
    "access_groups = []",
    `writable_roots = ${tomlArray([answers.projectCwd])}`,
    "",
  ];

  if (answers.platform === "slack") {
    lines.splice(
      lines.indexOf(`[projects.${projectName}]`),
      0,
      "# Slack IDs usually look like T123:U123 for users and T123:C123 for channels.",
      `# Setup received user ${tomlString(rawUser)} and channel ${tomlString(rawChat)}.`,
      "",
    );
  }

  return `${lines.join("\n")}`;
}

function platformScoped(platform: SetupPlatform, value: string): string {
  const trimmed = required(value, `${platform} id`);
  return trimmed.startsWith(`${platform}:`) ? trimmed : `${platform}:${trimmed}`;
}

function rawPlatformId(platform: SetupPlatform, value: string): string {
  const scoped = required(value, `${platform} id`);
  return scoped.startsWith(`${platform}:`) ? scoped.slice(platform.length + 1) : scoped;
}

function timestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getUTCFullYear().toString(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  return tomlString(value);
}

function nonEmpty(value: string, fallback: string): string {
  return value.trim().length > 0 ? value.trim() : fallback;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`setup:im: ${label} is required`);
  }
  return trimmed;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let platform: SetupPlatform | undefined;
  let configPath: string | undefined;
  let dryRun = false;
  let printTemplate = false;
  let noKeychain = false;
  let noDoctor = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--platform":
        platform = parsePlatform(argv[++index]);
        break;
      case "--config":
        configPath = required(argv[++index] ?? "", "--config path");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--print-template":
        printTemplate = true;
        dryRun = true;
        noKeychain = true;
        noDoctor = true;
        break;
      case "--no-keychain":
        noKeychain = true;
        break;
      case "--no-doctor":
        noDoctor = true;
        break;
      default:
        throw new Error(`setup:im: unknown argument ${arg}`);
    }
  }

  return { platform, configPath, dryRun, printTemplate, noKeychain, noDoctor };
}

function parsePlatform(value: string | undefined): SetupPlatform {
  if (value === "telegram" || value === "lark" || value === "dingtalk" || value === "slack") {
    return value;
  }
  throw new Error("setup:im: --platform must be telegram, lark, dingtalk, or slack");
}

async function collectAnswers(options: CliOptions): Promise<SetupAnswers> {
  if (!process.stdin.isTTY) {
    const lines = await readPipedLines();
    let index = 0;
    const nextLine = async () => (lines[index++] ?? "").trim();
    return collectAnswersWithPrompts(options, nextLine, nextLine);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await collectAnswersWithPrompts(
      options,
      (question) => ask(rl, question),
      (question) => askSecret(rl, question),
    );
  } finally {
    rl.close();
  }
}

type PromptFn = (question: string) => Promise<string>;

async function collectAnswersWithPrompts(
  options: CliOptions,
  prompt: PromptFn,
  promptSecret: PromptFn,
): Promise<SetupAnswers> {
  const platform =
    options.platform ?? parsePlatform(await prompt("Platform (telegram/lark/dingtalk/slack): "));
  const projectName = nonEmpty(await prompt("Project name [codex-im]: "), "codex-im");
  const projectCwd = nonEmpty(await prompt(`Project cwd [${process.cwd()}]: `), process.cwd());
  const allowedUserId = await promptRequired(prompt, "Allowed platform user id: ");
  const allowedChatId = await promptRequired(prompt, "Allowed chat/channel id: ");

  return {
    platform,
    projectName,
    projectCwd,
    allowedUserId,
    allowedChatId,
    codexBinary: nonEmpty(await prompt("Codex binary [codex]: "), "codex"),
    codexVersion: nonEmpty(await prompt("Codex version pin [0.128.0]: "), "0.128.0"),
    telegramBotToken: platform === "telegram" ? await promptSecret("Telegram bot token: ") : "",
    larkAppId: platform === "lark" ? await promptRequired(prompt, "Lark app id: ") : "",
    larkAppSecret: platform === "lark" ? await promptSecret("Lark app secret: ") : "",
    larkDomain:
      platform === "lark"
        ? parseLarkDomain(nonEmpty(await prompt("Lark domain [feishu]: "), "feishu"))
        : "feishu",
    dingtalkClientId:
      platform === "dingtalk" ? await promptRequired(prompt, "DingTalk client id / app key: ") : "",
    dingtalkClientSecret:
      platform === "dingtalk" ? await promptSecret("DingTalk client secret: ") : "",
    dingtalkCardTemplateId:
      platform === "dingtalk" ? await promptRequired(prompt, "DingTalk card template id: ") : "",
    slackBotToken: platform === "slack" ? await promptSecret("Slack bot token (xoxb-): ") : "",
    slackAppToken:
      platform === "slack" ? await promptSecret("Slack app-level token (xapp-): ") : "",
  };
}

async function readPipedLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/u);
}

function parseLarkDomain(value: string): "feishu" | "lark" {
  if (value === "feishu" || value === "lark") {
    return value;
  }
  throw new Error("setup:im: Lark domain must be feishu or lark");
}

async function ask(rl: Interface, question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

async function askRequired(rl: Interface, question: string): Promise<string> {
  return required(await ask(rl, question), question.replace(/:\s*$/, ""));
}

async function promptRequired(prompt: PromptFn, question: string): Promise<string> {
  return required(await prompt(question), question.replace(/:\s*$/, ""));
}

async function askSecret(rl: Interface, question: string): Promise<string> {
  const mutable = rl as unknown as {
    _writeToOutput?: (value: string) => void;
  };
  const originalWrite = mutable._writeToOutput?.bind(rl);
  if (originalWrite !== undefined && process.stdin.isTTY && process.stdout.isTTY) {
    mutable._writeToOutput = (value: string) => {
      if (value.includes("\n") || value.includes("\r")) {
        originalWrite(value);
        return;
      }
      process.stdout.write("*");
    };
  }
  try {
    return required(await ask(rl, question), question.replace(/:\s*$/, ""));
  } finally {
    if (originalWrite !== undefined) {
      mutable._writeToOutput = originalWrite;
    }
    if (process.stdin.isTTY && process.stdout.isTTY) {
      process.stdout.write("\n");
    }
  }
}

function runPlan(plan: SetupPlan, options: CliOptions): void {
  if (options.printTemplate) {
    process.stdout.write(plan.configToml);
    return;
  }
  console.log(formatPlanSummary(plan, options));
  if (options.dryRun) {
    return;
  }

  mkdirSync(dirname(plan.configPath), { recursive: true, mode: 0o700 });
  if (plan.backupPath !== undefined) {
    copyFileSync(plan.configPath, plan.backupPath);
    chmodSync(plan.backupPath, 0o600);
  }
  writeFileSync(plan.configPath, plan.configToml, { mode: 0o600 });
  chmodSync(plan.configPath, 0o600);

  if (!options.noKeychain) {
    for (const write of plan.keychainWrites) {
      writeKeychainSecret(write);
    }
  }

  if (!options.noDoctor) {
    const result = spawnSync("pnpm", ["im:doctor", "--config", plan.configPath], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
    }
  }
}

function formatPlanSummary(plan: SetupPlan, options: CliOptions): string {
  const lines = [
    "setup:im plan",
    `config: ${plan.configPath}`,
    `backup: ${plan.backupPath ?? "none"}`,
    `write_config: ${options.dryRun ? "dry-run" : "yes"}`,
    `keychain: ${options.noKeychain ? "skipped" : "write redacted secrets"}`,
    "secrets:",
    ...plan.keychainWrites.map(
      (write) =>
        `  ${write.envName}: Keychain service ${write.service}, account ${write.account}, present`,
    ),
    "",
    "next:",
    ...plan.nextCommands.map((command) => `  ${command}`),
    "",
  ];
  return lines.join("\n");
}

function writeKeychainSecret(write: KeychainWritePlan): void {
  const result = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", write.service, "-a", write.account, "-w", write.secret],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (result.status !== 0) {
    throw new Error(`setup:im: failed to write Keychain service ${write.service}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const home = homedir();
  const answers = options.printTemplate
    ? templateAnswers(options.platform ?? "telegram", process.cwd())
    : await collectAnswers(options);
  const configPath = options.configPath ?? join(home, ".codex-im-bridge", "config.toml");
  const plan = buildSetupPlan({
    home,
    now: new Date(),
    answers,
    existingConfigPresent: existsSync(configPath),
    configPath,
  });
  runPlan(plan, options);
}

function templateAnswers(platform: SetupPlatform, cwd: string): SetupAnswers {
  return {
    platform,
    projectName: "codex-im",
    projectCwd: cwd,
    allowedUserId: platform === "slack" ? "T_WORKSPACE:U_USER" : `${platform}-user-id`,
    allowedChatId: platform === "slack" ? "T_WORKSPACE:C_CHANNEL" : `${platform}-chat-id`,
    codexBinary: "codex",
    codexVersion: "0.128.0",
    telegramBotToken: "<IM_TELEGRAM_BOT_TOKEN>",
    larkAppId: platform === "lark" ? "cli_xxx" : "disabled",
    larkAppSecret: "<IM_LARK_APP_SECRET>",
    larkDomain: "feishu",
    dingtalkClientId: platform === "dingtalk" ? "ding_xxx" : "disabled",
    dingtalkClientSecret: "<DINGTALK_CLIENT_SECRET>",
    dingtalkCardTemplateId: "card_template_id",
    slackBotToken: "<SLACK_BOT_TOKEN>",
    slackAppToken: "<SLACK_APP_TOKEN>",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

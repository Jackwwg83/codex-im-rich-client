#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";

export type LocalPlatform = "telegram" | "lark" | "dingtalk" | "slack";

export interface LocalCommand {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface LocalCommandPlan {
  readonly title: string;
  readonly commands: readonly LocalCommand[];
  readonly completionLines: readonly string[];
}

export interface LocalInstallOptions {
  readonly platform: LocalPlatform;
  readonly configPath?: string;
  readonly noKeychain?: boolean;
  readonly noLaunchd?: boolean;
  readonly skipDoctor?: boolean;
}

export interface LocalStatusOptions {
  readonly configPath?: string;
}

export interface LocalUninstallOptions {
  readonly dryRun?: boolean;
}

export type LocalCommandRunner = (
  command: string,
  args: readonly string[],
) => { readonly status: number | null };

export interface RunLocalCommandPlanOptions {
  readonly dryRun?: boolean;
  readonly runner?: LocalCommandRunner;
  readonly output?: (line: string) => void;
}

export function buildLocalInstallPlan(options: LocalInstallOptions): LocalCommandPlan {
  const setupArgs = ["setup:im", "--platform", options.platform] as string[];
  const doctorArgs = ["im:doctor"] as string[];
  if (options.configPath !== undefined) {
    setupArgs.push("--config", options.configPath);
    doctorArgs.push("--config", options.configPath);
  }
  setupArgs.push("--no-doctor");
  if (options.noKeychain === true) {
    setupArgs.push("--no-keychain");
  }

  const commands: LocalCommand[] = [
    command("node-version", "node", ["--version"]),
    command("pnpm-version", "pnpm", ["--version"]),
    command("codex-version", "pnpm", ["check:codex-version"]),
    command("setup-im", "pnpm", setupArgs),
  ];

  if (options.skipDoctor !== true) {
    commands.push(command("im-doctor", "pnpm", doctorArgs));
  }

  commands.push(
    command("bridge-build", "pnpm", ["bridge:build"]),
    command("bridge-install", "pnpm", ["bridge:install"]),
  );

  if (options.noLaunchd !== true) {
    commands.push(
      command("launchd-install", "pnpm", ["launchd:install"]),
      command("launchd-status", "pnpm", ["launchd:status"]),
    );
  }

  return {
    title: "codex-im local install",
    commands,
    completionLines: [
      "Codex-IM local install complete.",
      "",
      "Try in your IM chat:",
      "  /use codex-im",
      "  Reply exactly: OK",
      "",
      "Useful local commands:",
      "  pnpm codex-im:status",
      "  pnpm codex-im:uninstall",
      "",
      "Computer Use is disabled unless enabled in local config and still requires explicit /cu.",
    ],
  };
}

export function buildLocalStatusPlan(options: LocalStatusOptions): LocalCommandPlan {
  const doctorArgs = ["im:doctor"] as string[];
  if (options.configPath !== undefined) {
    doctorArgs.push("--config", options.configPath);
  }
  return {
    title: "codex-im local status",
    commands: [
      command("im-doctor", "pnpm", doctorArgs),
      command("launchd-status", "pnpm", ["launchd:status"]),
    ],
    completionLines: ["Status check complete."],
  };
}

export function buildLocalUninstallPlan(_options: LocalUninstallOptions): LocalCommandPlan {
  return {
    title: "codex-im local uninstall",
    commands: [
      command("launchd-uninstall", "pnpm", ["launchd:uninstall"]),
      command("bridge-uninstall", "pnpm", ["bridge:uninstall"]),
    ],
    completionLines: [
      "Codex-IM local daemon artifacts removed.",
      "Preserved config, data, logs, and Keychain secrets.",
      "Remove secrets manually from macOS Keychain when you intentionally rotate or retire them.",
    ],
  };
}

export function runLocalCommandPlan(
  plan: LocalCommandPlan,
  options: RunLocalCommandPlanOptions = {},
): number {
  const output = options.output ?? console.log;
  const runner = options.runner ?? defaultRunner;
  output(plan.title);
  for (const step of plan.commands) {
    const display = formatCommand(step);
    if (options.dryRun === true) {
      output(`dry-run: ${display}`);
      continue;
    }
    output(`run: ${display}`);
    const result = runner(step.command, step.args);
    const status = result.status ?? 1;
    if (status !== 0) {
      output(`failed: ${step.label} exit=${status}`);
      return status;
    }
  }
  if (options.dryRun === true) {
    output("dry-run complete; no local changes made.");
    return 0;
  }
  for (const line of plan.completionLines) {
    output(line);
  }
  return 0;
}

function command(label: string, commandName: string, args: readonly string[]): LocalCommand {
  return { label, command: commandName, args };
}

function defaultRunner(
  commandName: string,
  args: readonly string[],
): { readonly status: number | null } {
  return spawnSync(commandName, [...args], { stdio: "inherit" });
}

function formatCommand(step: LocalCommand): string {
  return [step.command, ...step.args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseCommonOptions(args: readonly string[]): {
  readonly configPath?: string;
  readonly dryRun: boolean;
  readonly rest: readonly string[];
} {
  const rest: string[] = [];
  let configPath: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--config":
        configPath = requiredValue(args[++index], "--config");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        rest.push(arg);
    }
  }
  return { configPath, dryRun, rest };
}

function parseInstallOptions(args: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
} {
  const common = parseCommonOptions(args);
  let platform: LocalPlatform | undefined;
  let noKeychain = false;
  let noLaunchd = false;
  let skipDoctor = false;

  for (let index = 0; index < common.rest.length; index += 1) {
    const arg = common.rest[index];
    switch (arg) {
      case "--platform":
        platform = parsePlatform(requiredValue(common.rest[++index], "--platform"));
        break;
      case "--no-keychain":
        noKeychain = true;
        break;
      case "--no-launchd":
        noLaunchd = true;
        break;
      case "--skip-doctor":
      case "--no-doctor":
        skipDoctor = true;
        break;
      default:
        throw new Error(`codex-im:install: unknown argument ${arg}`);
    }
  }

  if (platform === undefined) {
    throw new Error("codex-im:install: --platform must be telegram, lark, dingtalk, or slack");
  }
  return {
    dryRun: common.dryRun,
    plan: buildLocalInstallPlan({
      platform,
      configPath: common.configPath,
      noKeychain,
      noLaunchd,
      skipDoctor,
    }),
  };
}

function parseStatusOptions(args: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
} {
  const common = parseCommonOptions(args);
  for (const arg of common.rest) {
    throw new Error(`codex-im:status: unknown argument ${arg}`);
  }
  return {
    dryRun: common.dryRun,
    plan: buildLocalStatusPlan({ configPath: common.configPath }),
  };
}

function parseUninstallOptions(args: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
} {
  const common = parseCommonOptions(args);
  for (const arg of common.rest) {
    throw new Error(`codex-im:uninstall: unknown argument ${arg}`);
  }
  return {
    dryRun: common.dryRun,
    plan: buildLocalUninstallPlan({ dryRun: common.dryRun }),
  };
}

function parsePlatform(value: string): LocalPlatform {
  if (value === "telegram" || value === "lark" || value === "dingtalk" || value === "slack") {
    return value;
  }
  throw new Error("codex-im: --platform must be telegram, lark, dingtalk, or slack");
}

function requiredValue(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`codex-im: missing value for ${label}`);
  }
  return value;
}

function parseMode(argv: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
} {
  const [mode, ...args] = argv;
  switch (mode) {
    case "install":
      return parseInstallOptions(args);
    case "status":
      return parseStatusOptions(args);
    case "uninstall":
      return parseUninstallOptions(args);
    default:
      throw new Error("codex-im: usage: local-lifecycle.mts install|status|uninstall [options]");
  }
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseMode(argv);
  return runLocalCommandPlan(parsed.plan, { dryRun: parsed.dryRun });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export type LocalPlatform = "telegram" | "lark" | "dingtalk" | "slack";

export interface InstalledMetadata {
  readonly schemaVersion: 1;
  readonly packageVersion: string;
  readonly gitSha: string;
  readonly gitTag?: string;
  readonly codexVersion: string;
  readonly installedAt: string;
}

export interface UpdateCheckCache {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly sourceRemote: string;
  readonly currentGitSha: string;
  readonly currentGitTag?: string;
  readonly latestGitTag?: string;
  readonly latestGitSha?: string;
  readonly status: "current" | "update_available" | "unknown";
  readonly diagnostic?: string;
}

export interface RemoteTagInfo {
  readonly latestGitTag?: string;
  readonly latestGitSha?: string;
}

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

export interface LocalUpgradeOptions {
  readonly homeDir?: string;
  readonly repoPath?: string;
  readonly target?: string;
  readonly refresh?: boolean;
  readonly dirtyWorktree?: boolean;
  readonly currentGitSha?: string;
  readonly currentGitTag?: string;
  readonly installedMetadata?: InstalledMetadata | null;
  readonly updateCheckCache?: UpdateCheckCache | null;
}

export interface LocalGitState {
  readonly dirtyWorktree: boolean;
  readonly currentGitSha?: string;
  readonly currentGitTag?: string;
}

export interface DetectGitStateInput {
  readonly statusShort: string;
  readonly revParseHead?: string;
  readonly describeTags?: string;
}

export interface WriteUpdateCheckCacheOptions {
  readonly homeDir?: string;
  readonly cache: UpdateCheckCache;
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
    command("codex-runtime-compatibility", "pnpm", ["check:codex-runtime-compatibility"]),
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
      "  /projects",
      "  /use 1",
      "  Reply exactly: OK",
      "",
      "Useful local commands:",
      "  pnpm codex-im:status",
      "  pnpm codex-im:upgrade --check",
      "  pnpm codex-im:uninstall",
      "",
      "Computer Use is disabled unless enabled in local config and still requires explicit /cu.",
    ],
  };
}

export function buildInstallPlatformChoiceLines(): readonly string[] {
  return [
    "Choose one platform to configure first:",
    "1. Telegram",
    "2. Feishu/Lark",
    "3. DingTalk",
    "4. Slack",
  ];
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
    completionLines: [
      "Status check complete.",
      "Status is local-only by default. Run pnpm codex-im:upgrade --check for a remote update probe.",
    ],
  };
}

export function buildLocalUpgradeCheckPlan(options: LocalUpgradeOptions = {}): LocalCommandPlan {
  const homeDir = options.homeDir ?? homedir();
  const cachePath = updateCheckCachePath(homeDir);
  return {
    title: "codex-im upgrade check",
    commands: [],
    completionLines: [
      "mode: check",
      "network: allowed",
      "cache: update-check.json may be refreshed",
      `cache path: ${cachePath}`,
      "trust: cache is advisory only; apply resolves the target again",
    ],
  };
}

export function buildLocalUpgradePlan(options: LocalUpgradeOptions = {}): LocalCommandPlan {
  const target = options.target ?? options.updateCheckCache?.latestGitTag ?? "latest";
  const dirtyWorktree = options.dirtyWorktree === true;
  const installed = options.installedMetadata;
  const lines = [
    "mode: plan",
    options.refresh === true
      ? "network: refresh requested; update-check cache may be refreshed"
      : "network: not used",
    `target: ${target}`,
    `repo: ${options.repoPath ?? process.cwd()}`,
    `current git sha: ${shortGitSha(options.currentGitSha)}`,
    `current git tag: ${options.currentGitTag ?? "unknown"}`,
    `installed git sha: ${shortGitSha(installed?.gitSha)}`,
    `installed git tag: ${installed?.gitTag ?? "unknown"}`,
    `installed package version: ${installed?.packageVersion ?? "unknown"}`,
    `installed codex version: ${installed?.codexVersion ?? "unknown"}`,
    dirtyWorktree
      ? "apply: blocked (dirty worktree; commit or stash before --apply)"
      : "apply: allowed by worktree preflight",
    "next: pnpm codex-im:upgrade --apply --dry-run --target <tag>",
    "note: real --apply is not yet implemented in this alpha; only --apply --dry-run is supported.",
  ];
  return { title: "codex-im upgrade plan", commands: [], completionLines: lines };
}

export function buildLocalUpgradeApplyDryRunPlan(
  options: LocalUpgradeOptions = {},
): LocalCommandPlan {
  const target = options.target ?? "latest";
  const dirtyWorktree = options.dirtyWorktree === true;
  const lines = [
    "mode: apply --dry-run",
    `target: ${target}`,
    dirtyWorktree
      ? "apply: blocked (dirty worktree; dry-run only)"
      : "apply: would pass worktree preflight",
    "would: acquire ~/.codex-im-bridge/upgrade.lock",
    "would: run upgrade-preflight doctor",
    "would: stop launchd if needed",
    "would: create SQLite-safe backup",
    "would: git fetch --tags",
    "would: checkout target tag",
    "would: pnpm install --frozen-lockfile",
    "would: pnpm check:codex-runtime-compatibility",
    "would: pnpm bridge:build",
    "would: install bridge staging/release",
    "would: pnpm launchd:install",
    "would: pnpm launchd:status",
    "would: pnpm im:doctor --scope upgrade-preflight",
    "did not: git fetch",
    "did not: checkout",
    "did not: pnpm install",
    "did not: build",
    "did not: backup",
    "did not: stop launchd",
    "did not: install bridge",
    "did not: install launchd",
    "did not: read/write Keychain",
  ];
  return { title: "codex-im upgrade apply dry-run", commands: [], completionLines: lines };
}

export function writeUpdateCheckCache(options: WriteUpdateCheckCacheOptions): string {
  const cachePath = updateCheckCachePath(options.homeDir ?? homedir());
  mkdirSync(join(cachePath, ".."), { recursive: true });
  const redacted = clearSensitiveValues(JSON.stringify(options.cache, null, 2));
  writeFileSync(cachePath, `${redacted}\n`, { encoding: "utf8" });
  return cachePath;
}

export function readInstalledMetadata(homeDir: string = homedir()): InstalledMetadata | null {
  const metadataPath = join(homeDir, ".codex-im-bridge", "app", "install-metadata.json");
  if (!existsSync(metadataPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<InstalledMetadata>;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.packageVersion !== "string" ||
    typeof parsed.gitSha !== "string" ||
    typeof parsed.codexVersion !== "string" ||
    typeof parsed.installedAt !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    packageVersion: parsed.packageVersion,
    gitSha: parsed.gitSha,
    gitTag: typeof parsed.gitTag === "string" ? parsed.gitTag : undefined,
    codexVersion: parsed.codexVersion,
    installedAt: parsed.installedAt,
  };
}

export function clearSensitiveValues(value: string): string {
  return value
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]")
    .replace(/\b(token\s+)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/\b(client_secret|app_secret|access_token|bot_token)=([^\s"',}]+)/g, "$1=[REDACTED]")
    .replace(/\b(clientSecret|appSecret|accessToken|botToken)"\s*:\s*"[^"]+"/g, '$1": "[REDACTED]"')
    .replace(/\b(token|secret)"\s*:\s*"[^"]*(?:secret|token)[^"]*"/gi, '$1": "[REDACTED]"');
}

export function detectGitStateFromStatus(input: DetectGitStateInput): LocalGitState {
  const statusShort = input.statusShort.trim();
  const currentGitSha = normalizeOptionalLine(input.revParseHead);
  const currentGitTag = normalizeOptionalLine(input.describeTags);
  return {
    dirtyWorktree: statusShort.length > 0,
    currentGitSha,
    currentGitTag,
  };
}

export function detectLocalGitState(repoPath: string = process.cwd()): LocalGitState {
  const status = spawnSync("git", ["-C", repoPath, "status", "--short"], {
    encoding: "utf8",
  });
  // Use full 40-char SHA internally so comparison against `git ls-remote`
  // output (which is full SHA) is exact. Two distinct commits that share a
  // 7-char prefix would otherwise be treated as the same revision and
  // mask a real "update available" state. The display path truncates to
  // short SHA via `shortGitSha()` at render time only.
  const revParse = spawnSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const describe = spawnSync("git", ["-C", repoPath, "describe", "--tags", "--always"], {
    encoding: "utf8",
  });
  if (status.status !== 0) {
    return {
      dirtyWorktree: true,
      currentGitSha: normalizeOptionalLine(revParse.stdout),
      currentGitTag: normalizeOptionalLine(describe.stdout),
    };
  }
  return detectGitStateFromStatus({
    statusShort: status.stdout,
    revParseHead: revParse.stdout,
    describeTags: describe.stdout,
  });
}

export function parseRemoteTags(output: string): RemoteTagInfo {
  const tags = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [sha, ref] = line.split(/\s+/);
      if (
        sha === undefined ||
        ref === undefined ||
        !ref.startsWith("refs/tags/") ||
        ref.endsWith("^{}")
      ) {
        return [];
      }
      return [{ sha, tag: ref.slice("refs/tags/".length) }];
    });
  const candidates = tags.filter((entry) => /^v?\d+\.\d+\.\d+/.test(entry.tag));
  const sorted = (candidates.length > 0 ? candidates : tags).sort((left, right) =>
    left.tag.localeCompare(right.tag, "en", { numeric: true, sensitivity: "base" }),
  );
  const latest = sorted.at(-1);
  return latest === undefined ? {} : { latestGitTag: latest.tag, latestGitSha: latest.sha };
}

export function buildUpdateCheckCache(options: {
  readonly gitState: LocalGitState;
  readonly remoteTagInfo?: RemoteTagInfo;
  readonly diagnostic?: string;
}): UpdateCheckCache {
  const latestGitTag = options.remoteTagInfo?.latestGitTag;
  const latestGitSha = options.remoteTagInfo?.latestGitSha;
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    sourceRemote: "origin",
    currentGitSha: options.gitState.currentGitSha ?? "unknown",
    currentGitTag: options.gitState.currentGitTag,
    latestGitTag,
    latestGitSha,
    status:
      latestGitSha === undefined
        ? "unknown"
        : latestGitSha === options.gitState.currentGitSha
          ? "current"
          : "update_available",
    diagnostic: options.diagnostic,
  };
}

export function runRemoteUpdateCheck(repoPath: string = process.cwd()): UpdateCheckCache {
  const gitState = detectLocalGitState(repoPath);
  const result = spawnSync("git", ["-C", repoPath, "ls-remote", "--tags", "--refs", "origin"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return buildUpdateCheckCache({
      gitState,
      diagnostic: "unable to read remote tags; check network and git remote",
    });
  }
  return buildUpdateCheckCache({
    gitState,
    remoteTagInfo: parseRemoteTags(result.stdout),
  });
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

function parseInstallOptions(args: readonly string[]):
  | {
      readonly plan: LocalCommandPlan;
      readonly dryRun: boolean;
    }
  | Promise<{
      readonly plan: LocalCommandPlan;
      readonly dryRun: boolean;
    }> {
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
    return choosePlatformInteractively().then((chosenPlatform) => ({
      dryRun: common.dryRun,
      plan: buildLocalInstallPlan({
        platform: chosenPlatform,
        configPath: common.configPath,
        noKeychain,
        noLaunchd,
        skipDoctor,
      }),
    }));
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
    switch (arg) {
      case "--check-updates":
        throw new Error(
          "codex-im:status: --check-updates was a no-op stub and has been removed. For a real update check run: pnpm codex-im:upgrade --check",
        );
      default:
        throw new Error(`codex-im:status: unknown argument ${arg}`);
    }
  }
  return {
    dryRun: common.dryRun,
    plan: buildLocalStatusPlan({ configPath: common.configPath }),
  };
}

function parseUpgradeOptions(args: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
  readonly cacheToWrite?: UpdateCheckCache;
} {
  const common = parseCommonOptions(args);
  let mode: "check" | "plan" | "apply" = "plan";
  let target: string | undefined;
  let refresh = false;
  let yes = false;
  for (let index = 0; index < common.rest.length; index += 1) {
    const arg = common.rest[index];
    switch (arg) {
      case "--check":
        mode = "check";
        break;
      case "--plan":
        mode = "plan";
        break;
      case "--apply":
        mode = "apply";
        break;
      case "--target":
        target = requiredValue(common.rest[++index], "--target");
        break;
      case "--refresh":
        refresh = true;
        break;
      case "--yes":
        yes = true;
        break;
      case "--clear-stale-lock":
        throw new Error(
          "codex-im:upgrade: --clear-stale-lock is not yet implemented; clear ~/.codex-im-bridge/upgrade.lock manually if needed",
        );
      default:
        throw new Error(`codex-im:upgrade: unknown argument ${arg}`);
    }
  }
  if (yes && common.dryRun) {
    throw new Error("codex-im:upgrade: --yes is ignored for --dry-run and cannot skip gates");
  }
  const installedMetadata = readInstalledMetadata();
  const gitState = detectLocalGitState();
  if (mode === "check") {
    return {
      dryRun: common.dryRun,
      plan: buildLocalUpgradeCheckPlan({ target, installedMetadata, ...gitState }),
      cacheToWrite: runRemoteUpdateCheck(),
    };
  }
  if (mode === "apply") {
    if (!common.dryRun) {
      throw new Error(
        "codex-im:upgrade: apply (planned for a later release; current alpha only supports --apply --dry-run). To upgrade today: check out the target tag and re-run pnpm codex-im:install.",
      );
    }
    return {
      dryRun: false,
      plan: buildLocalUpgradeApplyDryRunPlan({ target, installedMetadata, ...gitState }),
    };
  }
  return {
    dryRun: common.dryRun,
    plan: buildLocalUpgradePlan({ target, refresh, installedMetadata, ...gitState }),
  };
}

function parseRollbackOptions(_args: readonly string[]): {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
} {
  throw new Error(
    "codex-im:rollback: not yet implemented; reinstall a previous tag manually (git checkout <tag> && pnpm install && pnpm codex-im:install)",
  );
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

function parsePlatformChoice(value: string): LocalPlatform {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "1":
    case "telegram":
      return "telegram";
    case "2":
    case "lark":
    case "feishu":
    case "feishu/lark":
      return "lark";
    case "3":
    case "dingtalk":
      return "dingtalk";
    case "4":
    case "slack":
      return "slack";
    default:
      throw new Error("codex-im: choose 1, 2, 3, 4, telegram, lark, dingtalk, or slack");
  }
}

function requiredValue(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`codex-im: missing value for ${label}`);
  }
  return value;
}

type ParsedMode = {
  readonly plan: LocalCommandPlan;
  readonly dryRun: boolean;
  readonly cacheToWrite?: UpdateCheckCache;
};

function parseMode(argv: readonly string[]): ParsedMode | Promise<ParsedMode> {
  const [mode, ...args] = argv;
  switch (mode) {
    case "install":
      return parseInstallOptions(args);
    case "status":
      return parseStatusOptions(args);
    case "upgrade":
      return parseUpgradeOptions(args);
    case "rollback":
      return parseRollbackOptions(args);
    case "uninstall":
      return parseUninstallOptions(args);
    default:
      throw new Error(
        "codex-im: usage: local-lifecycle.mts install|status|upgrade|rollback|uninstall [options]",
      );
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = await parseMode(argv);
  if (parsed.cacheToWrite !== undefined && parsed.dryRun !== true) {
    writeUpdateCheckCache({ cache: parsed.cacheToWrite });
  }
  return runLocalCommandPlan(parsed.plan, { dryRun: parsed.dryRun });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function updateCheckCachePath(homeDir: string): string {
  return join(homeDir, ".codex-im-bridge", "update-check.json");
}

function normalizeOptionalLine(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

/**
 * Render a git SHA for human display. Internal comparisons use the full
 * SHA (see `detectLocalGitState`); only the display path truncates to 7
 * characters. Returns `"unknown"` for missing input.
 */
export function shortGitSha(sha: string | undefined): string {
  if (sha === undefined || sha.length === 0) return "unknown";
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}

async function choosePlatformInteractively(
  input: NodeJS.ReadStream | Readable = process.stdin,
  output: NodeJS.WriteStream | Writable = process.stdout,
): Promise<LocalPlatform> {
  if (!("isTTY" in input) || input.isTTY !== true) {
    throw new Error("codex-im:install: --platform is required when stdin is not interactive");
  }
  for (const line of buildInstallPlatformChoiceLines()) {
    output.write(`${line}\n`);
  }
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question("Platform [1-4]: ");
    return parsePlatformChoice(answer);
  } finally {
    readline.close();
  }
}

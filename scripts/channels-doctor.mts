#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChannelCapabilities } from "../packages/channel-core/src/index.js";
import type {
  CodexRuntimeCompatibilityFinding,
  CodexRuntimeCompatibilityReport,
} from "../packages/codex-runtime/src/index.js";
import { type CodexImConfig, parseConfigToml } from "../packages/config/src/index.js";
import { DINGTALK_CAPABILITIES } from "../packages/im-dingtalk/src/index.js";
import { LARK_CAPABILITIES } from "../packages/im-lark/src/index.js";
import { SLACK_CAPABILITIES } from "../packages/im-slack/src/index.js";
import { TELEGRAM_CAPABILITIES } from "../packages/im-telegram/src/index.js";
import {
  type AppServerLifecycleProbeResult,
  formatAppServerLifecycleProbe,
  probeAppServerLifecycle,
} from "./app-server-lifecycle-probe.mts";
import { probeCodexRuntimeCompatibility } from "./check-codex-runtime-compatibility.mts";

type DoctorStatus = "ready" | "attention" | "blocked";
type PlatformStatus = DoctorStatus | "disabled";
type CheckStatus = "pass" | "fail" | "warn" | "info";
type Platform = "telegram" | "lark" | "dingtalk" | "slack";

export interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fixes?: readonly string[];
}

export interface PlatformDoctorReport {
  readonly platform: Platform;
  readonly status: PlatformStatus;
  readonly checks: readonly DoctorCheck[];
}

export interface DaemonDoctorStatus {
  readonly pid: number;
  readonly startedAt: string;
  readonly currentCodexThreadCount: number;
  readonly pendingApprovalCount: number;
}

export interface InstalledBridgeDoctorInput {
  readonly plistPresent: boolean;
  readonly daemonStatus?: DaemonDoctorStatus;
}

export interface ChannelsDoctorReport {
  readonly status: DoctorStatus;
  readonly configPath: string;
  readonly liveNetwork: "disabled";
  readonly codex: readonly DoctorCheck[];
  readonly installed: readonly DoctorCheck[];
  readonly platforms: readonly PlatformDoctorReport[];
}

export interface EvaluateChannelsDoctorInput {
  readonly config: CodexImConfig;
  readonly configPath: string;
  readonly env?: Record<string, string | undefined>;
  readonly keychainSecretPresent?: (service: string) => boolean;
  readonly installed?: InstalledBridgeDoctorInput;
  readonly lifecycle?: AppServerLifecycleProbeResult;
  readonly runtimeCompatibility?: CodexRuntimeCompatibilityReport;
  readonly writableRootsEnforced?: boolean;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".codex-im-bridge", "config.toml");
const DEFAULT_PLIST_PATH = join(homedir(), "Library", "LaunchAgents", "io.codex-im-bridge.plist");
const DEFAULT_STATUS_PATH = join(homedir(), ".codex-im-bridge", "daemon-status.json");

const SECRET_SERVICES = {
  telegram: "codex-im-bridge",
  lark: "codex-im-bridge-lark",
  dingtalk: "codex-im-bridge-dingtalk",
  slackBot: "codex-im-bridge-slack-bot",
  slackApp: "codex-im-bridge-slack-app",
} as const;

const CAPABILITIES = {
  telegram: TELEGRAM_CAPABILITIES,
  lark: LARK_CAPABILITIES,
  dingtalk: DINGTALK_CAPABILITIES,
  slack: SLACK_CAPABILITIES,
} as const satisfies Record<Platform, ChannelCapabilities>;

export function evaluateChannelsDoctor(input: EvaluateChannelsDoctorInput): ChannelsDoctorReport {
  const env = input.env ?? process.env;
  const keychainSecretPresent = input.keychainSecretPresent ?? defaultKeychainSecretPresent;
  const installed = input.installed ?? readInstalledBridgeStatus();
  const platformReports = [
    evaluateTelegram(input.config, env, keychainSecretPresent),
    evaluateLark(input.config, env, keychainSecretPresent),
    evaluateDingTalk(input.config, env, keychainSecretPresent),
    evaluateSlack(input.config, env, keychainSecretPresent),
  ];
  const codexChecks = formatCodexChecks({
    config: input.config,
    lifecycle: input.lifecycle ?? { kind: "unavailable", reason: "not_checked" },
    runtimeCompatibility: input.runtimeCompatibility,
    writableRootsEnforced: input.writableRootsEnforced === true,
  });
  const installedChecks = formatInstalledChecks(installed);
  const allChecks = [
    ...codexChecks,
    ...installedChecks,
    ...platformReports.flatMap((platform) => platform.checks),
  ];

  return {
    status: overallStatus(allChecks),
    configPath: input.configPath,
    liveNetwork: "disabled",
    codex: codexChecks,
    installed: installedChecks,
    platforms: platformReports,
  };
}

export function formatChannelsDoctorReport(report: ChannelsDoctorReport): string {
  const lines = [
    `im doctor: ${report.status}`,
    `config: ${report.configPath}`,
    `live_network: ${report.liveNetwork} (set explicit platform live gates for real IM traffic)`,
    "",
    "codex app server:",
    ...report.codex.map(formatCheck),
    "",
    "installed bridge:",
    ...report.installed.map(formatCheck),
  ];

  for (const platform of report.platforms) {
    lines.push("", `${platform.platform}: ${platform.status}`, ...platform.checks.map(formatCheck));
  }

  return lines.join("\n");
}

function evaluateTelegram(
  config: CodexImConfig,
  env: Record<string, string | undefined>,
  keychainSecretPresent: (service: string) => boolean,
): PlatformDoctorReport {
  const adapter = config.adapters.telegram;
  return platformReport("telegram", adapter.enabled, [
    adapterEnabled(adapter.enabled),
    secretCheck({
      platform: "telegram",
      name: "secret",
      envName: adapter.botTokenEnv,
      service: SECRET_SERVICES.telegram,
      env,
      keychainSecretPresent,
    }),
    allowlistCheck(config, "telegram"),
    capabilitiesCheck("telegram"),
    {
      name: "adapter_start",
      status: "info",
      detail: "not checked by default; use Telegram live gate",
    },
    {
      name: "inbound_text",
      status: "info",
      detail: "not checked by default; use Telegram live gate",
    },
    { name: "outbound_text", status: "info", detail: "supported by adapter" },
    { name: "approval_card", status: "info", detail: "supported by buttons" },
    {
      name: "callback_click",
      status: "info",
      detail: "not checked by default; use live acceptance gate",
    },
    { name: "edit_semantics", status: "info", detail: "text/card edit supported" },
    {
      name: "file",
      status: "info",
      detail: "outbound files/images supported; live send not checked by default",
    },
  ]);
}

function evaluateLark(
  config: CodexImConfig,
  env: Record<string, string | undefined>,
  keychainSecretPresent: (service: string) => boolean,
): PlatformDoctorReport {
  const adapter = config.adapters.lark;
  return platformReport("lark", adapter.enabled, [
    adapterEnabled(adapter.enabled),
    {
      name: "app_id",
      status: adapter.appId.length > 0 ? "pass" : "fail",
      detail: adapter.appId.length > 0 ? "present" : "missing",
    },
    secretCheck({
      platform: "lark",
      name: "app_secret",
      envName: adapter.appSecretEnv,
      service: SECRET_SERVICES.lark,
      env,
      keychainSecretPresent,
    }),
    allowlistCheck(config, "lark"),
    {
      name: "allowed_chat_ids",
      status: adapter.allowedChatIds.length > 0 ? "pass" : "warn",
      detail:
        adapter.allowedChatIds.length > 0 ? "present" : "empty; rely on global/project allowlist",
    },
    capabilitiesCheck("lark"),
    { name: "adapter_start", status: "info", detail: "not checked by default; use Lark live gate" },
    { name: "inbound_text", status: "info", detail: "not checked by default; use Lark live gate" },
    { name: "outbound_text", status: "info", detail: "supported by adapter" },
    { name: "approval_card", status: "info", detail: "supported by buttons/CardKit" },
    {
      name: "callback_click",
      status: "info",
      detail: "not checked by default; use live acceptance gate",
    },
    { name: "edit_semantics", status: "info", detail: "text/card edit supported" },
    {
      name: "file",
      status: "info",
      detail: "outbound files/images supported; live send not checked by default",
    },
  ]);
}

function evaluateDingTalk(
  config: CodexImConfig,
  env: Record<string, string | undefined>,
  keychainSecretPresent: (service: string) => boolean,
): PlatformDoctorReport {
  const adapter = config.adapters.dingtalk;
  return platformReport("dingtalk", adapter.enabled, [
    adapterEnabled(adapter.enabled),
    {
      name: "client_id",
      status: adapter.clientId !== "disabled" ? "pass" : "fail",
      detail: adapter.clientId === "disabled" ? "missing" : "present",
    },
    secretCheck({
      platform: "dingtalk",
      name: "client_secret",
      envName: adapter.clientSecretEnv,
      service: SECRET_SERVICES.dingtalk,
      env,
      keychainSecretPresent,
    }),
    {
      name: "card_template_id",
      status: adapter.cardTemplateId === undefined ? "fail" : "pass",
      detail: adapter.cardTemplateId === undefined ? "missing" : "present",
    },
    {
      name: "robot_code",
      status: "info",
      detail: adapter.robotCode === undefined ? "derived_from_client_id" : "present",
    },
    allowlistCheck(config, "dingtalk"),
    capabilitiesCheck("dingtalk"),
    {
      name: "adapter_start",
      status: "info",
      detail: "not checked by default; use DingTalk live gate",
    },
    {
      name: "inbound_text",
      status: "info",
      detail: "not checked by default; use DingTalk live gate",
    },
    { name: "outbound_text", status: "info", detail: "supported by adapter" },
    { name: "approval_card", status: "info", detail: "supported by CardKit/OpenAPI card client" },
    {
      name: "callback_click",
      status: "info",
      detail: "not checked by default; use DINGTALK_LIVE_CARD_CALLBACK=1 with a real client click",
    },
    {
      name: "edit_semantics",
      status: "info",
      detail:
        "text refs append by lifecycle contract with progress edits suppressed; card refs update through CardKit",
    },
    {
      name: "file",
      status: "info",
      detail:
        "outbound files/images supported through session reply URL or proactive target; live send not checked by default",
    },
  ]);
}

function evaluateSlack(
  config: CodexImConfig,
  env: Record<string, string | undefined>,
  keychainSecretPresent: (service: string) => boolean,
): PlatformDoctorReport {
  const adapter = config.adapters.slack;
  return platformReport("slack", adapter.enabled, [
    adapterEnabled(adapter.enabled),
    secretCheck({
      platform: "slack",
      name: "bot_token",
      envName: adapter.botTokenEnv,
      service: SECRET_SERVICES.slackBot,
      env,
      keychainSecretPresent,
    }),
    secretCheck({
      platform: "slack",
      name: "app_token",
      envName: adapter.appTokenEnv,
      service: SECRET_SERVICES.slackApp,
      env,
      keychainSecretPresent,
    }),
    allowlistCheck(config, "slack"),
    {
      name: "allowed_channel_ids",
      status: adapter.allowedChannelIds.length > 0 ? "pass" : "warn",
      detail:
        adapter.allowedChannelIds.length > 0
          ? "present"
          : "empty; rely on global/project allowlist",
    },
    capabilitiesCheck("slack"),
    {
      name: "socket_mode",
      status: "info",
      detail: "not checked by default; use Slack live gate",
    },
    { name: "slash_command", status: "info", detail: "/codex ingress supported by adapter" },
    { name: "inbound_text", status: "info", detail: "not checked by default; use Slack live gate" },
    { name: "outbound_text", status: "info", detail: "supported by adapter" },
    { name: "approval_card", status: "info", detail: "supported by Block Kit buttons" },
    {
      name: "callback_click",
      status: "info",
      detail: "not checked by default; use Slack live acceptance gate",
    },
    { name: "edit_semantics", status: "info", detail: "text/card edit supported" },
    {
      name: "file",
      status: "info",
      detail:
        "outbound files/images supported through external upload; live send not checked by default",
    },
  ]);
}

function platformReport(
  platform: Platform,
  enabled: boolean,
  checks: readonly DoctorCheck[],
): PlatformDoctorReport {
  if (!enabled) {
    return {
      platform,
      status: "disabled",
      checks: [adapterEnabled(false), capabilitiesCheck(platform)],
    };
  }
  return { platform, status: overallStatus(checks), checks };
}

function adapterEnabled(enabled: boolean): DoctorCheck {
  return {
    name: "adapter.enabled",
    status: enabled ? "pass" : "info",
    detail: enabled ? "enabled" : "disabled",
  };
}

function secretCheck(input: {
  readonly platform: Platform;
  readonly name: string;
  readonly envName: string;
  readonly service: string;
  readonly env: Record<string, string | undefined>;
  readonly keychainSecretPresent: (service: string) => boolean;
}): DoctorCheck {
  const envPresent = input.env[input.envName] !== undefined;
  const keychainPresent = input.keychainSecretPresent(input.service);
  if (envPresent) {
    return { name: input.name, status: "pass", detail: `present via env ${input.envName}` };
  }
  if (keychainPresent) {
    return {
      name: input.name,
      status: "pass",
      detail: `present via Keychain service ${input.service}`,
    };
  }
  return {
    name: input.name,
    status: "fail",
    detail: `missing from env ${input.envName} and Keychain service ${input.service}`,
    fixes: [
      `pnpm setup:im --platform ${input.platform}`,
      `security add-generic-password -U -s ${input.service} -a "$USER" -w "<${input.envName}>"`,
    ],
  };
}

function allowlistCheck(config: CodexImConfig, platform: Platform): DoctorCheck {
  const globalAllowed = hasPlatformEntry(platform, [
    ...config.security.allowedUsers,
    ...config.security.allowedChats,
  ]);
  const projectAllowed = Object.values(config.projects).some((project) =>
    hasPlatformEntry(platform, [...project.allowedUsers, ...project.allowedChats]),
  );
  if (globalAllowed && projectAllowed) {
    return {
      name: "allowlist",
      status: "pass",
      detail: `${platform} actor present in global and project allowlists`,
    };
  }
  return {
    name: globalAllowed ? "project.allowlist" : "security.allowlist",
    status: "fail",
    detail: globalAllowed
      ? `no project allows ${platform} user/chat`
      : `no ${platform} allowed user/chat`,
  };
}

function capabilitiesCheck(platform: Platform): DoctorCheck {
  const capabilities = CAPABILITIES[platform];
  return {
    name: "capabilities",
    status: "info",
    detail: [
      `buttons=${capabilities.supportsButtons}`,
      `edit=${capabilities.canEditMessage}`,
      `attachments=${capabilities.supportsAttachments}`,
      `callbackBytes=${capabilities.maxCallbackDataBytes}`,
    ].join(" "),
  };
}

function formatCodexChecks(input: {
  readonly config: CodexImConfig;
  readonly lifecycle: AppServerLifecycleProbeResult;
  readonly runtimeCompatibility?: CodexRuntimeCompatibilityReport;
  readonly writableRootsEnforced: boolean;
}): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      name: "lifecycle_daemon",
      status: "info",
      detail: formatAppServerLifecycleProbe(input.lifecycle),
    },
  ];
  if (input.runtimeCompatibility !== undefined) {
    checks.push(runtimeCompatibilityCheck(input.runtimeCompatibility));
  }
  checks.push(writableRootsEnforcementCheck(input.config, input.writableRootsEnforced));
  return checks;
}

function runtimeCompatibilityCheck(report: CodexRuntimeCompatibilityReport): DoctorCheck {
  const detailParts = [
    `runtime=${report.runtimeVersion}`,
    `generated=${report.generatedProtocolVersion}`,
    `status=${report.status}`,
    findingIds("blockers", report.blockers),
    findingIds("degraded", report.degradedFeatures),
    findingIds("warnings", report.warnings),
  ].filter((part): part is string => part !== undefined);
  return {
    name: "codex_runtime_compatibility",
    status: report.status === "blocked" ? "fail" : report.status === "degraded" ? "warn" : "pass",
    detail: detailParts.slice(0, 3).join(" ") + formatFindingSuffix(detailParts.slice(3)),
  };
}

function findingIds(
  label: string,
  findings: readonly CodexRuntimeCompatibilityFinding[],
): string | undefined {
  if (findings.length === 0) {
    return undefined;
  }
  return `${label}=${findings.map((finding) => finding.id).join(",")}`;
}

function formatFindingSuffix(parts: readonly string[]): string {
  return parts.length === 0 ? "" : `; ${parts.join("; ")}`;
}

function writableRootsEnforcementCheck(
  config: CodexImConfig,
  writableRootsEnforced: boolean,
): DoctorCheck {
  if (!hasConfiguredWritableRoots(config)) {
    return {
      name: "writable_roots_enforcement",
      status: "info",
      detail: "no writable_roots configured",
    };
  }
  if (writableRootsEnforced) {
    return {
      name: "writable_roots_enforcement",
      status: "pass",
      detail: "writable_roots forwarded to Codex App Server permissions",
    };
  }
  return {
    name: "writable_roots_enforcement",
    status: "warn",
    detail: "writable_roots configured; metadata-only in this alpha",
  };
}

function hasConfiguredWritableRoots(config: CodexImConfig): boolean {
  return Object.values(config.projects).some((project) => project.writableRoots.length > 0);
}

function formatInstalledChecks(installed: InstalledBridgeDoctorInput): readonly DoctorCheck[] {
  return [
    {
      name: "launchd.plist",
      status: installed.plistPresent ? "pass" : "info",
      detail: installed.plistPresent ? "present" : "missing; launchd may not be installed",
    },
    installed.daemonStatus === undefined
      ? {
          name: "daemon.status",
          status: "info",
          detail: "missing; installed daemon has not written a local status snapshot",
        }
      : {
          name: "daemon.status",
          status: "pass",
          detail: `running pid=${installed.daemonStatus.pid} codexThreads=${installed.daemonStatus.currentCodexThreadCount} pendingApprovals=${installed.daemonStatus.pendingApprovalCount}`,
        },
  ];
}

function overallStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "attention";
  }
  return "ready";
}

function formatCheck(check: DoctorCheck): string {
  const firstLine = `  ${check.name}: ${check.status} (${check.detail})`;
  if (check.fixes === undefined || check.fixes.length === 0) {
    return firstLine;
  }
  return [firstLine, ...check.fixes.map((fix) => `    fix: ${fix}`)].join("\n");
}

function hasPlatformEntry(platform: Platform, values: readonly string[]): boolean {
  return values.some((value) => value.startsWith(`${platform}:`));
}

function defaultKeychainSecretPresent(service: string): boolean {
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function readInstalledBridgeStatus(): InstalledBridgeDoctorInput {
  return {
    plistPresent: existsSync(DEFAULT_PLIST_PATH),
    daemonStatus: readDaemonStatus(DEFAULT_STATUS_PATH),
  };
}

function readDaemonStatus(path: string): DaemonDoctorStatus | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    const pid = numberField(parsed, "pid");
    const startedAt = stringField(parsed, "startedAt");
    const currentCodexThreadCount = numberField(parsed, "currentCodexThreadCount");
    const pendingApprovalCount = numberField(parsed, "pendingApprovalCount");
    if (
      pid === undefined ||
      startedAt === undefined ||
      currentCodexThreadCount === undefined ||
      pendingApprovalCount === undefined
    ) {
      return undefined;
    }
    return { pid, startedAt, currentCodexThreadCount, pendingApprovalCount };
  } catch {
    return undefined;
  }
}

function parseArgs(argv: readonly string[]): { configPath: string } {
  const configIndex = argv.indexOf("--config");
  if (configIndex === -1) {
    return { configPath: DEFAULT_CONFIG_PATH };
  }
  const configPath = argv[configIndex + 1];
  if (configPath === undefined || configPath.length === 0) {
    throw new Error("im doctor: --config requires a path");
  }
  return { configPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    throw new Error(`im doctor: config missing at ${configPath}`);
  }
  const config = parseConfigToml(readFileSync(configPath, "utf8"));
  const report = evaluateChannelsDoctor({
    config,
    configPath,
    lifecycle: probeAppServerLifecycle(),
    runtimeCompatibility: probeCodexRuntimeCompatibility({
      writableRootsConfigured: hasConfiguredWritableRoots(config),
    }),
  });
  console.log(formatChannelsDoctorReport(report));
  if (report.status === "blocked") {
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

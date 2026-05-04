#!/usr/bin/env -S pnpm exec tsx

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CodexImConfig, parseConfigToml } from "../packages/config/src/index.js";

export interface DingTalkReadinessInput {
  readonly config: CodexImConfig;
  readonly keychainSecretPresent: boolean;
  readonly env?: Record<string, string | undefined>;
}

export interface DingTalkReadinessCheck {
  readonly name: string;
  readonly status: "pass" | "fail" | "info";
  readonly detail: string;
}

export interface DingTalkReadinessReport {
  readonly status: "ready" | "blocked";
  readonly checks: readonly DingTalkReadinessCheck[];
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".codex-im-bridge", "config.toml");
const DEFAULT_KEYCHAIN_SERVICE = "codex-im-bridge-dingtalk";

export function evaluateDingTalkReadiness(input: DingTalkReadinessInput): DingTalkReadinessReport {
  const env = input.env ?? process.env;
  const adapter = input.config.adapters.dingtalk;
  const globalAllowed = hasDingTalkEntry([
    ...input.config.security.allowedUsers,
    ...input.config.security.allowedChats,
  ]);
  const projectAllowed = Object.values(input.config.projects).some((project) =>
    hasDingTalkEntry([...project.allowedUsers, ...project.allowedChats]),
  );
  const envSecretPresent = env[adapter.clientSecretEnv] !== undefined;
  const checks: DingTalkReadinessCheck[] = [
    {
      name: "adapter.enabled",
      status: adapter.enabled ? "pass" : "fail",
      detail: adapter.enabled ? "enabled" : "disabled",
    },
    {
      name: "client_id",
      status: adapter.clientId !== "disabled" ? "pass" : "fail",
      detail: adapter.clientId === "disabled" ? "missing" : "present",
    },
    {
      name: "client_secret",
      status: envSecretPresent || input.keychainSecretPresent ? "pass" : "fail",
      detail: envSecretPresent
        ? `present via ${adapter.clientSecretEnv}`
        : input.keychainSecretPresent
          ? `present via Keychain service ${DEFAULT_KEYCHAIN_SERVICE}`
          : `missing from env ${adapter.clientSecretEnv} and Keychain service ${DEFAULT_KEYCHAIN_SERVICE}`,
    },
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
    {
      name: "security.allowlist",
      status: globalAllowed ? "pass" : "fail",
      detail: globalAllowed ? "dingtalk actor present" : "no dingtalk allowed user/chat",
    },
    {
      name: "project.allowlist",
      status: projectAllowed ? "pass" : "fail",
      detail: projectAllowed ? "dingtalk actor present" : "no project allows dingtalk user/chat",
    },
  ];
  return {
    status: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    checks,
  };
}

export function formatDingTalkReadinessReport(
  report: DingTalkReadinessReport,
  options: { readonly configPath: string },
): string {
  return [
    `dingtalk readiness: ${report.status}`,
    `config: ${options.configPath}`,
    ...report.checks.map((check) => `${check.name}: ${check.status} (${check.detail})`),
  ].join("\n");
}

function hasDingTalkEntry(values: readonly string[]): boolean {
  return values.some((value) => value.startsWith("dingtalk:"));
}

function keychainSecretPresent(service: string): boolean {
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function parseArgs(argv: readonly string[]): { configPath: string } {
  const configIndex = argv.indexOf("--config");
  if (configIndex === -1) {
    return { configPath: DEFAULT_CONFIG_PATH };
  }
  const configPath = argv[configIndex + 1];
  if (configPath === undefined || configPath.length === 0) {
    throw new Error("dingtalk-readiness: --config requires a path");
  }
  return { configPath };
}

async function main(): Promise<void> {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    throw new Error(`dingtalk-readiness: config missing at ${configPath}`);
  }
  const config = parseConfigToml(readFileSync(configPath, "utf8"));
  const report = evaluateDingTalkReadiness({
    config,
    keychainSecretPresent: keychainSecretPresent(DEFAULT_KEYCHAIN_SERVICE),
  });
  console.log(formatDingTalkReadinessReport(report, { configPath }));
  if (report.status === "blocked") {
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

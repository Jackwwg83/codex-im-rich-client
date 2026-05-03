#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { planLaunchdInstall } from "../bin/install-launchd.mjs";

const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;
const GENERIC_SECRET_RE =
  /\b(?:ghp_[A-Za-z0-9_]{20,}|xox[abdprs]-[A-Za-z0-9-]{10,}|sk-(?!ip\b)[A-Za-z0-9_-]{20,})/i;
const AUTHORIZATION_BEARER_RE = /\bAuthorization:\s*Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{20,}/i;

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`bridge-redaction-scan: ${name} is required`);
  }
  return value;
}

function scan(label, text) {
  const fakeKeychainToken = process.env.FAKE_SECURITY_TOKEN_VALUE;
  if (
    TOKEN_SHAPED_RE.test(text) ||
    GENERIC_SECRET_RE.test(text) ||
    AUTHORIZATION_BEARER_RE.test(text) ||
    (fakeKeychainToken !== undefined &&
      fakeKeychainToken.length > 0 &&
      text.includes(fakeKeychainToken))
  ) {
    throw new Error(`bridge-redaction-scan: secret-shaped material in ${label}`);
  }
}

const home = requiredEnv("BRIDGE_HOME");
const daemonEntry = requiredEnv("BRIDGE_DAEMON");
const wrapperEntry = requiredEnv("BRIDGE_WRAPPER");
const configPath = requiredEnv("BRIDGE_CONFIG");
const logsDir = requiredEnv("BRIDGE_LOGS");
const nodeBin = requiredEnv("NODE_BIN");

const launchdPlan = await planLaunchdInstall({
  home,
  nodeBin,
  daemonEntry,
  wrapperEntry,
});

scan("launchd plist", launchdPlan.renderedPlist);
for (const [label, path] of [
  ["daemon", daemonEntry],
  ["wrapper", wrapperEntry],
  ["config", configPath],
  ["app package", join(home, ".codex-im-bridge", "app", "package.json")],
]) {
  scan(label, readFileSync(path, "utf8"));
}

if (existsSync(logsDir)) {
  for (const name of readdirSync(logsDir)) {
    scan(`log ${name}`, readFileSync(join(logsDir, name), "utf8"));
  }
}

process.stdout.write("redaction scan ok\n");

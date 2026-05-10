import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WRAPPER = "bin/load-and-run.sh";
const TELEGRAM_TOKEN = "fake-telegram-token-value";
const LARK_SECRET = "fake-lark-secret-value";
const DINGTALK_SECRET = "fake-dingtalk-secret-value";
const SLACK_BOT = "fake-slack-bot-token-value";
const SLACK_APP = "fake-slack-app-token-value";
const ALL_FAKE_SECRETS = [TELEGRAM_TOKEN, LARK_SECRET, DINGTALK_SECRET, SLACK_BOT, SLACK_APP];

function makeServiceShim() {
  const dir = mkdtempSync(join(tmpdir(), "codex-im-security-shim-"));
  const securityPath = join(dir, "security");
  writeFileSync(
    securityPath,
    [
      "#!/usr/bin/env bash",
      "service=''",
      "while [ $# -gt 0 ]; do",
      '  case "$1" in',
      '    -s) service="$2"; shift 2 ;;',
      "    *) shift ;;",
      "  esac",
      "done",
      'case "$service" in',
      "  codex-im-bridge) printf '%s' \"${FAKE_TOKEN_TELEGRAM:-}\" ;;",
      "  codex-im-bridge-lark) printf '%s' \"${FAKE_TOKEN_LARK:-}\" ;;",
      "  codex-im-bridge-dingtalk) printf '%s' \"${FAKE_TOKEN_DINGTALK:-}\" ;;",
      "  codex-im-bridge-slack-bot) printf '%s' \"${FAKE_TOKEN_SLACK_BOT:-}\" ;;",
      "  codex-im-bridge-slack-app) printf '%s' \"${FAKE_TOKEN_SLACK_APP:-}\" ;;",
      "esac",
      "exit 0",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(securityPath, 0o700);
  return dir;
}

function runWrapper(args, envPatch = {}) {
  const shimDir = makeServiceShim();
  const env = {
    ...process.env,
    PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    USER: "tester",
    NODE_BIN: "/fake/node",
    DAEMON_ENTRY: "/fake/daemon.mjs",
    ...envPatch,
  };
  for (const [key, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return spawnSync("bash", [WRAPPER, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

function expectNoSecretBytes(stdout) {
  for (const value of ALL_FAKE_SECRETS) {
    expect(stdout).not.toContain(value);
  }
  expect(stdout).not.toMatch(/length=\d+/);
}

describe("load-and-run Keychain wrapper", () => {
  it("dry-run reports presence per secret without printing length or token bytes", () => {
    const result = runWrapper(["--dry-run"], {
      FAKE_TOKEN_TELEGRAM: TELEGRAM_TOKEN,
      FAKE_TOKEN_LARK: LARK_SECRET,
      FAKE_TOKEN_DINGTALK: DINGTALK_SECRET,
      FAKE_TOKEN_SLACK_BOT: SLACK_BOT,
      FAKE_TOKEN_SLACK_APP: SLACK_APP,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: present");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: present");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: present");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: present");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: present");
    expect(result.stdout).toContain("NODE_BIN: /fake/node");
    expect(result.stdout).toContain("DAEMON_ENTRY: /fake/daemon.mjs");
    expect(result.stdout).toContain("CONFIG_PATH: ");
    expect(result.stdout).toContain("MIGRATIONS_DIR: ");
    expectNoSecretBytes(result.stdout);
    expect(result.stderr).toBe("");
  });

  it("dry-run with no Keychain entries reports all missing and exits 0", () => {
    const result = runWrapper(["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: missing");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: missing");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: missing");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: missing");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: missing");
    expect(result.stderr).toBe("");
  });

  it("Telegram-only enabled: only IM_TELEGRAM_BOT_TOKEN reports present", () => {
    const result = runWrapper(["--dry-run"], { FAKE_TOKEN_TELEGRAM: TELEGRAM_TOKEN });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: present");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: missing");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: missing");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: missing");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: missing");
    expectNoSecretBytes(result.stdout);
  });

  it("Lark-only enabled: only IM_LARK_APP_SECRET reports present", () => {
    const result = runWrapper(["--dry-run"], { FAKE_TOKEN_LARK: LARK_SECRET });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: missing");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: present");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: missing");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: missing");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: missing");
    expectNoSecretBytes(result.stdout);
  });

  it("DingTalk-only enabled: only DINGTALK_CLIENT_SECRET reports present", () => {
    const result = runWrapper(["--dry-run"], { FAKE_TOKEN_DINGTALK: DINGTALK_SECRET });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: missing");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: missing");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: present");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: missing");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: missing");
    expectNoSecretBytes(result.stdout);
  });

  it("Slack-only enabled: only SLACK_BOT_TOKEN and SLACK_APP_TOKEN report present", () => {
    const result = runWrapper(["--dry-run"], {
      FAKE_TOKEN_SLACK_BOT: SLACK_BOT,
      FAKE_TOKEN_SLACK_APP: SLACK_APP,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IM_TELEGRAM_BOT_TOKEN: missing");
    expect(result.stdout).toContain("IM_LARK_APP_SECRET: missing");
    expect(result.stdout).toContain("DINGTALK_CLIENT_SECRET: missing");
    expect(result.stdout).toContain("SLACK_BOT_TOKEN: present");
    expect(result.stdout).toContain("SLACK_APP_TOKEN: present");
    expectNoSecretBytes(result.stdout);
  });

  it("defaults NODE_BIN from PATH and DAEMON_ENTRY next to the wrapper when unset", () => {
    const result = runWrapper(["--dry-run"], { NODE_BIN: undefined, DAEMON_ENTRY: undefined });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NODE_BIN: ");
    expect(result.stdout).toContain("/node");
    expect(result.stdout).toContain("DAEMON_ENTRY: ");
    expect(result.stdout).toContain("/app/daemon.mjs");
    expect(result.stdout).toContain("CONFIG_PATH: ");
    expect(result.stdout).toContain("/config.toml");
    expect(result.stdout).toContain("MIGRATIONS_DIR: ");
    expect(result.stdout).toContain("/app/migrations");
  });

  it("execs the daemon entry exporting only the IM secrets that resolved", () => {
    const shimDir = makeServiceShim();
    const nodeDir = mkdtempSync(join(tmpdir(), "codex-im-node-shim-"));
    const nodePath = join(nodeDir, "node");
    writeFileSync(
      nodePath,
      [
        "#!/usr/bin/env bash",
        'echo "daemon-entry:$1"',
        'echo "config-flag:$2"',
        'echo "config-path:$3"',
        'echo "migrations-flag:$4"',
        'echo "migrations-dir:$5"',
        'echo "telegram-set:${IM_TELEGRAM_BOT_TOKEN+yes}"',
        'echo "lark-set:${IM_LARK_APP_SECRET+yes}"',
        'echo "dingtalk-set:${DINGTALK_CLIENT_SECRET+yes}"',
        'echo "slack-bot-set:${SLACK_BOT_TOKEN+yes}"',
        'echo "slack-app-set:${SLACK_APP_TOKEN+yes}"',
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(nodePath, 0o700);

    const result = spawnSync("bash", [WRAPPER], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        USER: "tester",
        NODE_BIN: nodePath,
        DAEMON_ENTRY: "/fake/daemon.mjs",
        FAKE_TOKEN_TELEGRAM: TELEGRAM_TOKEN,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("daemon-entry:/fake/daemon.mjs");
    expect(result.stdout).toContain("config-flag:--config");
    expect(result.stdout).toContain("config-path:");
    expect(result.stdout).toContain("/config.toml");
    expect(result.stdout).toContain("migrations-flag:--migrations-dir");
    expect(result.stdout).toContain("migrations-dir:");
    expect(result.stdout).toContain("/app/migrations");
    expect(result.stdout).toContain("telegram-set:yes");
    expect(result.stdout).not.toContain("lark-set:yes");
    expect(result.stdout).not.toContain("dingtalk-set:yes");
    expect(result.stdout).not.toContain("slack-bot-set:yes");
    expect(result.stdout).not.toContain("slack-app-set:yes");
    expectNoSecretBytes(result.stdout);
  });

  it("starts daemon even when no IM secrets are present (daemon validates per enabled adapter)", () => {
    const shimDir = makeServiceShim();
    const nodeDir = mkdtempSync(join(tmpdir(), "codex-im-node-shim-"));
    const nodePath = join(nodeDir, "node");
    writeFileSync(
      nodePath,
      [
        "#!/usr/bin/env bash",
        "echo daemon-launched",
        'echo "telegram-set:${IM_TELEGRAM_BOT_TOKEN+yes}"',
        "exit 0",
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(nodePath, 0o700);

    const result = spawnSync("bash", [WRAPPER], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH ?? ""}`,
        USER: "tester",
        NODE_BIN: nodePath,
        DAEMON_ENTRY: "/fake/daemon.mjs",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("daemon-launched");
    expect(result.stdout).not.toContain("telegram-set:yes");
    expect(result.stderr).not.toContain("not found in Keychain");
  });
});

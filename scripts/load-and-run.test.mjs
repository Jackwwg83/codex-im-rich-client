import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WRAPPER = "bin/load-and-run.sh";
const TOKEN = "fake-keychain-token-value";

function makeShimDir(mode = "token") {
  const dir = mkdtempSync(join(tmpdir(), "codex-im-security-shim-"));
  const securityPath = join(dir, "security");
  const body =
    mode === "empty"
      ? "#!/usr/bin/env bash\nexit 0\n"
      : "#!/usr/bin/env bash\nprintf '%s' \"$FAKE_SECURITY_TOKEN\"\n";
  writeFileSync(securityPath, body, { mode: 0o700 });
  return dir;
}

function runWrapper(args, envPatch = {}, mode = "token") {
  const shimDir = makeShimDir(mode);
  const env = {
    ...process.env,
    PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    USER: "tester",
    NODE_BIN: "/fake/node",
    DAEMON_ENTRY: "/fake/daemon.mjs",
    FAKE_SECURITY_TOKEN: TOKEN,
    ...envPatch,
  };
  return spawnSync("bash", [WRAPPER, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("load-and-run Keychain wrapper (T29a)", () => {
  it("dry-run reports token source and length without printing token bytes", () => {
    const result = runWrapper(["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `IM_TELEGRAM_BOT_TOKEN: <set from Keychain/env, length=${TOKEN.length}>`,
    );
    expect(result.stdout).toContain(
      `IM_LARK_APP_SECRET: <set from Keychain/env, length=${TOKEN.length}>`,
    );
    expect(result.stdout).toContain(
      `DINGTALK_CLIENT_SECRET: <set from Keychain/env, length=${TOKEN.length}>`,
    );
    expect(result.stdout).toContain(
      `SLACK_BOT_TOKEN: <set from Keychain/env, length=${TOKEN.length}>`,
    );
    expect(result.stdout).toContain(
      `SLACK_APP_TOKEN: <set from Keychain/env, length=${TOKEN.length}>`,
    );
    expect(result.stdout).toContain("NODE_BIN: /fake/node");
    expect(result.stdout).toContain("DAEMON_ENTRY: /fake/daemon.mjs");
    expect(result.stdout).toContain("CONFIG_PATH: ");
    expect(result.stdout).toContain("MIGRATIONS_DIR: ");
    expect(result.stdout).not.toContain(TOKEN);
    expect(result.stderr).toBe("");
  });

  it("fails closed when Keychain lookup returns an empty token", () => {
    const result = runWrapper(["--dry-run"], {}, "empty");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IM_TELEGRAM_BOT_TOKEN not found in Keychain");
    expect(result.stdout).not.toContain(TOKEN);
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
    expect(result.stdout).not.toContain(TOKEN);
  });

  it("execs the configured daemon entry with token only in environment", () => {
    const shimDir = makeShimDir();
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
        'echo "passthrough:$6"',
        'echo "token-length:${#IM_TELEGRAM_BOT_TOKEN}"',
        'echo "lark-secret-length:${#IM_LARK_APP_SECRET}"',
        'echo "dingtalk-secret-length:${#DINGTALK_CLIENT_SECRET}"',
        'echo "slack-bot-token-length:${#SLACK_BOT_TOKEN}"',
        'echo "slack-app-token-length:${#SLACK_APP_TOKEN}"',
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
        FAKE_SECURITY_TOKEN: TOKEN,
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
    expect(result.stdout).toContain(`token-length:${TOKEN.length}`);
    expect(result.stdout).toContain(`lark-secret-length:${TOKEN.length}`);
    expect(result.stdout).toContain(`dingtalk-secret-length:${TOKEN.length}`);
    expect(result.stdout).toContain(`slack-bot-token-length:${TOKEN.length}`);
    expect(result.stdout).toContain(`slack-app-token-length:${TOKEN.length}`);
    expect(result.stdout).not.toContain(TOKEN);
  });
});

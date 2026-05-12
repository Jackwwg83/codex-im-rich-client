import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoBridgeSecretMaterial,
  installBridge,
  planBridgeInstall,
} from "../bin/install-bridge.mjs";

const TOKEN = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

describe("install-bridge", () => {
  it("plans the production bridge app layout with native runtime dependencies", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-im-bridge-plan-"));
    const plan = planBridgeInstall({ home });

    expect(plan.bridgeDir).toBe(join(home, ".codex-im-bridge"));
    expect(plan.appDir).toBe(join(home, ".codex-im-bridge", "app"));
    expect(plan.binDir).toBe(join(home, ".codex-im-bridge", "bin"));
    expect(plan.dataDir).toBe(join(home, ".codex-im-bridge", "data"));
    expect(plan.logsDir).toBe(join(home, ".codex-im-bridge", "logs"));
    expect(plan.appDaemon).toBe(join(home, ".codex-im-bridge", "app", "daemon.mjs"));
    expect(plan.wrapperEntry).toBe(join(home, ".codex-im-bridge", "bin", "load-and-run.sh"));
    expect(plan.migrationsDir).toBe(join(home, ".codex-im-bridge", "app", "migrations"));
    expect(plan.runtimePackages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(
      expect.arrayContaining([
        "@larksuiteoapi/node-sdk@1.62.1",
        "better-sqlite3@12.9.0",
        "bindings@1.5.0",
        "dingtalk-stream@v2.1.5",
        "file-uri-to-path@1.0.0",
        "pino@9.14.0",
        "pino-roll@4.0.0",
        "thread-stream@3.1.0",
        "sonic-boom@4.2.1",
        "atomic-sleep@1.0.0",
      ]),
    );
  });

  it("fails closed before writing anything when config.toml is missing", async () => {
    const fixture = await makeFixture();

    await expect(
      installBridge({
        home: fixture.home,
        daemonBundle: fixture.daemonBundle,
        wrapperSource: fixture.wrapperSource,
        sourceMigrationsDir: fixture.sourceMigrationsDir,
        runtimePackages: fixture.runtimePackages,
      }),
    ).rejects.toThrow(/config.toml is required/);

    await expect(stat(join(fixture.home, ".codex-im-bridge", "app"))).rejects.toThrow();
  });

  it("dry-run validates inputs but writes no app artifacts and emits no secret-like material", async () => {
    const fixture = await makeFixture({ writeConfig: true });
    const result = await installBridge({
      dryRun: true,
      home: fixture.home,
      daemonBundle: fixture.daemonBundle,
      wrapperSource: fixture.wrapperSource,
      sourceMigrationsDir: fixture.sourceMigrationsDir,
      runtimePackages: fixture.runtimePackages,
    });

    expect(result.dryRun).toBe(true);
    expect(result.wroteApp).toBe(false);
    expect(result.preflight).toBe("skipped");
    await expect(stat(result.plan.appDaemon)).rejects.toThrow();
    expect(() => assertNoBridgeSecretMaterial(JSON.stringify(result.plan))).not.toThrow();
  });

  it("installs idempotent app/bin artifacts with pinned modes and no symlinks", async () => {
    const fixture = await makeFixture({ writeConfig: true });

    const first = await installBridge({
      home: fixture.home,
      daemonBundle: fixture.daemonBundle,
      wrapperSource: fixture.wrapperSource,
      sourceMigrationsDir: fixture.sourceMigrationsDir,
      runtimePackages: fixture.runtimePackages,
      preflight: false,
    });
    const second = await installBridge({
      home: fixture.home,
      daemonBundle: fixture.daemonBundle,
      wrapperSource: fixture.wrapperSource,
      sourceMigrationsDir: fixture.sourceMigrationsDir,
      runtimePackages: fixture.runtimePackages,
      preflight: false,
    });

    expect(first.wroteApp).toBe(true);
    expect(second.wroteApp).toBe(true);
    expect((await stat(second.plan.appDir)).mode & 0o777).toBe(0o700);
    expect((await stat(second.plan.binDir)).mode & 0o777).toBe(0o700);
    expect((await stat(second.plan.dataDir)).mode & 0o777).toBe(0o700);
    expect((await stat(second.plan.logsDir)).mode & 0o777).toBe(0o700);
    expect((await stat(second.plan.appDaemon)).mode & 0o777).toBe(0o755);
    expect((await stat(second.plan.wrapperEntry)).mode & 0o777).toBe(0o755);
    expect(await readFile(join(second.plan.migrationsDir, "001-init.sql"), "utf8")).toContain(
      "schema_version",
    );
    expect(await readFile(second.plan.appPackageJson, "utf8")).toContain("native-runtime");
    expect(
      await readFile(join(second.plan.nodeModulesDir, "native-runtime", "index.js"), "utf8"),
    ).toBe("export const ok = true;\n");
  });

  it("refuses existing symlink targets inside the bridge directory", async () => {
    const fixture = await makeFixture({ writeConfig: true });
    const bridgeDir = join(fixture.home, ".codex-im-bridge");
    await mkdir(bridgeDir, { recursive: true });
    await symlink(tmpdir(), join(bridgeDir, "app"));

    await expect(
      installBridge({
        home: fixture.home,
        daemonBundle: fixture.daemonBundle,
        wrapperSource: fixture.wrapperSource,
        sourceMigrationsDir: fixture.sourceMigrationsDir,
        runtimePackages: fixture.runtimePackages,
        preflight: false,
      }),
    ).rejects.toThrow(/refusing symlink app dir/);
  });

  it("proves installed better-sqlite3 resolves from app/node_modules outside the repo cwd", async () => {
    const fixture = await makeFixture({ writeConfig: true, betterSqlitePreflightDaemon: true });
    const result = await installBridge({
      home: fixture.home,
      daemonBundle: fixture.daemonBundle,
      wrapperSource: fixture.wrapperSource,
      sourceMigrationsDir: fixture.sourceMigrationsDir,
      preflight: false,
    });

    const run = spawnSync(process.execPath, [result.plan.appDaemon], {
      cwd: result.plan.home,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("sqlite:1");
    expect(run.stderr).toBe("");
  }, 30_000);

  it("runs installed daemon preflight after install", async () => {
    const fixture = await makeFixture({ writeConfig: true, preflightDaemon: true });
    const result = await installBridge({
      home: fixture.home,
      daemonBundle: fixture.daemonBundle,
      wrapperSource: fixture.wrapperSource,
      sourceMigrationsDir: fixture.sourceMigrationsDir,
      runtimePackages: fixture.runtimePackages,
    });

    expect(result.preflight).toBe("ok");
  });

  it("fails the redaction scan on token-shaped output", () => {
    expect(() => assertNoBridgeSecretMaterial(`leaked ${TOKEN}`)).toThrow(/token-shaped material/);
  });
});

async function makeFixture(options = {}) {
  const home = await mkdtemp(join(tmpdir(), "codex-im-bridge-home-"));
  const source = await mkdtemp(join(tmpdir(), "codex-im-bridge-source-"));
  const bridgeDir = join(home, ".codex-im-bridge");
  const daemonBundle = join(source, "daemon.mjs");
  const wrapperSource = join(source, "load-and-run.sh");
  const sourceMigrationsDir = join(source, "migrations");
  const runtimeSource = join(source, "native-runtime");
  await mkdir(sourceMigrationsDir, { recursive: true });
  await mkdir(runtimeSource, { recursive: true });
  await writeFile(join(sourceMigrationsDir, "001-init.sql"), "CREATE TABLE schema_version(id);\n");
  await writeFile(
    join(runtimeSource, "package.json"),
    '{"name":"native-runtime","version":"1.0.0"}\n',
  );
  await writeFile(join(runtimeSource, "index.js"), "export const ok = true;\n");
  await writeFile(wrapperSource, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(wrapperSource, 0o755);

  const daemonSource = options.betterSqlitePreflightDaemon
    ? [
        "#!/usr/bin/env node",
        'import Database from "better-sqlite3";',
        'const db = new Database(":memory:");',
        'const row = db.prepare("select 1 as value").get();',
        "console.log(`sqlite:${row.value}`);",
        "db.close();",
      ].join("\n")
    : options.preflightDaemon
      ? [
          "#!/usr/bin/env node",
          'if (process.argv.includes("--preflight")) {',
          '  console.log("daemon preflight: ok");',
          "} else {",
          '  console.error("missing --preflight");',
          "  process.exit(1);",
          "}",
        ].join("\n")
      : "#!/usr/bin/env node\nconsole.log('daemon');\n";
  await writeFile(daemonBundle, daemonSource);
  await chmod(daemonBundle, 0o755);

  if (options.writeConfig === true) {
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(join(bridgeDir, "config.toml"), sampleConfig(home));
  }

  return {
    home,
    daemonBundle,
    wrapperSource,
    sourceMigrationsDir,
    runtimePackages: [
      {
        name: "native-runtime",
        version: "1.0.0",
        sourceDir: runtimeSource,
        targetDir: "",
      },
    ],
  };
}

function sampleConfig(home) {
  return `
[daemon]
data_dir = "${home}/.codex-im-bridge/data"
log_dir = "${home}/.codex-im-bridge/logs"

[storage]
sqlite_path = "${home}/.codex-im-bridge/data/state.db"
auto_migrate = true

[codex]
binary = "codex"
version_pin = "0.130.0"

[security]
allowed_users = []
allowed_chats = []
admin_users = []

[security.commands]
deny_patterns = []
require_admin_patterns = []

[adapters.telegram]
enabled = false
bot_token_env = "IM_TELEGRAM_BOT_TOKEN"

[adapters.lark]
enabled = false
app_id = "disabled"
app_secret_env = "LARK_APP_SECRET"
domain = "feishu"
allowed_chat_ids = []

[adapters.dingtalk]
enabled = false
client_id = "disabled"
client_secret_env = "DINGTALK_CLIENT_SECRET"

[projects.default]
cwd = "${home}"
allowed_users = []
allowed_chats = []
writable_roots = ["${home}"]
`;
}

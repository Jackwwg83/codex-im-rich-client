import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = "packages/im-dingtalk/scripts/live-smoke.mts";
const CLIENT_ID = "ding_test_client_id";
const SECRET = "ding-super-secret-value";

describe("DingTalk live smoke harness gate (JAC-89)", () => {
  it("skips without DINGTALK_LIVE and redacts configured secret values", () => {
    const result = runLiveSmoke({
      DINGTALK_CLIENT_SECRET_ENV: "DINGTALK_TEST_SECRET",
      DINGTALK_TEST_SECRET: SECRET,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "skip"');
    expect(result.stdout).toContain("[dingtalk-live-smoke] SKIP");
    expect(output(result)).not.toContain(SECRET);
  });

  it("blocks with DINGTALK_LIVE=1 when required env is incomplete", () => {
    const result = runLiveSmoke({
      DINGTALK_LIVE: "1",
      DINGTALK_CLIENT_SECRET_ENV: "DINGTALK_TEST_SECRET",
      DINGTALK_TEST_SECRET: SECRET,
    });

    expect(result.status).toBe(2);
    expect(output(result)).toContain("[dingtalk-live-smoke] BLOCKED");
    expect(result.stdout).toContain('"status": "blocked"');
    expect(output(result)).not.toContain(SECRET);
  });

  it("supports an explicit dry run gate with complete live env", () => {
    const result = runLiveSmoke({
      DINGTALK_LIVE: "1",
      DINGTALK_LIVE_DRY_RUN: "1",
      DINGTALK_CLIENT_ID: CLIENT_ID,
      DINGTALK_CLIENT_SECRET_ENV: "DINGTALK_TEST_SECRET",
      DINGTALK_TEST_SECRET: SECRET,
      DINGTALK_LIVE_DURATION_MS: "1000",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "ready_dry_run"');
    expect(result.stdout).toContain("[dingtalk-live-smoke] READY_DRY_RUN");
    expect(output(result)).not.toContain(SECRET);
    expect(output(result)).not.toContain(CLIENT_ID);
  });
});

function runLiveSmoke(env: Record<string, string>) {
  const cleanEnv = { ...process.env };
  for (const key of [
    "DINGTALK_CLIENT_ID",
    "DINGTALK_CLIENT_SECRET_ENV",
    "DINGTALK_LIVE",
    "DINGTALK_LIVE_DRY_RUN",
    "DINGTALK_LIVE_DURATION_MS",
    "DINGTALK_TEST_SECRET",
  ]) {
    delete cleanEnv[key];
  }

  return spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...cleanEnv, ...env },
  });
}

function output(result: ReturnType<typeof runLiveSmoke>): string {
  return `${result.stdout}\n${result.stderr}`;
}

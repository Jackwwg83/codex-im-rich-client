import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = "packages/im-lark/scripts/live-smoke.mts";
const SECRET = "super-secret-value";

describe("Lark live smoke harness gate (JAC-161)", () => {
  it("skips without LARK_LIVE and redacts configured secret values", () => {
    const result = runLiveSmoke({
      LARK_APP_SECRET_ENV: "LARK_TEST_SECRET",
      LARK_TEST_SECRET: SECRET,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "skip"');
    expect(result.stdout).toContain("[lark-live-smoke] SKIP");
    expect(output(result)).not.toContain(SECRET);
  });

  it("blocks with LARK_LIVE=1 when required env is incomplete", () => {
    const result = runLiveSmoke({
      LARK_LIVE: "1",
      LARK_APP_SECRET_ENV: "LARK_TEST_SECRET",
      LARK_TEST_SECRET: SECRET,
    });

    expect(result.status).toBe(2);
    expect(output(result)).toContain("[lark-live-smoke] BLOCKED");
    expect(result.stdout).toContain('"status": "blocked"');
    expect(output(result)).not.toContain(SECRET);
  });

  it("supports an explicit dry run gate with complete live env", () => {
    const result = runLiveSmoke({
      LARK_LIVE: "1",
      LARK_LIVE_DRY_RUN: "1",
      LARK_APP_ID: "cli_test_app_id",
      LARK_APP_SECRET_ENV: "LARK_TEST_SECRET",
      LARK_TEST_SECRET: SECRET,
      LARK_TARGET_CHAT_ID: "oc_test_live_chat",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "ready_dry_run"');
    expect(result.stdout).toContain("[lark-live-smoke] READY_DRY_RUN");
    expect(output(result)).not.toContain(SECRET);
    expect(output(result)).not.toContain("cli_test_app_id");
    expect(output(result)).not.toContain("oc_test_live_chat");
  });

  it("supports explicit card schema dry run without leaking live values", () => {
    const result = runLiveSmoke({
      LARK_LIVE: "1",
      LARK_LIVE_CARD: "1",
      LARK_LIVE_DRY_RUN: "1",
      LARK_APP_ID: "cli_test_app_id",
      LARK_APP_SECRET_ENV: "LARK_TEST_SECRET",
      LARK_TEST_SECRET: SECRET,
      LARK_TARGET_CHAT_ID: "oc_test_live_chat",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "ready_dry_run"');
    expect(result.stdout).toContain('"mode": "card"');
    expect(result.stdout).toContain("[lark-live-smoke] READY_DRY_RUN");
    expect(output(result)).not.toContain(SECRET);
    expect(output(result)).not.toContain("cli_test_app_id");
    expect(output(result)).not.toContain("oc_test_live_chat");
  });

  it("supports explicit file dry run without leaking live values", () => {
    const result = runLiveSmoke({
      LARK_LIVE: "1",
      LARK_LIVE_FILE: "1",
      LARK_LIVE_DRY_RUN: "1",
      LARK_APP_ID: "cli_test_app_id",
      LARK_APP_SECRET_ENV: "LARK_TEST_SECRET",
      LARK_TEST_SECRET: SECRET,
      LARK_TARGET_CHAT_ID: "oc_test_live_chat",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "ready_dry_run"');
    expect(result.stdout).toContain('"mode": "file"');
    expect(result.stdout).toContain("[lark-live-smoke] READY_DRY_RUN");
    expect(output(result)).not.toContain(SECRET);
    expect(output(result)).not.toContain("cli_test_app_id");
    expect(output(result)).not.toContain("oc_test_live_chat");
  });
});

function runLiveSmoke(env: Record<string, string>) {
  const cleanEnv = { ...process.env };
  for (const key of [
    "LARK_APP_ID",
    "LARK_APP_SECRET_ENV",
    "LARK_DOMAIN",
    "LARK_LIVE",
    "LARK_LIVE_CARD",
    "LARK_LIVE_CARD_UPDATE",
    "LARK_LIVE_FILE",
    "LARK_LIVE_DRY_RUN",
    "LARK_TARGET_CHAT_ID",
    "LARK_TEST_SECRET",
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

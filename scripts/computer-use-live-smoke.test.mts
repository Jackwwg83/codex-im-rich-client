import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/computer-use-live-smoke.mts";
const SECRET = "sk-testsecret1234567890";

describe("Computer Use live smoke harness gate (JAC-100)", () => {
  it("skips by default without COMPUTER_USE_LIVE=1", () => {
    const result = runLiveSmoke({ COMPUTER_USE_LIVE_TASK: SECRET });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "skip"');
    expect(output(result)).toContain("[computer-use-live-smoke] SKIP");
    expect(output(result)).not.toContain(SECRET);
  });

  it("blocks when live gate is enabled but provider capability is not verified", () => {
    const result = runLiveSmoke({
      COMPUTER_USE_LIVE: "1",
      COMPUTER_USE_LIVE_APP: "Google Chrome",
      COMPUTER_USE_LIVE_TASK: SECRET,
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"status": "blocked"');
    expect(output(result)).toContain("provider capability is not verified");
    expect(output(result)).not.toContain(SECRET);
  });

  it("supports verified dry-run readiness without desktop action", () => {
    const result = runLiveSmoke({
      COMPUTER_USE_LIVE: "1",
      COMPUTER_USE_PROVIDER_VERIFIED: "1",
      COMPUTER_USE_LIVE_DRY_RUN: "1",
      COMPUTER_USE_LIVE_APP: "Google Chrome",
      COMPUTER_USE_LIVE_TASK: SECRET,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "ready_dry_run"');
    expect(output(result)).toContain("READY_DRY_RUN");
    expect(output(result)).not.toContain(SECRET);
  });

  it("supports a fake-executor non-dry-run path for the Mac Chrome provider", () => {
    const result = runLiveSmoke({
      COMPUTER_USE_LIVE: "1",
      COMPUTER_USE_PROVIDER_VERIFIED: "1",
      COMPUTER_USE_LIVE_PROVIDER: "mac-chrome",
      COMPUTER_USE_LIVE_FAKE_EXECUTOR: "1",
      COMPUTER_USE_LIVE_APP: "Google Chrome",
      COMPUTER_USE_LIVE_TASK: SECRET,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status": "executed"');
    expect(output(result)).toContain("EXECUTED");
    expect(output(result)).not.toContain(SECRET);
  });
});

function runLiveSmoke(env: Record<string, string>) {
  const cleanEnv = { ...process.env };
  for (const key of [
    "COMPUTER_USE_LIVE",
    "COMPUTER_USE_PROVIDER_VERIFIED",
    "COMPUTER_USE_LIVE_DRY_RUN",
    "COMPUTER_USE_LIVE_PROVIDER",
    "COMPUTER_USE_LIVE_FAKE_EXECUTOR",
    "COMPUTER_USE_LIVE_APP",
    "COMPUTER_USE_LIVE_TASK",
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

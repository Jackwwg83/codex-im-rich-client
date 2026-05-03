import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeDaemonStatusSnapshot } from "../src/index.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-im-daemon-status-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("daemon status snapshot writer (JAC-147)", () => {
  it("writes snapshots with atomic temp-file rename and token redaction", async () => {
    const root = makeTempRoot();
    const statusPath = join(root, "nested", "daemon-status.json");

    await writeDaemonStatusSnapshot(
      statusPath,
      {
        pid: 123,
        startedAt: "2026-05-02T20:00:00.000Z",
        currentCodexThreadCount: 1,
        pendingApprovalCount: 2,
        lastCodexSpawnAt: "2026-05-02T20:00:01.000Z",
        supervisorFailureCount: 0,
        lastFatal: {
          at: "2026-05-02T20:00:02.000Z",
          message: "boom IM_TELEGRAM_BOT_TOKEN=1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd",
        },
      },
      { tmpSuffix: "unit.tmp" },
    );

    expect(existsSync(`${statusPath}.unit.tmp`)).toBe(false);
    const parsed = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      pid: 123,
      startedAt: "2026-05-02T20:00:00.000Z",
      currentCodexThreadCount: 1,
      pendingApprovalCount: 2,
      lastCodexSpawnAt: "2026-05-02T20:00:01.000Z",
      supervisorFailureCount: 0,
      lastFatal: {
        at: "2026-05-02T20:00:02.000Z",
        message: "boom IM_TELEGRAM_BOT_TOKEN=***REDACTED:env-value***",
      },
    });
    expect(readFileSync(statusPath, "utf8")).not.toContain("1234567890:");
  });
});

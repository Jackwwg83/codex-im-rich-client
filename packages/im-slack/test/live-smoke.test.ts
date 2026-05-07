import { describe, expect, it, vi } from "vitest";
import { runSlackLiveSmokeCore } from "../src/index.js";

describe("Slack live smoke gate (JAC-248)", () => {
  it("skips by default without requiring Slack secrets", async () => {
    const output = vi.fn();
    const result = await runSlackLiveSmokeCore({ env: {}, output });

    expect(result).toMatchObject({ status: "skip", gate: "disabled", botToken: "missing" });
    expect(JSON.stringify(output.mock.calls)).not.toContain("xox");
  });

  it("dry-runs with redacted presence-only status", async () => {
    const output = vi.fn();
    const result = await runSlackLiveSmokeCore({
      env: {
        SLACK_LIVE: "1",
        SLACK_LIVE_DRY_RUN: "1",
        SLACK_BOT_TOKEN_ENV: "TEST_SLACK_BOT_TOKEN",
        TEST_SLACK_BOT_TOKEN: "xoxb-redacted-test-token",
      },
      output,
    });

    expect(result).toMatchObject({
      status: "ready_dry_run",
      gate: "enabled",
      botTokenEnv: "TEST_SLACK_BOT_TOKEN",
      botToken: "present",
    });
    expect(JSON.stringify(output.mock.calls)).not.toContain("xoxb-redacted-test-token");
  });

  it("uses Slack external upload APIs for explicit live file mode", async () => {
    const output = vi.fn();
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/files.getUploadURLExternal")) {
        return jsonResponse({
          ok: true,
          upload_url: "https://files.slack.test/upload",
          file_id: "F1",
        });
      }
      if (href === "https://files.slack.test/upload") {
        return new Response("", { status: 200 });
      }
      if (href.endsWith("/files.completeUploadExternal")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: false, error: "unexpected_url" });
    });

    const result = await runSlackLiveSmokeCore({
      env: {
        SLACK_LIVE: "1",
        SLACK_LIVE_FILE: "1",
        TEST_SLACK_BOT_TOKEN: "xoxb-redacted-test-token",
        SLACK_BOT_TOKEN_ENV: "TEST_SLACK_BOT_TOKEN",
        SLACK_TARGET_CHANNEL_ID: "C_TEST",
      },
      output,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "sent", mode: "file", messageId: "present" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(output.mock.calls)).not.toContain("xoxb-redacted-test-token");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
